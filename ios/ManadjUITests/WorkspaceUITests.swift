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
    @MainActor func testLibrarySearchAcceptedAndRefusedLoads() {
        let app = XCUIApplication()
        app.launchArguments = ["--library-ui-fixture"]
        app.launch()
        app.buttons["LIBRARY"].tap()
        let search = app.textFields["Search title, artist, file"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        // Fresh simulator keyboards may show the system slide-to-type tutorial.
        let keyboardContinue = app.buttons["Continue"]
        if keyboardContinue.waitForExistence(timeout: 2) { keyboardContinue.tap() }
        search.typeText("Test Tone")
        XCTAssertTrue(app.buttons["Clear search"].exists)
        app.staticTexts["Offline Test Tone"].tap()
        XCTAssertTrue(app.alerts["manaDJ"].waitForExistence(timeout: 5))
        app.alerts["manaDJ"].buttons["OK"].tap()
        // The tutorial can be deferred until the alert relinquishes the keyboard.
        if keyboardContinue.waitForExistence(timeout: 2) { keyboardContinue.tap() }
        XCTAssertTrue(app.keys["a"].waitForExistence(timeout: 5))
        XCTAssertTrue(search.exists)
        XCTAssertEqual(search.value as? String, "Test Tone")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let refused = XCTAttachment(screenshot: app.screenshot())
        refused.name = "Synthetic library - refused offline load preserves search"
        refused.lifetime = .keepAlways; add(refused)
        app.buttons["Clear search"].tap()
        XCTAssertEqual(search.value as? String, "Search title, artist, file")
        XCTAssertFalse(app.buttons["Clear search"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        search.typeText("Cached")
        app.staticTexts["Cached Test Tone"].tap()
        XCTAssertTrue(app.buttons["A / B"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        let accepted = XCTAttachment(screenshot: app.screenshot())
        accepted.name = "Synthetic library - accepted load returns to Perform"
        accepted.lifetime = .keepAlways; add(accepted)
    }
}
