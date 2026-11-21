import XCTest

/// The simulator has no accelerometer, so --feedback-ui-fixture presents the
/// review sheet directly; shake itself is device-only coverage.
final class FeedbackUITests: XCTestCase {
    @MainActor func testExplicitButtonPicksTargetDrawsAndCancelsWithoutFiling() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--performance-ui-fixture"]
        app.launch()
        let open = app.buttons["feedback-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        let deck = app.descendants(matching: .any).matching(identifier: "deck-0-info").firstMatch.frame
        let screen = app.frame
        let point = CGVector(dx: deck.midX / screen.width, dy: deck.midY / screen.height)
        let workspace = XCTAttachment(screenshot: app.screenshot())
        workspace.name = "Workspace explicit feedback button"; workspace.lifetime = .keepAlways; add(workspace)
        open.tap()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 10))
        let pick = app.buttons["feedback-pick-element"]
        for _ in 0..<5 { if pick.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(pick.isHittable)
        pick.tap()
        let picker = app.otherElements["feedback-target-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        let pickerCanvas = picker.descendants(matching: .any).matching(identifier: "feedback-canvas").firstMatch
        XCTAssertTrue(pickerCanvas.exists)
        let pickShot = XCTAttachment(screenshot: app.screenshot())
        pickShot.name = "Full screen frozen screenshot target picker"; pickShot.lifetime = .keepAlways; add(pickShot)
        pickerCanvas.coordinate(withNormalizedOffset: point).tap()
        let canvas = app.otherElements["feedback-review"].descendants(matching: .any).matching(identifier: "feedback-canvas").firstMatch
        let target = app.staticTexts["feedback-selected-target"]
        XCTAssertTrue(target.waitForExistence(timeout: 5))
        XCTAssertTrue(target.label.contains("Deck A track info"), target.label)
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2))
            .press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.7)))
        XCTAssertTrue(app.buttons["UNDO"].isEnabled)
        let marked = XCTAttachment(screenshot: app.screenshot())
        marked.name = "Feedback named target and freehand drawing"; marked.lifetime = .keepAlways; add(marked)
        app.buttons["CLEAR TARGET"].tap()
        XCTAssertFalse(target.exists)
        app.buttons["CANCEL"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        open.tap()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 10))
        app.buttons["feedback-open-outbox"].tap()
        XCTAssertTrue(app.staticTexts["No saved reports."].waitForExistence(timeout: 5), "Picking/drawing/cancelling must not queue or send")
    }

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
