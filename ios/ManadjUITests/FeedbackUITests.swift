import XCTest

/// The simulator has no accelerometer, so --feedback-ui-fixture presents the
/// review sheet directly; shake itself is device-only coverage.
final class FeedbackUITests: XCTestCase {
    @MainActor private func captureFailure() {
        if testRun?.hasSucceeded == false {
            let app = XCUIApplication()
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "Failure accessibility hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "Failure screen"; shot.lifetime = .keepAlways; add(shot)
        }
    }

    @MainActor func testReviewSheetListsContextAndQueuesWithoutPairing() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--performance-ui-fixture", "--feedback-ui-fixture"]
        app.launch()
        let sheet = app.otherElements["feedback-review"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 15), "shake review sheet must present")

        // The captured context is visible before anything can be filed.
        XCTAssertTrue(app.buttons["feedback-open-outbox"].exists)
        XCTAssertTrue(app.buttons["REMOVE IMAGE"].exists || app.otherElements["feedback-canvas"].exists,
                      "screenshot review must be present")

        let canvas = XCTAttachment(screenshot: app.screenshot())
        canvas.name = "Feedback review sheet with context sections"; canvas.lifetime = .keepAlways; add(canvas)

        let title = app.textFields["feedback-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap(); title.typeText("Deck A froze")
        // The fixture is unpaired: filing must queue on-device, never fail open.
        let submit = app.buttons["feedback-submit"]
        for _ in 0..<12 { if submit.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(submit.isHittable)
        submit.tap()
        let outcome = app.otherElements["feedback-outcome"]
        XCTAssertTrue(outcome.waitForExistence(timeout: 15), "an explicit outcome must be shown")
        XCTAssertTrue(app.staticTexts["SAVED ON THIS IPHONE"].waitForExistence(timeout: 5),
                      "unpaired filing must be queued locally, got: \(outcome.debugDescription)")

        let filed = XCTAttachment(screenshot: app.screenshot())
        filed.name = "Feedback queued outcome"; filed.lifetime = .keepAlways; add(filed)
    }

    @MainActor func testBlankTitleCannotSubmit() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--performance-ui-fixture", "--feedback-ui-fixture"]
        app.launch()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 15))
        let submit = app.buttons["feedback-submit"]
        for _ in 0..<12 { if submit.exists { break }; app.swipeUp() }
        XCTAssertFalse(submit.isEnabled, "a blank title must not file")
    }
}
