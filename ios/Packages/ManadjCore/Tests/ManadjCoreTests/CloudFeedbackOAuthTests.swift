import XCTest
@testable import ManadjCore

final class CloudFeedbackOAuthTests: XCTestCase {
    private var discovery: [String: Any] {
        let issuer = CloudFeedbackOAuth.issuer
        return ["issuer": issuer, "authorization_endpoint": issuer + "/cdn-cgi/access/oauth/authorization",
            "token_endpoint": issuer + "/cdn-cgi/access/oauth/token", "registration_endpoint": issuer + "/cdn-cgi/access/oauth/registration",
            "revocation_endpoint": issuer + "/cdn-cgi/access/oauth/revoke", "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"], "grant_types_supported": ["authorization_code", "refresh_token"]]
    }
    private func metadata(_ object: [String: Any]) throws -> CloudFeedbackOAuth.Discovery {
        try JSONDecoder().decode(CloudFeedbackOAuth.Discovery.self, from: JSONSerialization.data(withJSONObject: object))
    }
    func testExactDiscoveryAccepted() throws { _ = try metadata(discovery).validated() }
    func testDiscoveryEndpointReplacementRejected() throws {
        for field in ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"] {
            for endpoint in ["http://frosty-pond-8fd5.cloudflareaccess.com/cdn-cgi/access/oauth/token", "https://synthetic.invalid/oauth/token",
                             CloudFeedbackOAuth.issuer + "/alternate", CloudFeedbackOAuth.issuer + "/cdn-cgi/access/oauth/token?next=other"] {
                var object = discovery; object[field] = endpoint
                XCTAssertThrowsError(try metadata(object).validated(), field + " must stay pinned")
            }
        }
    }
    func testMissingPKCEPublicClientRefreshOrWrongIssuerRejected() throws {
        for (field, value) in [("code_challenge_methods_supported", ["plain"] as Any),
            ("token_endpoint_auth_methods_supported", ["client_secret_post"] as Any),
            ("grant_types_supported", ["authorization_code"] as Any), ("issuer", "https://synthetic.invalid" as Any)] {
            var object = discovery; object[field] = value
            XCTAssertThrowsError(try metadata(object).validated())
        }
    }
    func testAuthorizationURLPinsResourceRedirectAndS256() throws {
        let url = try CloudFeedbackOAuth.authorizationURL(metadata: metadata(discovery), clientID: "synthetic+client&", state: "synthetic-state", challenge: "synthetic-challenge")
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let fields = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(url.host, "frosty-pond-8fd5.cloudflareaccess.com")
        XCTAssertEqual(fields["client_id"], "synthetic+client&")
        XCTAssertEqual(fields["redirect_uri"], CloudFeedbackOAuth.redirect)
        XCTAssertEqual(fields["resource"], CloudFeedbackOAuth.resource.absoluteString)
        XCTAssertEqual(fields["state"], "synthetic-state"); XCTAssertEqual(fields["code_challenge_method"], "S256")
        XCTAssertEqual(fields["response_type"], "code")
        XCTAssertThrowsError(try CloudFeedbackOAuth.authorizationURL(metadata: metadata(discovery), clientID: "", state: "state", challenge: "challenge"))
    }
    func testCallbackExactStateAndAddressRequired() throws {
        let callback = URL(string: CloudFeedbackOAuth.redirect + "?state=synthetic&code=synthetic-code")!
        XCTAssertEqual(try CloudFeedbackOAuth.authorizationCode(callback: callback, expectedState: "synthetic"), "synthetic-code")
        XCTAssertThrowsError(try CloudFeedbackOAuth.authorizationCode(callback: callback, expectedState: "different"))
        for value in ["earth.murtaza.manadj.ios://other/oauth/feedback/callback?state=synthetic&code=x",
            "earth.murtaza.manadj.ios:/oauth/feedback/other?state=synthetic&code=x",
            "other.app:/oauth/feedback/callback?state=synthetic&code=x",
            CloudFeedbackOAuth.redirect + "?state=synthetic&code=x#fragment",
            CloudFeedbackOAuth.redirect + "?state=synthetic&code=x&state=synthetic",
            CloudFeedbackOAuth.redirect + "?state=synthetic&code=x&code=y",
            CloudFeedbackOAuth.redirect + "?state=synthetic&code=x&error=denied",
            CloudFeedbackOAuth.redirect + "?state=synthetic&code="] {
            XCTAssertThrowsError(try CloudFeedbackOAuth.authorizationCode(callback: URL(string: value)!, expectedState: "synthetic"))
        }
    }
    func testFormNeverIntroducesCredentialSeparators() {
        let body = CloudFeedbackOAuth.form(["code": "synthetic+value&x=y", "redirect_uri": CloudFeedbackOAuth.redirect, "unicode": "a b雪"])
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("code=synthetic%2Bvalue%26x%3Dy"))
        XCTAssertTrue(text.contains("unicode=a%20b%E9%9B%AA"))
        XCTAssertEqual(text.filter { $0 == "&" }.count, 2)
        XCTAssertFalse(text.contains(CloudFeedbackOAuth.redirect))
    }
}
