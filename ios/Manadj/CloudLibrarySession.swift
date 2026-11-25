import AuthenticationServices
import CryptoKit
import Foundation
import ManadjCore
import Security
import Combine
import UIKit

/// Disabled owner-only library sign-in, isolated from feedback credentials.
/// Access tokens are opaque. Owner identity is enforced by Access and the
/// Worker's signed-assertion check, never by decoding a client-side JWT.
@MainActor
final class CloudLibrarySession: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private struct Credentials: Codable, Sendable {
        let clientID: String
        let accessToken: String
        let refreshToken: String
        let expiresAt: Date
    }
    private struct TokenResponse: Decodable {
        let access_token: String
        let token_type: String
        let expires_in: Double
        let refresh_token: String?
    }
    private struct Registration: Decodable {
        let client_id: String
        let redirect_uris: [String]
        let token_endpoint_auth_method: String
    }
    private let http: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 45
        return URLSession(configuration: config, delegate: CloudLibraryNoRedirects(), delegateQueue: nil)
    }()
    private var browser: ASWebAuthenticationSession?
    private var loginInProgress = false
    private var refresh: Task<Credentials, Error>?
    private var generation = UUID()

    func verifyOwnerResource() async throws {
        let value = try await accessToken()
        var request = URLRequest(url: CloudLibraryOAuth.resource.appendingPathComponent("v1/sync-check/identity"))
        request.setValue("Bearer " + value, forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              data.count <= 4096, let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["authenticated"] as? Bool == true, let subject = body["subject"] as? String, !subject.isEmpty else {
            throw FeedbackFailure("Native owner resource check did not pass")
        }
    }

    func signIn() async throws {
        guard CloudLibraryOAuth.authenticationTestEnabled else { throw FeedbackFailure("Continuous library sync is not enabled") }
        guard !loginInProgress else { throw FeedbackFailure("Cloud sign-in is already open") }
        loginInProgress = true
        generation = UUID()
        refresh?.cancel(); refresh = nil
        defer { loginInProgress = false }
        let currentGeneration = generation
        let metadata = try await discovery()
        let clientID = try await registeredClient(metadata: metadata)
        let state = try Self.randomURLSafe()
        var verifier = try Self.randomURLSafe()
        var challenge = Self.challenge(verifier)
        // Access documents an alphanumeric-first challenge requirement.
        // Bound the retry and fail closed if the random generator is broken.
        for _ in 0..<16 where !Self.startsAlphanumeric(challenge) {
            verifier = try Self.randomURLSafe(); challenge = Self.challenge(verifier)
        }
        guard Self.startsAlphanumeric(challenge) else { throw FeedbackFailure("Could not prepare secure cloud sign-in") }
        let url = try CloudLibraryOAuth.authorizationURL(metadata: metadata, clientID: clientID, state: state, challenge: challenge)
        try Task.checkCancellation()
        guard generation == currentGeneration else { throw CancellationError() }
        let callback = try await authenticate(url)
        let code = try CloudLibraryOAuth.authorizationCode(callback: callback, expectedState: state)
        let reply = try await token(metadata: metadata, fields: ["grant_type": "authorization_code", "client_id": clientID,
            "redirect_uri": CloudLibraryOAuth.redirect, "code_verifier": verifier, "code": code,
            "resource": CloudLibraryOAuth.resource.absoluteString])
        let credentials = try makeCredentials(reply, clientID: clientID, priorRefresh: nil)
        guard generation == currentGeneration else { throw CancellationError() }
        try CloudLibraryKeychain.save(try JSONEncoder().encode(credentials), account: "tokens")
    }

    /// Does not open a browser automatically. A send cannot unexpectedly prompt
    /// for account access or replace the report preview with a login sheet.
    func accessToken() async throws -> String {
        guard CloudLibraryOAuth.authenticationTestEnabled else { throw FeedbackFailure("Continuous library sync is not enabled") }
        guard !loginInProgress else { throw FeedbackFailure("Finish cloud sign-in before sending") }
        let credentials = try storedCredentials()
        if credentials.expiresAt.timeIntervalSinceNow > 45 { return credentials.accessToken }
        if let refresh { return try await refresh.value.accessToken }
        let currentGeneration = generation
        let work = Task { @MainActor in
            let metadata = try await self.discovery()
            let reply = try await self.token(metadata: metadata, fields: ["grant_type": "refresh_token",
                "client_id": credentials.clientID, "refresh_token": credentials.refreshToken,
                "resource": CloudLibraryOAuth.resource.absoluteString])
            let updated = try self.makeCredentials(reply, clientID: credentials.clientID, priorRefresh: credentials.refreshToken)
            guard self.generation == currentGeneration else { throw CancellationError() }
            try CloudLibraryKeychain.save(try JSONEncoder().encode(updated), account: "tokens")
            return updated
        }
        refresh = work
        defer { if generation == currentGeneration { refresh = nil } }
        return try await work.value.accessToken
    }

    /// Returns whether remote revocation was confirmed. Local credentials are
    /// removed first even when offline. Never describes an offline logout as
    /// revoking the server grant.
    @discardableResult
    func signOut() async throws -> Bool {
        guard CloudLibraryOAuth.authenticationTestEnabled else { throw FeedbackFailure("Continuous library sync is not enabled") }
        generation = UUID()
        refresh?.cancel(); refresh = nil; browser?.cancel()
        let previous = try? storedCredentials()
        try CloudLibraryKeychain.save(nil, account: "tokens")
        guard let previous else { return true }
        do {
            let metadata = try await discovery()
            var request = URLRequest(url: metadata.revocation_endpoint)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = CloudLibraryOAuth.form(["token": previous.refreshToken, "token_type_hint": "refresh_token", "client_id": previous.clientID])
            _ = try await checkedData(request)
            return true
        } catch { return false }
    }

    private func storedCredentials() throws -> Credentials {
        guard let data = try CloudLibraryKeychain.read(account: "tokens"),
              let value = try? JSONDecoder().decode(Credentials.self, from: data),
              !value.clientID.isEmpty, !value.accessToken.isEmpty, !value.refreshToken.isEmpty else {
            throw FeedbackFailure("Sign in to private library sync first")
        }
        return value
    }

    private func discovery() async throws -> CloudLibraryOAuth.Discovery {
        let body = try await checkedData(URLRequest(url: CloudLibraryOAuth.discovery))
        return try JSONDecoder().decode(CloudLibraryOAuth.Discovery.self, from: body).validated()
    }

    private func registeredClient(metadata: CloudLibraryOAuth.Discovery) async throws -> String {
        if let data = try CloudLibraryKeychain.read(account: "client"), let id = String(data: data, encoding: .utf8), !id.isEmpty { return id }
        var request = URLRequest(url: metadata.registration_endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["client_name": "manaDJ iPhone private library sync",
            "redirect_uris": [CloudLibraryOAuth.redirect], "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"], "token_endpoint_auth_method": "none", "resource": CloudLibraryOAuth.resource.absoluteString])
        let registration = try JSONDecoder().decode(Registration.self, from: try await checkedData(request))
        guard !registration.client_id.isEmpty, registration.client_id.count <= 1024,
              registration.redirect_uris == [CloudLibraryOAuth.redirect], registration.token_endpoint_auth_method == "none" else {
            throw FeedbackFailure("Cloud sign-in registration did not match this app")
        }
        try CloudLibraryKeychain.save(Data(registration.client_id.utf8), account: "client")
        return registration.client_id
    }

    private func token(metadata: CloudLibraryOAuth.Discovery, fields: [String: String]) async throws -> TokenResponse {
        var request = URLRequest(url: metadata.token_endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = CloudLibraryOAuth.form(fields)
        return try JSONDecoder().decode(TokenResponse.self, from: try await checkedData(request))
    }

    private func makeCredentials(_ reply: TokenResponse, clientID: String, priorRefresh: String?) throws -> Credentials {
        guard reply.token_type.lowercased() == "bearer", !reply.access_token.isEmpty,
              reply.access_token.count <= 16384, reply.expires_in.isFinite,
              reply.expires_in > 0, reply.expires_in <= 86400,
              let refresh = reply.refresh_token ?? priorRefresh, !refresh.isEmpty, refresh.count <= 16384 else {
            throw FeedbackFailure("Cloud sign-in returned an incomplete session")
        }
        return Credentials(clientID: clientID, accessToken: reply.access_token, refreshToken: refresh,
            expiresAt: Date().addingTimeInterval(reply.expires_in))
    }

    private func checkedData(_ request: URLRequest) async throws -> Data {
        do {
            let (data, response) = try await http.data(for: request)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), data.count <= 65536 else {
                throw FeedbackFailure("Private library cloud sign-in is unavailable or needs a fresh login")
            }
            return data
        } catch is CancellationError { throw CancellationError() }
        catch { throw FeedbackFailure("Private library cloud sign-in is unavailable or needs a fresh login") }
    }

    private func authenticate(_ url: URL) async throws -> URL {
        let currentGeneration = generation
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "earth.murtaza.manadj.ios") { [weak self] callback, error in
                    Task { @MainActor in
                        self?.browser = nil
                        if let callback { continuation.resume(returning: callback) }
                        else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { continuation.resume(throwing: CancellationError()) }
                        else { continuation.resume(throwing: FeedbackFailure("Cloud sign-in did not finish")) }
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = true
                browser = session
                if !session.start() {
                    browser = nil
                    continuation.resume(throwing: FeedbackFailure("Could not open cloud sign-in"))
                }
            }
        } onCancel: { [weak self] in
            Task { @MainActor in
                guard let self, self.generation == currentGeneration else { return }
                self.browser?.cancel()
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    private static func randomURLSafe() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw FeedbackFailure("Could not prepare secure cloud sign-in")
        }
        return base64URL(Data(bytes))
    }
    private static func challenge(_ verifier: String) -> String { base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private static func startsAlphanumeric(_ value: String) -> Bool {
        value.utf8.first.map { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) } ?? false
    }
}

private final class CloudLibraryNoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private enum CloudLibraryKeychain {
    static func read(account: String) throws -> Data? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw FeedbackFailure("Private library cloud credentials are unavailable") }
        return data
    }
    static func save(_ data: Data?, account: String) throws {
        let query = base(account)
        guard let data else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw FeedbackFailure("Could not remove private cloud credentials") }
            return
        }
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw FeedbackFailure("Could not update private cloud credentials") }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw FeedbackFailure("Could not save private cloud credentials") }
    }
    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "earth.murtaza.manadj.ios.library.oauth", kSecAttrAccount as String: account]
    }
}
