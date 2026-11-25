import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor private func waitForReadyTransport(_ play: XCUIElement, app: XCUIApplication) {
        let ready = NSPredicate(format: "enabled == true AND hittable == true")
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: play)], timeout: 20)
        XCTAssertEqual(result, .completed, "Transport must be ready before tapping")
        let wave = app.otherElements["deck-0-detail-wave"]
        XCTAssertTrue(wave.waitForExistence(timeout: 5))
        XCTAssertTrue((wave.value as? String ?? "").hasPrefix("paused"), "Expected loaded paused wave, got \(String(describing: wave.value))")
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

    @MainActor func testAndroidHeightReferenceKeepsCenterAndTransportReachable() {
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["A play pause"].waitForExistence(timeout: 20))
        let a = app.otherElements["deck-0-detail-wave"], b = app.otherElements["deck-1-detail-wave"]
        XCTAssertTrue(a.waitForExistence(timeout: 5)); XCTAssertTrue(b.exists)
        // Android compact portrait uses50dp per deck, not50dp for both.
        if app.frame.height >= 800 {
            XCTAssertGreaterThanOrEqual(a.frame.height, 49)
            XCTAssertGreaterThanOrEqual(b.frame.height, 49)
        }
        for name in ["Sessions", "Settings", "Record master", "Saved recordings", "A play pause", "B play pause"] {
            let button = app.buttons[name]
            XCTAssertTrue(button.isHittable, name)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, name)
            XCTAssertLessThanOrEqual(button.frame.maxY, app.frame.maxY - 20, name)
        }
        let recording = app.buttons["Record master"].frame
        XCTAssertEqual(recording.minY, app.buttons["Settings"].frame.minY, accuracy: 1)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Wave height preview, Android dimension reference, actual iOS workspace"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["BROWSE"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(a.frame.height, 49)
        let browse = XCTAttachment(screenshot: app.screenshot()); browse.name = "Wave height preview with browser drawer"; browse.lifetime = .keepAlways; add(browse)
    }

    @MainActor func testMetalPrototypeWorkspacePixelsAndFallbackStatus() {
        defer { captureFailure() }
        for metal in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = ["--performance-ui-fixture", "--wave-body-metrics"] + (metal ? ["--metal-waveform-prototype"] : [])
            app.launch()
            let a = app.buttons["A play pause"], b = app.buttons["B play pause"]
            XCTAssertTrue(a.waitForExistence(timeout: 20)); waitForReadyTransport(a, app: app)
            let bReady = NSPredicate(format: "enabled == true AND hittable == true")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: bReady, object: b)], timeout: 15), .completed)
            a.tap(); b.tap()
            let bPlaying = NSPredicate(format: "value BEGINSWITH %@", "playing")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: bPlaying, object: app.otherElements["deck-1-detail-wave"])], timeout: 5), .completed)
            let wave = app.otherElements["deck-0-detail-wave"]
            let measured = NSPredicate(format: "value CONTAINS %@", "waveBodySamples=120")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: measured, object: wave)], timeout: 20), .completed)
            let value = wave.value as? String ?? ""
            XCTAssertTrue(value.contains(metal ? "renderer=metal" : "renderer=coregraphics"), value)
            print("SYNTHETIC_WORKSPACE_" + value + " simulatorNotPhone=true")
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = metal ? "Metal opt-in full workspace two playing decks" : "Core Graphics full workspace two playing decks"
            shot.lifetime = .keepAlways; add(shot)
            // Keep the final app alive for deferred failure diagnostics. The
            // next launch replaces the first iteration's app on its own.
        }
    }

    /// Native callbacks/draw submissions, not presented frames or touch-to-photon.
    /// UI automation overhead is excluded from the interval probes, but the
    /// simulator host still affects scheduling. Never call these phone FPS.
    @MainActor func testScopedPositionObservationPacingABBA() {
        defer { captureFailure() }
        // ABBA holds plain icons, dual-deck loop, wave size and automation idle
        // fixed. It tests a cause, not a user-facing optimization or phone FPS.
        for (iteration, wholeTree) in [true, false, false, true].enumerated() {
            let app = XCUIApplication()
            app.launchArguments = ["--performance-ui-fixture", "--wave-pacing-metrics", "--wave-body-metrics", "--plain-center-tabs"]
                + (wholeTree ? ["--probe-whole-position-publication"] : [])
            app.launch()
            let playA = app.buttons["A play pause"], playB = app.buttons["B play pause"]
            XCTAssertTrue(playA.waitForExistence(timeout: 20)); waitForReadyTransport(playA, app: app)
            let ready = NSPredicate(format: "enabled == true AND hittable == true")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: playB)], timeout: 15), .completed)
            app.buttons["deck-0-loop-toggle"].tap(); app.buttons["deck-1-loop-toggle"].tap()
            playA.tap(); playB.tap()
            Thread.sleep(forTimeInterval: 14)
            for index in 0..<2 {
                let wave = app.otherElements["deck-\(index)-detail-wave"]
                let value = wave.value as? String ?? "missing"
                XCTAssertTrue(value.hasPrefix("playing"), value)
                XCTAssertTrue(value.contains("callbackSamples="), value)
                print("SCOPED_POSITION_OBSERVATION iteration=\(iteration) wholeTree=\(wholeTree) deck=\(index) \(value) simulatorNotPhone=true automationIdle14s=true")
            }
            if iteration < 3 { app.terminate() }
        }
    }

    @MainActor func testContinuousPlaybackDrawerAndGlassPacing() {
        defer { captureFailure() }
        for plain in [true, false] {
            let app = XCUIApplication()
            app.launchArguments = ["--performance-ui-fixture", "--wave-pacing-metrics"] + (plain ? ["--plain-center-tabs"] : [])
            app.launch()
            let playA = app.buttons["A play pause"], playB = app.buttons["B play pause"]
            XCTAssertTrue(playA.waitForExistence(timeout: 20)); waitForReadyTransport(playA, app: app)
            let ready = NSPredicate(format: "enabled == true AND hittable == true")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: playB)], timeout: 15), .completed)
            app.buttons["deck-0-loop-toggle"].tap(); app.buttons["deck-1-loop-toggle"].tap()
            playA.tap(); playB.tap()
            let wave = app.otherElements["deck-0-detail-wave"]
            Thread.sleep(forTimeInterval: 4)
            print("SYNTHETIC_PACING_IDLE plain=\(plain) \(wave.value ?? "missing") simulatorNotPhone=true")
            for _ in 0..<6 {
                app.buttons["browser-open"].tap()
                let search = app.textFields["Search title, artist, file"]
                XCTAssertTrue(search.waitForExistence(timeout: 5))
                let list = app.descendants(matching: .any)["library-track-list"].firstMatch
                if list.exists { list.swipeUp(velocity: .fast); list.swipeDown(velocity: .fast) }
                let close = app.buttons["browser-close"]
                // A downward swipe at the top now intentionally dismisses.
                if search.exists { XCTAssertTrue(close.isHittable); close.tap() }
                XCTAssertFalse(search.exists, "Either native top pull or Close must settle dismissed")
                let audio = app.buttons["center-tab-audio"]
                let audioTab = audio.exists ? audio : app.segmentedControls.buttons["Audio"]
                if audioTab.exists { audioTab.tap() }
                let fx = app.buttons["center-tab-fx"]
                let fxTab = fx.exists ? fx : app.segmentedControls.buttons["Fx"]
                if fxTab.exists { fxTab.tap() }
            }
            let aValue = wave.value as? String ?? "missing"
            let bValue = app.otherElements["deck-1-detail-wave"].value as? String ?? "missing"
            XCTAssertTrue(aValue.hasPrefix("playing"), aValue); XCTAssertTrue(bValue.hasPrefix("playing"), bValue)
            XCTAssertTrue(aValue.contains("callbackSamples="), aValue)
            print("SYNTHETIC_PACING_STRESS plain=\(plain) A=\(aValue) B=\(bValue) simulatorNotPhone=true rollingWindowMayOverlapIdle=true")
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = plain ? "Plain icons after continuous playback and drawer stress" : "Native segmented icons after continuous playback and drawer stress"
            shot.lifetime = .keepAlways; add(shot)
        }
    }

    @MainActor func testBrowserOpenResponsivenessSyntheticFixture() {
        let options = XCTMeasureOptions(); options.iterationCount = 3
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["BROWSE"].waitForExistence(timeout: 10))
        measure(metrics: [XCTClockMetric()], options: options) {
            app.buttons["browser-open"].tap()
            XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
            let list = app.descendants(matching: .any)["library-track-list"].firstMatch
            let timing = NSPredicate(format: "value BEGINSWITH %@", "nativeTapToRowAppearMs=")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: timing, object: list)], timeout: 5), .completed)
            print("SYNTHETIC_BROWSER_NATIVE \(list.value ?? "missing") excludesAutomationTapOverhead=true rowAppearNotPixels=true")
            app.buttons["browser-close"].tap()
        }
    }

    @MainActor func testSyncProgressShowsFileCountAndForegroundWarning() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--sync-progress-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        let count = app.staticTexts["sync-audio-progress"]
        XCTAssertTrue(count.waitForExistence(timeout: 10))
        XCTAssertEqual(count.label, "Audio: 3 of 10 files ready")
        XCTAssertTrue(app.staticTexts["Completed files, not bytes. Already cached files count as ready."].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Synthetic full-audio file progress - not device transfer proof"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testCenterTabsExposeRealPairingAndKeepControlsReachable() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["center-tab-sync"].waitForExistence(timeout: 15))
        for id in ["center-tab-fx", "feedback-open", "center-tab-audio", "center-tab-sync"] {
            let tab = app.buttons[id]; XCTAssertTrue(tab.isHittable); XCTAssertGreaterThanOrEqual(tab.frame.height, 44)
        }
        var shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Actual compact center tabs standard phone FX"; shot.lifetime = .keepAlways; add(shot)
        let beforeTransport = app.buttons["A play pause"].frame
        let beforePitch = app.buttons["A PITCH panel"].frame
        app.buttons["center-tab-sync"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["center-sync-panel"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["A play pause"].frame.minY, beforeTransport.minY, accuracy: 2, "Panel changes must not move transport")
        XCTAssertEqual(app.buttons["A PITCH panel"].frame.minY, beforePitch.minY, accuracy: 2, "Panel changes must not move pitch")
        XCTAssertTrue(app.buttons["A play pause"].isHittable)
        XCTAssertTrue(app.buttons["A PITCH panel"].isHittable)
        let address = app.textFields["Desktop address"]
        XCTAssertTrue(address.exists)
        let panel = app.descendants(matching: .any)["center-sync-panel"].firstMatch
        for _ in 0..<5 where !address.isHittable { panel.swipeUp(velocity: .slow) }
        XCTAssertTrue(address.isHittable, "Actual pairing address must be reachable inside Sync")
        let pair = app.buttons["PAIR IPHONE"]
        for _ in 0..<8 where !pair.isHittable { panel.swipeUp(velocity: .slow) }
        XCTAssertTrue(pair.isHittable, "Pair action must remain reachable inside bounded Sync scroll")
        XCTAssertGreaterThanOrEqual(pair.frame.height, 44)
        XCTAssertLessThanOrEqual(pair.frame.maxY, panel.frame.maxY + 1, "Whole Pair target must fit, not merely its center")
        XCTAssertEqual(app.buttons["A play pause"].frame.minY, beforeTransport.minY, accuracy: 2)
        print("PORTRAIT_GEOMETRY app=\(app.frame) window=\(app.windows.firstMatch.frame) panel=\(panel.frame) pair=\(pair.frame) pitch=\(app.buttons["A PITCH panel"].frame)")
        // A second frame after a no-input runloop interval distinguishes a
        // transient capture from persistent missing drawing on older runtimes.
        Thread.sleep(forTimeInterval: 0.5)
        shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "Whole device portrait Sync"; shot.lifetime = .keepAlways; add(shot)
        shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Actual Sync tab reuses desktop pairing and library sync"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["center-tab-fx"].tap()
        XCTAssertFalse(panel.exists)
    }
    @MainActor func testPlayingWaveTouchLockPreservesTransportAndPausedSeek() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let play = app.buttons["A play pause"]; XCTAssertTrue(play.waitForExistence(timeout: 20)); waitForReadyTransport(play, app: app)
        let lock = app.buttons["wave-touch-lock"]; XCTAssertTrue(lock.exists); lock.tap()
        XCTAssertEqual(lock.value as? String, "Locked while playing")
        play.tap()
        let wave = app.otherElements["deck-0-detail-wave"]
        let playing = NSPredicate(format: "value BEGINSWITH 'playing'")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: playing, object: wave)], timeout: 5), .completed)
        let from = wave.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
        from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: -90, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertTrue((wave.value as? String ?? "").hasPrefix("playing"), "Locked playing drag must not pause transport")
        play.tap()
        let before = wave.value as? String ?? ""
        from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: -90, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.1)
        let changed = NSPredicate(format: "value != %@", before)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: wave)], timeout: 5), .completed, "Paused drag stays available")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Compact labeled center controls with playing-only waveform lock"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testStandardWorkspaceSettingsAndPitch() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["BROWSE"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["A play pause"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["PERFORM"].exists)
        XCTAssertFalse(app.buttons["LIBRARY"].exists)
        let play = app.buttons["A play pause"]
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        waitForReadyTransport(play, app: app)
        play.tap()
        let wave = app.otherElements["deck-0-detail-wave"]
        let playing = NSPredicate(format: "value BEGINSWITH %@", "playing")
        expectation(for: playing, evaluatedWith: wave); waitForExpectations(timeout: 8)
        Thread.sleep(forTimeInterval: 4)
        play.tap()
        let paused = NSPredicate(format: "value BEGINSWITH %@", "paused")
        expectation(for: paused, evaluatedWith: wave); waitForExpectations(timeout: 8)
        let record = app.buttons["Record master"]
        let recordings = app.buttons["Saved recordings"]
        let leftFader = app.otherElements["A channel fader"]
        let rightFader = app.otherElements["B channel fader"]
        XCTAssertTrue(record.isHittable)
        XCTAssertTrue(recordings.isHittable)
        for control in [record, recordings] {
            XCTAssertGreaterThanOrEqual(control.frame.minX, leftFader.frame.maxX)
            XCTAssertLessThanOrEqual(control.frame.maxX, rightFader.frame.minX)
            XCTAssertGreaterThanOrEqual(control.frame.height, 38)
        }
        let portrait = XCTAttachment(screenshot: app.screenshot()); portrait.name = "Android-structure iOS portrait WIP"; portrait.lifetime = .keepAlways; add(portrait)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); screen.name = "Whole device portrait transport and pitch"; screen.lifetime = .keepAlways; add(screen)
        // Preserve both immediate and settled pixels, accessibility readiness
        // does not prove that the simulator compositor finished every layer.
        Thread.sleep(forTimeInterval: 2)
        let settled = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); settled.name = "Settled whole device portrait fixed controls and pitch"; settled.lifetime = .keepAlways; add(settled)

        let pitchButton = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "PITCH")).firstMatch
        XCTAssertLessThanOrEqual(pitchButton.frame.maxY, app.frame.maxY - 16, "Pitch control must stay above bottom safe area")
        XCTAssertTrue(pitchButton.isHittable)
        XCTAssertGreaterThanOrEqual(pitchButton.frame.height, 44)
        XCTAssertGreaterThanOrEqual(play.frame.height, 44)
        print("STANDARD_TARGETS pitch=\(pitchButton.frame) play=\(play.frame) app=\(app.frame)")
        pitchButton.tap()
        XCTAssertTrue(app.buttons["Close pitch panel"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        let pitch = XCTAttachment(screenshot: app.screenshot()); pitch.name = "iOS one-deck pitch overlay WIP"; pitch.lifetime = .keepAlways; add(pitch)
        app.buttons["Close pitch panel"].firstMatch.tap()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["Desktop address"].waitForExistence(timeout: 5))
        app.buttons["CLOSE"].tap()
        app.buttons["browser-open"].tap()
        XCTAssertTrue(app.textFields["Search title, artist, file"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        let browse = XCTAttachment(screenshot: app.screenshot()); browse.name = "iOS in-place browser with transport WIP"; browse.lifetime = .keepAlways; add(browse)
        let selected = app.buttons["Select Synthetic pulse A"]
        XCTAssertTrue(selected.waitForExistence(timeout: 5)); selected.tap()
        XCTAssertEqual(selected.value as? String, "Selected")
        let preview = app.descendants(matching: .any)["library-row-preview-1"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        let waveRow = XCTAttachment(screenshot: app.screenshot()); waveRow.name = "Selected row with actual generated waveform"; waveRow.lifetime = .keepAlways; add(waveRow)
    }
    @MainActor func testLiveMixerControlsRespondAndRecover() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        let play = app.buttons["A play pause"]
        XCTAssertTrue(play.waitForExistence(timeout: 20))
        let fader = app.otherElements["A channel fader"]
        XCTAssertTrue(fader.waitForExistence(timeout: 5))
        waitForReadyTransport(play, app: app)
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
        let wave = app.otherElements["deck-0-detail-wave"]
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "playing"), evaluatedWith: wave); waitForExpectations(timeout: 5)
        Thread.sleep(forTimeInterval: 2)
        play.tap()
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "paused"), evaluatedWith: wave); waitForExpectations(timeout: 5)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Live mixer gesture and transport recovery"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testRekordboxUSBPreviewExplicitCopyAndPlayback() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--usb-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10)); app.buttons["Settings"].tap()
        let entry = app.buttons["REKORDBOX USB IMPORT"]
        for _ in 0..<4 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.isHittable); entry.tap()
        let confirm = app.buttons["usb-confirm-import"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        XCTAssertTrue(confirm.isHittable, "import stays visible even with 1075 preview rows")
        XCTAssertEqual(confirm.label, "Import 0 selected")
        XCTAssertFalse(confirm.isEnabled, "never preselect a full physical library")
        app.buttons["Import USB generated pulse"].tap()
        XCTAssertEqual(confirm.label, "Import 1 selected")
        XCTAssertTrue(app.staticTexts["Preview only. Nothing copied."].exists)
        XCTAssertTrue(app.staticTexts["usb-selection-summary"].exists)
        let preview = XCTAttachment(screenshot: app.screenshot()); preview.name = "Synthetic USB read-only preview before explicit copy"; preview.lifetime = .keepAlways; add(preview)
        confirm.tap()
        XCTAssertTrue(app.buttons["COPY TO THIS IPHONE"].waitForExistence(timeout: 5))
        app.buttons["COPY TO THIS IPHONE"].tap()
        XCTAssertTrue(app.buttons["Load A"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Imported 1 track into this iPhone. USB unchanged."].exists)
        let copied = XCTAttachment(screenshot: app.screenshot()); copied.name = "Synthetic USB app-owned import after confirmation"; copied.lifetime = .keepAlways; add(copied)
        app.buttons["Load A"].firstMatch.tap()
        app.buttons["CLOSE"].tap()
        let play = app.buttons["A play pause"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        let header = app.buttons["deck-0-info"]
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "value CONTAINS %@", "USB generated pulse"), evaluatedWith: header); waitForExpectations(timeout: 10)
        // Imported USB audio has no saved cue/grid/waveform in this prototype.
        let ready = NSPredicate(format: "enabled == true AND hittable == true")
        expectation(for: ready, evaluatedWith: play); waitForExpectations(timeout: 15)
        play.tap()
        let wave = app.otherElements["deck-0-detail-wave"]
        expectation(for: NSPredicate(format: "value BEGINSWITH %@", "playing"), evaluatedWith: wave); waitForExpectations(timeout: 8)
        let playing = XCTAttachment(screenshot: app.screenshot()); playing.name = "App-owned USB import loaded and playing"; playing.lifetime = .keepAlways; add(playing)
        play.tap()
    }
    @MainActor func testLibrarySourceNavigationAndBack() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture"]; app.launch()
        let browse = app.buttons["browser-open"]
        let before = browse.value as? String ?? "<unavailable>"
        print("BROWSE_AX beforeTap value=\(before)")
        let beforeAttachment = XCTAttachment(string: before)
        beforeAttachment.name = "Browse action diagnostic before tap"; beforeAttachment.lifetime = .keepAlways; add(beforeAttachment)
        browse.tap()
        let playlists = app.buttons["browse-playlists"]
        let playlistsExists = playlists.waitForExistence(timeout: 10)
        let after = browse.exists ? (browse.value as? String ?? "<unavailable>") : "<element absent>"
        print("BROWSE_AX afterExistingWait playlistsExists=\(playlistsExists) value=\(after)")
        let afterAttachment = XCTAttachment(string: after)
        afterAttachment.name = "Browse action diagnostic after existing wait"; afterAttachment.lifetime = .keepAlways; add(afterAttachment)
        XCTAssertTrue(playlistsExists); playlists.tap()
        XCTAssertTrue(app.buttons["source-collection"].waitForExistence(timeout: 5))
        let root = XCTAttachment(screenshot: app.screenshot()); root.name = "Full playlist menu with own search and back"; root.lifetime = .keepAlways; add(root)
        XCTAssertEqual(app.buttons["source-playlist-10"].value as? String, "2 tracks")
        XCTAssertEqual(app.buttons["source-playlist-11"].value as? String, "0 tracks")
        app.buttons["source-playlist-10"].tap()
        let cached = app.staticTexts["Cached Test Tone"], offline = app.staticTexts["Offline Test Tone"]
        XCTAssertTrue(cached.waitForExistence(timeout: 5)); XCTAssertTrue(offline.exists)
        expectation(for: NSPredicate { _, _ in cached.frame.minY < offline.frame.minY }, evaluatedWith: app); waitForExpectations(timeout: 5)
        playlists.tap(); app.buttons["source-playlist-11"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: cached); waitForExpectations(timeout: 5)
        XCTAssertTrue(app.staticTexts["0 tracks · 1 downloaded"].exists)
        playlists.tap(); app.buttons["Back to Browse"].tap()
        XCTAssertTrue(playlists.waitForExistence(timeout: 5))
        playlists.tap(); app.buttons["source-collection"].tap()
        XCTAssertTrue(offline.waitForExistence(timeout: 5)); XCTAssertTrue(cached.exists)
        XCTAssertTrue(app.buttons["A play pause"].firstMatch.isHittable); XCTAssertTrue(app.buttons["B play pause"].firstMatch.isHittable)
        XCTAssertLessThanOrEqual(app.buttons["A play pause"].firstMatch.frame.height, 44)
        XCTAssertGreaterThanOrEqual(app.buttons["A play pause"].firstMatch.frame.height, 44)
    }
    @MainActor func testBrowseManyTagsAnyAllAndDisclosure() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture", "--browse-tags-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        XCTAssertTrue(app.staticTexts["Cached Test Tone"].waitForExistence(timeout: 10))
        let disclosure = app.buttons["track-tags-2"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 5)); XCTAssertTrue(disclosure.isHittable)
        let before = XCTAttachment(screenshot: app.screenshot()); before.name = "Native Browse 3 5 8 and 14 tag rows"; before.lifetime = .keepAlways; add(before)
        disclosure.tap(); XCTAssertTrue(app.navigationBars["Track tags"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.buttons["browse-tags"].tap()
        let mode = app.buttons["tag-match-mode"]
        XCTAssertEqual(mode.value as? String, "Any selected tag")
        app.buttons["Filter tag Rolling"].tap(); app.buttons["Filter tag Liquid"].tap()
        mode.tap(); XCTAssertEqual(mode.value as? String, "All selected tags")
        let all = XCTAttachment(screenshot: app.screenshot()); all.name = "Native glass ALL selected tags and bright matching row tags"; all.lifetime = .keepAlways; add(all)
        app.buttons["Clear tag selections"].tap()
        XCTAssertEqual(app.buttons["Filter tag Rolling"].value as? String, "Not selected")
        app.buttons["browse-follow"].tap(); XCTAssertEqual(app.buttons["browse-follow"].value as? String, "On")
        app.buttons["browse-follow"].tap(); XCTAssertEqual(app.buttons["browse-follow"].value as? String, "Off")
        // Title-area taps must retain row-load intent, never open the tag sheet.
        app.staticTexts["Cached Test Tone"].tap()
        XCTAssertFalse(app.navigationBars["Track tags"].exists)
        XCTAssertTrue(app.buttons["deck-0-info"].waitForExistence(timeout: 8))
        expectation(for: NSPredicate(format: "value CONTAINS %@", "Cached Test Tone"), evaluatedWith: app.buttons["deck-0-info"]); waitForExpectations(timeout: 8)
        app.buttons["browser-open"].tap()
        let preview = app.descendants(matching: .any)["library-row-preview-1"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        let swipeStart = preview.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        swipeStart.press(forDuration: 0.06, thenDragTo: swipeStart.withOffset(CGVector(dx: 115, dy: 0)), withVelocity: .fast, thenHoldForDuration: 0)
        XCTAssertFalse(app.navigationBars["Track tags"].exists)
        expectation(for: NSPredicate(format: "value CONTAINS %@", "Cached Test Tone"), evaluatedWith: app.buttons["deck-1-info"]); waitForExpectations(timeout: 8)
    }
    @MainActor func testBrowseTagDisclosureEdgesAtDefaultAndLargerType() {
        for large in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = ["--library-ui-fixture", "--browse-tags-fixture"] + (large ? ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXXL"] : [])
            app.launch(); app.buttons["browser-open"].tap()
            let disclosure = app.buttons["track-tags-1"]
            XCTAssertTrue(disclosure.waitForExistence(timeout: 10))
            disclosure.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)).tap()
            XCTAssertTrue(app.navigationBars["Track tags"].waitForExistence(timeout: 5), "Bottom edge on a row without evidence must open its tags")
            app.buttons["Done"].tap()
            let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = large ? "Large type measured tag rail boundaries" : "Default measured tag rail boundaries"; shot.lifetime = .keepAlways; add(shot)
            for y in [0.2, 0.8] {
                let start = disclosure.coordinate(withNormalizedOffset: CGVector(dx: -0.15, dy: y))
                start.press(forDuration: 0.06, thenDragTo: start.withOffset(CGVector(dx: 115, dy: 0)), withVelocity: .fast, thenHoldForDuration: 0)
                XCTAssertFalse(app.navigationBars["Track tags"].exists, "Swiping beside label must not open tags")
                expectation(for: NSPredicate(format: "value CONTAINS %@", "Cached Test Tone"), evaluatedWith: app.buttons["deck-1-info"]); waitForExpectations(timeout: 8)
                app.buttons["browser-open"].tap()
                XCTAssertTrue(disclosure.waitForExistence(timeout: 5))
            }
            app.terminate()
        }
    }
    @MainActor func testLibraryFilterChipsAndBPM() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        let filter = app.buttons["Library filters"]
        XCTAssertTrue(filter.waitForExistence(timeout: 10))
        let search = app.textFields["Search title, artist, file"]
        XCTAssertTrue(search.exists)
        XCTAssertGreaterThan(filter.frame.minX, search.frame.maxX, "FILTER remains a separate control, not inside search")
        XCTAssertLessThanOrEqual(search.frame.height, 44)
        XCTAssertGreaterThanOrEqual(filter.frame.height, 44)
        let compactSearch = XCTAttachment(screenshot: app.screenshot()); compactSearch.name = "Compact Android-grounded search and separate FILTER key"; compactSearch.lifetime = .keepAlways; add(compactSearch)

        let cached = app.staticTexts["Cached Test Tone"], offline = app.staticTexts["Offline Test Tone"]
        XCTAssertTrue(cached.waitForExistence(timeout: 5)); XCTAssertTrue(offline.exists)
        XCTAssertFalse(app.buttons["Filter tag Rolling"].exists)
        app.buttons["browse-tags"].tap()
        let rolling = app.buttons["Filter tag Rolling"], liquid = app.buttons["Filter tag Liquid"]
        XCTAssertTrue(rolling.waitForExistence(timeout: 5)); XCTAssertTrue(rolling.isHittable)
        rolling.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: offline); waitForExpectations(timeout: 5)
        XCTAssertTrue(cached.exists)
        liquid.tap()
        XCTAssertTrue(offline.waitForExistence(timeout: 5)); XCTAssertTrue(cached.exists)
        let tags = XCTAttachment(screenshot: app.screenshot()); tags.name = "Library expanded multi-tag filters"; tags.lifetime = .keepAlways; add(tags)
        app.buttons["browse-tags"].tap()
        XCTAssertFalse(rolling.exists)
        XCTAssertTrue(offline.exists); XCTAssertTrue(cached.exists)
        let select = app.buttons["Select Cached Test Tone"]
        XCTAssertTrue(select.isHittable); select.tap()
        XCTAssertEqual(select.value as? String, "Selected")
        filter.tap()
        let match = app.buttons["BPM filter"]
        XCTAssertTrue(match.isHittable); match.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: offline); waitForExpectations(timeout: 5)
        XCTAssertTrue(cached.exists)
        XCTAssertTrue(app.staticTexts["1 track · 1 downloaded"].exists)
        XCTAssertTrue(app.buttons["BPM filter"].isHittable)
        let bpm = XCTAttachment(screenshot: app.screenshot()); bpm.name = "Library BPM reference and active tags"; bpm.lifetime = .keepAlways; add(bpm)
        app.buttons["Reset library filters"].tap()
        XCTAssertTrue(offline.waitForExistence(timeout: 5)); XCTAssertTrue(cached.exists)
        app.buttons["browse-tags"].tap()
        XCTAssertEqual(rolling.value as? String, "Not selected")
        app.buttons["browse-tag-categories"].tap()
        XCTAssertTrue(app.buttons["tag-category-1"].waitForExistence(timeout: 5)); app.buttons["tag-category-1"].tap()
        app.buttons["category-tag-1"].tap()
        XCTAssertTrue(cached.waitForExistence(timeout: 5)); XCTAssertFalse(offline.exists)
        app.buttons["Clear browsed tag"].tap()
        XCTAssertTrue(offline.waitForExistence(timeout: 5))
    }
    @MainActor func testLibrarySearchAcceptedAndRefusedLoads() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--library-ui-fixture"]
        app.launch()
        app.buttons["browser-open"].tap()
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
    @MainActor func testLibraryRowPreviewsRender() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--library-ui-fixture"]
        app.launch()
        app.buttons["browser-open"].tap()
        let search = app.textFields["Search title, artist, file"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        // Fixture tracks carry saved preview blobs; their rows must show the
        // preview strip (user report: row previews missing in the browser).
        let first = app.descendants(matching: .any)["library-row-preview-1"]
        XCTAssertTrue(first.waitForExistence(timeout: 10), "cached track row must render its preview waveform")
        let second = app.descendants(matching: .any)["library-row-preview-2"]
        XCTAssertTrue(second.waitForExistence(timeout: 5), "offline track row must still render its preview waveform")
        let previews = XCTAttachment(screenshot: app.screenshot())
        previews.name = "Library rows with preview waveforms"; previews.lifetime = .keepAlways; add(previews)
    }

    @MainActor func testBrowserScrollDoesNotLoadOrStealCollapse() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture", "--browser-scroll-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        let list = app.scrollViews["library-track-list"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let first = XCTAttachment(screenshot: app.screenshot()); first.name = "Browser and list expanded as one surface before scroll"; first.lifetime = .keepAlways; add(first)
        for delta in [CGVector(dx: 12, dy: -190), CGVector(dx: -18, dy: -200), CGVector(dx: 25, dy: 160), CGVector(dx: -20, dy: -150)] {
            let from = list.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: delta.dy < 0 ? 0.8 : 0.2))
            from.press(forDuration: 0.02, thenDragTo: from.withOffset(delta), withVelocity: .fast, thenHoldForDuration: 0)
            if delta.dy < 0 {
                XCTAssertFalse(app.staticTexts["Scroll fixture 082"].isHittable, "Upward row drag must actually scroll the initial top row offscreen")
            }
            print("BROWSER_SCROLL_DIAGNOSTIC delta=\(delta) frame=\(list.frame) value=\(list.value ?? "missing")")
            XCTAssertTrue(app.textFields["Search title, artist, file"].exists, "Scrolling must not close browser or load a track")
            XCTAssertFalse(app.alerts.firstMatch.exists, "Scrolling must not attempt unavailable track loads")
            for index in 0..<2 { XCTAssertFalse((app.buttons["deck-\(index)-info"].value as? String ?? "").contains("Test Tone")) }
        }
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = "Vertical diagonal and reversed browser scroll without deck load"; after.lifetime = .keepAlways; add(after)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Scroll fixture'")).firstMatch.exists)
        app.buttons["browser-close"].tap()
        app.buttons["browser-open"].tap()
        XCTAssertTrue(list.waitForExistence(timeout: 10))
    }

    @MainActor func testBrowserHandleFollowsFingerAndCancelsPartialDrag() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture", "--browser-scroll-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        let handle = app.otherElements["browser-drag-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 10))
        let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 45)), withVelocity: .slow, thenHoldForDuration: 0.6)
        XCTAssertTrue(app.textFields["Search title, artist, file"].exists, "Short drag settles open")
        let open = XCTAttachment(screenshot: app.screenshot()); open.name = "Real drawer settles open after a short held drag"; open.lifetime = .keepAlways; add(open)
        let close = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        close.press(forDuration: 0.05, thenDragTo: close.withOffset(CGVector(dx: 0, dy: 230)), withVelocity: .slow, thenHoldForDuration: 0.6)
        XCTAssertFalse(app.textFields["Search title, artist, file"].exists, "Long drag settles closed")
        app.buttons["browser-open"].tap(); XCTAssertTrue(handle.waitForExistence(timeout: 5))
    }

    @MainActor func testBrowserTopEdgeDragHandsOffToDrawer() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture", "--browser-scroll-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        let list = app.scrollViews["library-track-list"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let origin = list.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.15))
        origin.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: 240)), withVelocity: .slow, thenHoldForDuration: 0.3)
        if list.exists { print("BROWSER_NATIVE_HANDOFF_DIAGNOSTIC \(list.value ?? "missing")") }
        let closed = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: list)], timeout: 5), .completed, "At the list top, downward overscroll must move and close the drawer rather than bounce rows independently")
        XCTAssertFalse(app.alerts.firstMatch.exists, "Drawer drag must not load a track")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Top-of-list downward drag settled drawer"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testBrowserModerateFlingSettlesLikeHandle() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture", "--browser-scroll-fixture"]; app.launch()
        for fromList in [false, true, false, true, false, true] {
            if app.buttons["browser-close"].exists { app.buttons["browser-close"].tap() }
            app.buttons["browser-open"].tap()
            let list = app.scrollViews["library-track-list"]
            XCTAssertTrue(list.waitForExistence(timeout: 10))
            let target = fromList ? list : app.otherElements["browser-drag-handle"]
            let start = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: fromList ? 0.15 : 0.5))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 110)), withVelocity: 900, thenHoldForDuration: 0)
            if list.exists { print("MODERATE_FLING_DIAGNOSTIC fromList=\(fromList) handle=\(app.otherElements["browser-drag-handle"].value ?? "missing") list=\(list.value ?? "missing")") }
            let closed = NSPredicate(format: "exists == false")
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: list)], timeout: 5), .completed, "Moderate downward fling should settle closed from both handle and top row")
            XCTAssertFalse(app.alerts.firstMatch.exists)
            for index in 0..<2 { XCTAssertFalse((app.buttons["deck-\(index)-info"].value as? String ?? "").contains("Test Tone")) }
        }
    }

    @MainActor func testLandscapeBrowserControlsAndRowsStayReachable() {
        defer { captureFailure(); XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture"]; app.launch()
        XCUIDevice.shared.orientation = .landscapeLeft
        // A transient rotated bounding box can be wider than tall before the
        // orientation animation finishes. Wait for the stable landscape window.
        var lastFrame = CGRect.zero
        var stablePolls = 0
        let rotated = NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            let stable = frame.width > frame.height && abs(frame.minX) < 1 && abs(frame.minY) < 1 && frame == lastFrame
            stablePolls = stable ? stablePolls + 1 : 0
            lastFrame = frame
            return stablePolls >= 2
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: rotated, object: app)], timeout: 10), .completed)
        app.buttons["browser-open"].firstMatch.tap()
        let search = app.textFields["Search title, artist, file"]
        XCTAssertTrue(search.waitForExistence(timeout: 10)); XCTAssertTrue(search.isHittable)
        let row = app.staticTexts["Cached Test Tone"]
        XCTAssertTrue(row.waitForExistence(timeout: 10)); XCTAssertTrue(row.isHittable, "Landscape header must leave visible rows")
        let close = app.buttons["browser-close"]
        XCTAssertTrue(close.isHittable)
        // Capture the device screen as well as the application crop: rotated
        // application screenshots can carry an orientation/crop mismatch.
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); screen.name = "Landscape whole device screen"; screen.lifetime = .keepAlways; add(screen)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = "Landscape browser open global geometry"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        let bounds = app.windows.firstMatch.frame
        for control in [search, close, row] {
            XCTAssertGreaterThanOrEqual(control.frame.minX, bounds.minX)
            XCTAssertLessThanOrEqual(control.frame.maxX, bounds.maxX)
            XCTAssertGreaterThanOrEqual(control.frame.minY, bounds.minY)
            XCTAssertLessThanOrEqual(control.frame.maxY, bounds.maxY)
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Landscape browser application crop"; shot.lifetime = .keepAlways; add(shot)
        close.tap()
        XCTAssertFalse(search.exists)
    }

    @MainActor func testLibraryQuickSwipeLoadsWithoutFullSwipe() {
        defer { captureFailure() }
        let app = XCUIApplication()
        app.launchArguments = ["--library-ui-fixture"]
        app.launch()
        app.buttons["browser-open"].tap()
        let search = app.textFields["Search title, artist, file"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        let keyboardContinue = app.buttons["Continue"]
        if keyboardContinue.waitForExistence(timeout: 2) { keyboardContinue.tap() }
        search.typeText("Cached")
        let row = app.staticTexts["Cached Test Tone"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        // User-requested short flick keeps Android left=A direction.
        let from = row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        let to = from.withOffset(CGVector(dx: -75, dy: 0))
        from.press(forDuration: 0.01, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0)
        let deck = app.buttons["deck-0-info"]
        print("SHORT_SWIPE_NATIVE_ROWS \(app.otherElements.matching(identifier: "library-swipe-row").allElementsBoundByIndex.map { $0.value ?? "missing" })")
        let loaded = NSPredicate(format: "value CONTAINS %@", "Cached Test Tone")
        expectation(for: loaded, evaluatedWith: deck); waitForExpectations(timeout: 8)
        XCTAssertFalse(search.exists, "Accepted swipe closes browser")
    }

    @MainActor func testLibraryRightShortSwipeLoadsBNotA() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--library-ui-fixture"]; app.launch()
        app.buttons["browser-open"].tap()
        let row = app.staticTexts["Cached Test Tone"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let from = row.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5))
        from.press(forDuration: 0.01, thenDragTo: from.withOffset(CGVector(dx: 75, dy: 0)), withVelocity: .fast, thenHoldForDuration: 0)
        print("SHORT_SWIPE_NATIVE_ROWS \(app.otherElements.matching(identifier: "library-swipe-row").allElementsBoundByIndex.map { $0.value ?? "missing" })")
        let loaded = NSPredicate(format: "value CONTAINS %@", "Cached Test Tone")
        expectation(for: loaded, evaluatedWith: app.buttons["deck-1-info"]); waitForExpectations(timeout: 8)
        XCTAssertFalse((app.buttons["deck-0-info"].value as? String ?? "").contains("Cached Test Tone"))
    }

    @MainActor func testCueAndStoredHotcueHoldSlideLatch() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--performance-ui-fixture"]; app.launch()
        waitForReadyTransport(app.buttons["A play pause"], app: app)
        let cue = app.buttons["deck-0-cue-hold"]
        XCTAssertTrue(cue.waitForExistence(timeout: 20))
        let wave = app.otherElements["deck-0-detail-wave"]
        // At the stored main cue, hold and drag right to take over preview.
        let point = cue.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        point.press(forDuration: 0.4, thenDragTo: point.withOffset(CGVector(dx: 85, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.1)
        let playing = NSPredicate(format: "value BEGINSWITH %@", "playing")
        expectation(for: playing, evaluatedWith: wave); waitForExpectations(timeout: 8)
        app.buttons["A play pause"].tap()
        let pad = app.buttons["deck-0-hotcue-0"]
        let padPoint = pad.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        padPoint.press(forDuration: 0.4, thenDragTo: padPoint.withOffset(CGVector(dx: -85, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.1)
        expectation(for: playing, evaluatedWith: wave); waitForExpectations(timeout: 8)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Cue and hotcue slide-to-play latched synthetic"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testLocalLiveSyntheticPairedHostMonitor() {
        defer { captureFailure() }
        let app = XCUIApplication(); app.launchArguments = ["--local-live-ui-fixture"]; app.launch()
        let status = app.staticTexts["local-live-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        let listening = NSPredicate(format: "label BEGINSWITH %@", "Listening")
        expectation(for: listening, evaluatedWith: status); waitForExpectations(timeout: 30)
        XCTAssertTrue(app.staticTexts["Synthetic LAN Tone"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Local live monitor - synthetic paired host, not device proof"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["STOP"].tap()
        let stopped = NSPredicate(format: "label BEGINSWITH %@", "Stopped")
        expectation(for: stopped, evaluatedWith: status); waitForExpectations(timeout: 5)
    }

}
