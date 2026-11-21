import XCTest

final class FeedbackUITests: XCTestCase {
    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor private func field(_ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any).matching(identifier: "feedback-title").firstMatch }
    @MainActor func testExplicitButtonPicksTargetDrawsAndCancelsWithoutFiling() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let open = app.buttons["feedback-open"]; XCTAssertTrue(open.waitForExistence(timeout: 15))
        let deck = app.descendants(matching: .any).matching(identifier: "deck-0-info").firstMatch.frame
        let screen = app.frame
        capture("Before inline feedback, current workspace", app: app)
        open.tap()
        let toolbar = app.otherElements["feedback-live-toolbar"]
        XCTAssertTrue(toolbar.waitForExistence(timeout: 10))
        capture("Live feedback toolbar in center FX slot, mixing controls stay active", app: app)
        XCTAssertFalse(app.otherElements["feedback-review"].exists)
        app.buttons["BROWSE"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        XCTAssertTrue(toolbar.exists)
        app.buttons["BROWSE"].firstMatch.tap()
        app.buttons["feedback-review-open"].tap()
        let review = app.otherElements["feedback-review"]; XCTAssertTrue(review.waitForExistence(timeout: 10))
        let card = app.otherElements["feedback-comment-card"]; XCTAssertTrue(card.exists)
        XCTAssertLessThan(card.frame.height, screen.height * 0.5, "Initial feedback must be a small card, not a new screen")
        capture("Inline feedback small comment card over captured workspace", app: app)
        app.buttons["feedback-pick-element"].tap()
        // Frozen full-screen pointing never presses the real deck control.
        app.coordinate(withNormalizedOffset: CGVector(dx: deck.midX / screen.width, dy: deck.midY / screen.height)).tap()
        let target = app.staticTexts["feedback-selected-target"]
        XCTAssertTrue(target.waitForExistence(timeout: 5)); XCTAssertTrue(target.label.contains("Deck A track info"), target.label)
        let canvas = app.descendants(matching: .any).matching(identifier: "feedback-canvas").firstMatch
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.25)).press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.4)))
        XCTAssertTrue(app.buttons["UNDO"].isEnabled)
        capture("Point and draw in place, same compact feedback card", app: app)
        app.buttons["Move feedback card"].tap(); capture("Feedback card moved to reveal lower controls", app: app)
        app.buttons["CLEAR TARGET"].tap(); XCTAssertFalse(target.exists)
        app.buttons["CANCEL"].tap(); XCTAssertTrue(open.waitForExistence(timeout: 5))
        open.tap(); app.buttons["feedback-review-open"].tap(); app.buttons["feedback-open-outbox"].tap()
        XCTAssertTrue(app.staticTexts["No saved reports."].waitForExistence(timeout: 5))
    }
    @MainActor func testReviewSheetListsContextAndQueuesWithoutPairing() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture", "--feedback-ui-fixture"]; app.launch()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 15))
        let comment = field(app); XCTAssertTrue(comment.exists); comment.tap(); comment.typeText("Deck A froze")
        let hide = app.buttons["feedback-hide-keyboard"]; XCTAssertTrue(hide.waitForExistence(timeout: 5)); hide.tap()
        app.buttons["feedback-show-details"].tap(); capture("Optional exact context review in compact feedback surface", app: app)
        app.buttons["feedback-show-details"].tap()
        app.buttons["feedback-submit"].tap()
        XCTAssertFalse(app.sheets.firstMatch.exists, "No second confirmation after the reviewed save")
        XCTAssertTrue(app.staticTexts["feedback-center-delivery"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.otherElements["feedback-review"].exists, "Send hides the review drawer")
        app.buttons["feedback-review-open"].tap()
        XCTAssertTrue(app.staticTexts["SAVED ON THIS IPHONE"].waitForExistence(timeout: 5))
        capture("Saved locally without an automatic later send", app: app)
        app.buttons["feedback-open-outbox"].tap()
        XCTAssertFalse(app.buttons["REVIEWED · SEND TO THIS DESKTOP"].exists)
        XCTAssertTrue(app.buttons["DISCARD THIS SAVED REPORT"].waitForExistence(timeout: 5))
    }
    @MainActor func testActionsAndTypedFeedbackNeedNoVoiceOrMicrophonePermission() {
        let app = XCUIApplication()
        app.resetAuthorizationStatus(for: .microphone)
        app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let open = app.buttons["feedback-open"]; XCTAssertTrue(open.waitForExistence(timeout: 15)); open.tap()
        let rec = app.buttons["feedback-rec"]
        XCTAssertEqual(rec.label, "REC", "Voice remains optional")
        app.buttons["deck-0-loop-toggle"].tap()
        app.buttons["browser-open"].tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        app.buttons["browser-close"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertFalse(springboard.alerts.firstMatch.exists, "Actions must not request microphone access")
        app.buttons["feedback-review-open"].tap()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["feedback-play-voice"].exists)
        let comment = field(app); comment.tap(); comment.typeText("Typed feedback after using loop and browser, no voice")
        app.buttons["feedback-hide-keyboard"].tap()
        app.buttons["feedback-show-details"].tap()
        XCTAssertTrue(app.staticTexts["RECENT ACTIONS & SESSION"].exists)
        capture("Actions plus typed feedback with microphone permission untouched", app: app)
        app.buttons["feedback-show-details"].tap()
        XCTAssertTrue(app.buttons["feedback-submit"].isEnabled)
        app.buttons["feedback-submit"].tap()
        XCTAssertTrue(app.staticTexts["feedback-center-delivery"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.otherElements["feedback-review"].exists)
        XCTAssertFalse(app.sheets.firstMatch.exists)
        app.buttons["feedback-review-open"].tap()
        XCTAssertTrue(app.staticTexts["SAVED ON THIS IPHONE"].waitForExistence(timeout: 5))
        XCTAssertFalse(springboard.alerts.firstMatch.exists, "Typing and saving must not request microphone access")
        capture("Typed action report saved without recording voice", app: app)
    }
    @MainActor func testReceiptStateAllowsFreshReportWithoutReopeningFeedback() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture", "--feedback-receipt-ui-fixture"]; app.launch()
        app.buttons["feedback-open"].tap(); app.buttons["feedback-review-open"].tap()
        let comment = field(app); XCTAssertTrue(comment.waitForExistence(timeout: 10))
        comment.tap(); comment.typeText("First synthetic receipt report")
        app.buttons["feedback-hide-keyboard"].tap(); app.buttons["feedback-submit"].tap()
        XCTAssertTrue(app.otherElements["feedback-center-sending"].waitForExistence(timeout: 2))
        XCTAssertFalse(app.otherElements["feedback-review"].exists)
        XCTAssertFalse(app.sheets.firstMatch.exists)
        let delivered = app.staticTexts["feedback-center-delivery"]
        XCTAssertTrue(delivered.waitForExistence(timeout: 8)); XCTAssertTrue(delivered.label.contains("RECEIVED ON DESKTOP"))
        XCTAssertTrue(app.otherElements["feedback-live-toolbar"].exists)
        app.buttons["feedback-review-open"].tap()
        XCTAssertTrue(comment.waitForExistence(timeout: 5))
        XCTAssertFalse((comment.value as? String ?? "").contains("First synthetic"), "Receipt resets the comment for a new report")
        XCTAssertFalse(app.buttons["feedback-submit"].isEnabled)
        comment.tap(); comment.typeText("Second report without closing feedback")
        app.buttons["feedback-hide-keyboard"].tap()
        XCTAssertTrue(app.buttons["feedback-submit"].isEnabled)
        capture("Synthetic receipt state permits fresh typed report without reopening", app: app)
    }
    @MainActor func testBlankTitleCannotSubmit() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture", "--feedback-ui-fixture"]; app.launch()
        XCTAssertTrue(app.otherElements["feedback-review"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["feedback-submit"].isEnabled)
        app.buttons["CANCEL"].tap()
        XCTAssertTrue(app.buttons["feedback-open"].waitForExistence(timeout: 5))
    }
    @MainActor func testExplicitNarrationKeepsBrowserLiveAndReviewsRawVoice() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let open = app.buttons["feedback-open"]; XCTAssertTrue(open.waitForExistence(timeout: 15)); open.tap()
        let rec = app.buttons["feedback-rec"]; XCTAssertEqual(rec.label, "REC", "Opening feedback must not record")
        let play = app.buttons["A play pause"]
        let ready = expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: play)
        wait(for: [ready], timeout: 20)
        app.buttons["deck-0-loop-toggle"].tap(); play.tap()
        let wave = app.otherElements["deck-0-detail-wave"]
        let playing = expectation(for: NSPredicate(format: "value BEGINSWITH 'playing'"), evaluatedWith: wave)
        wait(for: [playing], timeout: 5)
        rec.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let permission = springboard.alerts.firstMatch
        if permission.waitForExistence(timeout: 3) {
            if permission.buttons["Allow"].exists { permission.buttons["Allow"].tap() }
            else if permission.buttons["OK"].exists { permission.buttons["OK"].tap() }
        }
        let stopped = expectation(for: NSPredicate(format: "label == 'STOP'"), evaluatedWith: rec)
        wait(for: [stopped], timeout: 10)
        XCTAssertGreaterThanOrEqual(rec.frame.height, 44, "Stop must retain an effective44point target")
        XCTAssertGreaterThanOrEqual(app.buttons["feedback-review-open"].frame.height, 44)
        XCTAssertTrue(rec.isHittable)
        XCTAssertTrue((wave.value as? String ?? "").hasPrefix("playing"), "Explicit narration must not force a playing deck to pause")
        capture("Explicit Rec active with Stop reachable", app: app)
        app.buttons["BROWSE"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        XCTAssertTrue(rec.exists); XCTAssertEqual(rec.label, "STOP")
        capture("Narrating while the real browser is interactive", app: app)
        rec.tap()
        if permission.waitForExistence(timeout: 3) {
            if permission.buttons["Allow"].exists { permission.buttons["Allow"].tap() }
            else if permission.buttons["OK"].exists { permission.buttons["OK"].tap() }
        }
        XCTAssertTrue((wave.value as? String ?? "").hasPrefix("playing"), "Stop narration must leave the looping deck playing")
        app.buttons["feedback-review-open"].tap()
        let playback = app.buttons["feedback-play-voice"]; XCTAssertTrue(playback.waitForExistence(timeout: 10))
        capture("Stopped local raw voice is included in review before any send", app: app)
        playback.tap()
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Voice could not play:'")).firstMatch.exists)
        app.buttons["feedback-remove-voice"].tap()
        XCTAssertFalse(playback.exists)
        app.buttons["CANCEL"].tap()
    }

}
