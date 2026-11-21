// swift-tools-version: 6.0
import PackageDescription
import Foundation
let sharedHeaders = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../android/audio-engine/src/main/cpp/third_party").standardizedFileURL.path
let package = Package(
    name: "ManadjAudio",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ManadjAudio", targets: ["ManadjAudio"])],
    targets: [
        .target(name: "CEngine", publicHeadersPath: "include", cxxSettings: [
            .unsafeFlags(["-O3", "-I", sharedHeaders])
        ]),
        .target(name: "ManadjAudio", dependencies: ["CEngine"]),
        .testTarget(name: "ManadjAudioTests", dependencies: ["ManadjAudio", "CEngine"])
    ],
    cxxLanguageStandard: .cxx17
)
