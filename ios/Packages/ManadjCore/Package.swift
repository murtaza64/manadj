// swift-tools-version: 6.0
import PackageDescription

/// ManadjCore: the device-sync Library domain layer of manaDJ mobile (#369/#372
/// Android baseline), ported to pure Swift. Platform-neutral (Foundation only)
/// so the same code runs in the iOS app and in Linux CI.
let package = Package(
    name: "ManadjCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ManadjCore", targets: ["ManadjCore"])],
    targets: [
        .target(name: "ManadjCore"),
        .testTarget(
            name: "ManadjCoreTests",
            dependencies: ["ManadjCore"],
            resources: [.process("Resources")]
        ),
    ]
)
