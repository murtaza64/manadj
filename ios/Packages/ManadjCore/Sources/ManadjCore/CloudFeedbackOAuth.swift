import Foundation

/// Only the owner's configured Access application. Never accepts an alternate
/// origin or redirect from report content, a callback, or a stored draft.
public enum CloudFeedbackOAuth {
    public static let resource = URL(string: "https://manadj-private-feedback.murtaza-javaid.workers.dev")!
    public static let issuer = "https://frosty-pond-8fd5.cloudflareaccess.com"
    public static let redirect = "earth.murtaza.manadj.ios:/oauth/feedback/callback"
    public static let discovery = resource.appendingPathComponent(".well-known/oauth-authorization-server")

    public struct Discovery: Decodable, Sendable {
        public let issuer: String
        public let authorization_endpoint: URL
        public let token_endpoint: URL
        public let registration_endpoint: URL
        public let revocation_endpoint: URL
        public let code_challenge_methods_supported: [String]
        public let token_endpoint_auth_methods_supported: [String]
        public let grant_types_supported: [String]

        public func validated() throws -> Self {
            guard issuer == CloudFeedbackOAuth.issuer,
                  authorization_endpoint.absoluteString == issuer + "/cdn-cgi/access/oauth/authorization",
                  token_endpoint.absoluteString == issuer + "/cdn-cgi/access/oauth/token",
                  registration_endpoint.absoluteString == issuer + "/cdn-cgi/access/oauth/registration",
                  revocation_endpoint.absoluteString == issuer + "/cdn-cgi/access/oauth/revoke",
                  code_challenge_methods_supported.contains("S256"),
                  token_endpoint_auth_methods_supported.contains("none"),
                  grant_types_supported.contains("authorization_code"), grant_types_supported.contains("refresh_token") else {
                throw FeedbackFailure("Cloud sign-in configuration did not match the private feedback service")
            }
            return self
        }
    }

    public static func authorizationURL(metadata: Discovery, clientID: String, state: String, challenge: String) throws -> URL {
        let metadata = try metadata.validated()
        guard !clientID.isEmpty, !state.isEmpty, !challenge.isEmpty else { throw FeedbackFailure("Cloud sign-in could not start") }
        var parts = URLComponents(url: metadata.authorization_endpoint, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID), URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "resource", value: resource.absoluteString), URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "code_challenge_method", value: "S256")]
        guard let url = parts.url else { throw FeedbackFailure("Cloud sign-in URL was invalid") }
        return url
    }

    public static func authorizationCode(callback: URL, expectedState: String) throws -> String {
        guard let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.scheme == "earth.murtaza.manadj.ios", parts.host == nil,
              parts.path == "/oauth/feedback/callback", parts.fragment == nil,
              parts.user == nil, parts.password == nil, parts.port == nil,
              !expectedState.isEmpty else { throw FeedbackFailure("Cloud sign-in returned to an unexpected address") }
        let items = parts.queryItems ?? []
        let states = items.filter { $0.name == "state" }
        let codes = items.filter { $0.name == "code" }
        guard states.count == 1, states.first?.value == expectedState,
              !items.contains(where: { $0.name == "error" }), codes.count == 1,
              let code = codes.first?.value, !code.isEmpty else {
            throw FeedbackFailure("Cloud sign-in was declined or could not be verified")
        }
        return code
    }

    /// RFC 6749 application/x-www-form-urlencoded. Encodes plus, ampersand,
    /// equals, Unicode and redirects without turning them into form separators.
    public static func form(_ fields: [String: String]) -> Data {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        return Data(fields.sorted(by: { $0.key < $1.key }).map {
            $0.key.addingPercentEncoding(withAllowedCharacters: allowed)! + "=" + $0.value.addingPercentEncoding(withAllowedCharacters: allowed)!
        }.joined(separator: "&").utf8)
    }
}
