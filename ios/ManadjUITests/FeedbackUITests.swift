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
        let hideKeyboard = app.buttons["feedback-hide-keyboard"]
        XCTAssertTrue(hideKeyboard.waitForExistence(timeout: 5))
        hideKeyboard.tap()
        // The fixture is unpaired: filing must queue on-device, never fail open.
        let submit = app.buttons["feedback-submit"]
        // Drag the edge of the form, never the screenshot drawing surface.
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<16 {
            if submit.isHittable { break }
            scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.985, dy: 0.85))
                .press(forDuration: 0.05, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.985, dy: 0.2)))
        }
        guard submit.isHittable else { XCTFail("reviewed submit must be reachable"); return }
        submit.tap()
        let outcome = app.otherElements["feedback-outcome"]
        guard outcome.waitForExistence(timeout: 15) else { XCTFail("an explicit outcome must be shown"); return }
        XCTAssertFalse(app.keyboards.firstMatch.exists, "keyboard must not cover the saved outcome")
        XCTAssertTrue(app.staticTexts["SAVED ON THIS IPHONE"].waitForExistence(timeout: 5),
                      "unpaired filing must be queued locally, got: \(outcome.debugDescription)")

        let filed = XCTAttachment(screenshot: app.screenshot())
        filed.name = "Feedback queued outcome"; filed.lifetime = .keepAlways; add(filed)
        let reviewSaved = app.buttons["feedback-open-outbox"]
        for _ in 0..<12 { if reviewSaved.isHittable { break }; app.swipeDown() }
        reviewSaved.tap()
        XCTAssertTrue(app.staticTexts["No saved reports."].exists == false)
        XCTAssertFalse(app.buttons["REVIEWED · SEND TO THIS DESKTOP"].exists,
                       "unpaired saved report must not have a send destination")
        XCTAssertTrue(app.buttons["DISCARD THIS SAVED REPORT"].waitForExistence(timeout: 5))
        let held = XCTAttachment(screenshot: app.screenshot())
        held.name = "Saved report held for explicit destination review"; held.lifetime = .keepAlways; add(held)

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
