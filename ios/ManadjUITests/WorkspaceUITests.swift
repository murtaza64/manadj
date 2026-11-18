import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testWorkspaceAndSettings() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["PERFORM"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["A / B"].exists)
        app.buttons["C / D"].tap()
        XCTAssertTrue(app.buttons["Load deck C"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "manaDJ actual iOS simulator workspace"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["SETTINGS"].tap()
        XCTAssertTrue(app.textFields["Desktop address"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["PAIR IPHONE"].exists)
        let settings = XCTAttachment(screenshot: app.screenshot())
        settings.name = "manaDJ actual iOS simulator settings"
        settings.lifetime = .keepAlways
        add(settings)
    }
}
