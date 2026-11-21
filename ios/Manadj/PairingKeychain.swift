import Foundation
import Security

/// Pairing tokens stay in the device Keychain, never UserDefaults, source, logs or exports.
enum PairingKeychain {
    static func token(for origin: String) -> String? {
        var query = base(origin)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String?, origin: String) throws {
        let query = base(origin)
        guard let token else { SecItemDelete(query as CFDictionary); return }
        let value = [kSecValueData as String: Data(token.utf8)]
        let updated = SecItemUpdate(query as CFDictionary, value as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw AppFailure("Could not update pairing securely") }
        var new = query
        new[kSecValueData as String] = Data(token.utf8)
        new[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(new as CFDictionary, nil) == errSecSuccess else { throw AppFailure("Could not save pairing securely") }
    }
    private static func base(_ origin: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.manadj.ios.desktop", kSecAttrAccount as String: origin]
    }
}

struct AppFailure: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
