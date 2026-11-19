import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testStandardWorkspaceSettingsAndPitch() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["BROWSE"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["A play pause"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["PERFORM"].exists)
        XCTAssertFalse(app.buttons["LIBRARY"].exists)
        let play = app.buttons["A play pause"]
        XCTAssertTrue(play.waitForExistence(timeout: 5)); play.tap()
        let wave = app.otherElements["A detail wave"]
        let playing = NSPredicate(format: "value BEGINSWITH %@", "playing")
        expectation(for: playing, evaluatedWith: wave); waitForExpectations(timeout: 8)
        Thread.sleep(forTimeInterval: 4)
        play.tap()
        let paused = NSPredicate(format: "value BEGINSWITH %@", "paused")
        expectation(for: paused, evaluatedWith: wave); waitForExpectations(timeout: 8)
        let portrait = XCTAttachment(screenshot: app.screenshot()); portrait.name = "Android-structure iOS portrait WIP"; portrait.lifetime = .keepAlways; add(portrait)
        let pitchButton = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "PITCH")).firstMatch
        XCTAssertLessThanOrEqual(pitchButton.frame.maxY, app.frame.maxY - 16, "Pitch control must stay above bottom safe area")
        XCTAssertTrue(pitchButton.isHittable)
        pitchButton.tap()
        XCTAssertTrue(app.buttons["Close pitch panel"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        let pitch = XCTAttachment(screenshot: app.screenshot()); pitch.name = "iOS one-deck pitch overlay WIP"; pitch.lifetime = .keepAlways; add(pitch)
        app.buttons["Close pitch panel"].firstMatch.tap()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["Desktop address"].waitForExistence(timeout: 5))
        app.buttons["CLOSE"].tap()
        app.buttons["BROWSE"].tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        let browse = XCTAttachment(screenshot: app.screenshot()); browse.name = "iOS in-place browser with transport WIP"; browse.lifetime = .keepAlways; add(browse)
    }
    @MainActor func testLiveMixerControlsRespondAndRecover() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let play = app.buttons["A play pause"]
        XCTAssertTrue(play.waitForExistence(timeout: 20))
        let fader = app.otherElements["A channel fader"]
        XCTAssertTrue(fader.waitForExistence(timeout: 5))
        let initial = fader.value as? String ?? ""
        fader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).press(forDuration: 0.1, thenDragTo: fader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)))
        let changed = NSPredicate(format: "value != %@", initial)
        expectation(for: changed, evaluatedWith: fader); waitForExpectations(timeout: 5)
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "LOOP")).firstMatch.tap()
        let cue = app.buttons["A hotcue 1"]
        XCTAssertTrue(cue.exists); cue.press(forDuration: 0.4)
        let eq = app.otherElements["HI control"].firstMatch
        XCTAssertTrue(eq.exists); eq.doubleTap()
        expectation(for: NSPredicate(format: "value == %@", "0.00"), evaluatedWith: eq); waitForExpectations(timeout: 5)
        eq.doubleTap()
        let bend = app.buttons["Momentary pitch bend"].firstMatch
        XCTAssertTrue(bend.exists)
        bend.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).press(forDuration: 0.3)
        expectation(for: NSPredicate(format: "value == %@", "+0.0 percent"), evaluatedWith: bend); waitForExpectations(timeout: 5)
        play.tap()
        let wave = app.otherElements["A detail wave"]
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "playing"), evaluatedWith: wave); waitForExpectations(timeout: 5)
        Thread.sleep(forTimeInterval: 2)
        play.tap()
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "paused"), evaluatedWith: wave); waitForExpectations(timeout: 5)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Live mixer gesture and transport recovery"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testLibrarySearchAcceptedAndRefusedLoads() {
        let app = XCUIApplication()
        app.launchArguments = ["--library-ui-fixture"]
        app.launch()
        app.buttons["BROWSE"].tap()
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
        let visibleResult = app.staticTexts["Cached Test Tone"]
        XCTAssertTrue(visibleResult.exists)
        XCTAssertTrue(visibleResult.isHittable, "Matching tracks must remain selectable above the keyboard")
        XCTAssertLessThan(visibleResult.frame.maxY, app.keyboards.firstMatch.frame.minY, "Results must not sit behind the keyboard")
        let refused = XCTAttachment(screenshot: app.screenshot())
        refused.name = "Synthetic library - refused offline load preserves search"
        refused.lifetime = .keepAlways; add(refused)
        app.buttons["Clear search"].tap()
        XCTAssertEqual(search.value as? String, "Search title, artist, file")
        XCTAssertFalse(app.buttons["Clear search"].exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        search.typeText("Cached")
        app.staticTexts["Cached Test Tone"].tap()
        XCTAssertTrue(app.buttons["BROWSE"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        let accepted = XCTAttachment(screenshot: app.screenshot())
        accepted.name = "Synthetic library - accepted load returns to Perform"
        accepted.lifetime = .keepAlways; add(accepted)
    }
}
