// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "LilacMac",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "LilacMac", targets: ["LilacMac"])],
    targets: [
        .executableTarget(
            name: "LilacMac",
            path: "Sources/LilacMac",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
