// Local-only speech helper preparation. Not wired into the production app yet.
// Never replace capability denial with a network recognition request.
import AVFoundation
import Foundation
import Speech

final class LocalSpeech {
    private let engine = AVAudioEngine()
    private var task: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var ended = false
    private var installedTap = false

    func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }

    func finish(_ code: String) {
        guard !ended else { return }
        ended = true
        engine.stop()
        if installedTap { engine.inputNode.removeTap(onBus: 0); installedTap = false }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        emit(["type": "end", "code": code])
        exit(code == "complete" || code == "stopped" ? 0 : 1)
    }

    func run(mode: String, locale: String) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
              recognizer.supportsOnDeviceRecognition else {
            if mode == "--probe" {
                emit(["type": "capability", "available": false, "code": "local_model_unavailable"])
            } else {
                emit(["type": "end", "code": "local_model_unavailable"])
            }
            exit(2)
        }
        if mode == "--probe" {
            // No permission request, microphone input, network or transcript.
            emit(["type": "capability", "available": recognizer.isAvailable,
                  "code": recognizer.isAvailable ? "local_supported" : "recognizer_unavailable",
                  "speechPermission": SFSpeechRecognizer.authorizationStatus().rawValue,
                  "microphonePermission": AVCaptureDevice.authorizationStatus(for: .audio).rawValue])
            exit(0)
        }
        // Only explicit --start can prompt, after both purpose strings exist.
        guard let speechPurpose = Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String,
              !speechPurpose.isEmpty,
              let micPurpose = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
              !micPurpose.isEmpty else { finish("missing_bundle_purpose"); return }
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { self.finish("speech_permission_denied"); return }
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        guard allowed else { self.finish("microphone_permission_denied"); return }
                        self.begin(recognizer)
                    }
                }
            }
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer) {
        guard !ended, recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            finish("local_model_unavailable"); return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        self.request = request
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                guard !self.ended else { return }
                if let result, result.isFinal {
                    let text = String(result.bestTranscription.formattedString.prefix(10_000))
                    if !text.isEmpty { self.emit(["type": "text", "text": text]) }
                    self.finish("complete")
                } else if error != nil {
                    // No localized error, audio, paths or credentials on stdout/stderr.
                    self.finish("recognition_failed")
                }
            }
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { finish("microphone_unavailable"); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        installedTap = true
        engine.prepare()
        do { try engine.start() } catch { finish("microphone_unavailable"); return }
        emit(["type": "listening"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { self.finish("timeout") }
    }
}

let helper = LocalSpeech()
let args = CommandLine.arguments
let allowedModes = ["--probe", "--start"]
guard args.count == 3, allowedModes.contains(args[1]),
      args[2].utf8.count <= 64,
      args[2].unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }) else {
    helper.emit(["type": "end", "code": "invalid_arguments"])
    exit(2)
}
if args[1] == "--start" {
    DispatchQueue.global().async {
        // Any stdin data or EOF means stop. Parent also kills on teardown.
        _ = FileHandle.standardInput.availableData
        DispatchQueue.main.async { helper.finish("stopped") }
    }
}
helper.run(mode: args[1], locale: args[2])
RunLoop.main.run()
