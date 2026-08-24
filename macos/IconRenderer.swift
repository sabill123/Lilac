import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("usage: swift IconRenderer.swift <iconset-directory>\n", stderr)
    exit(2)
}

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let icons: [(name: String, pixels: Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024)
]

for icon in icons {
    let size = icon.pixels
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { continue }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()

    let canvas = NSRect(x: 0, y: 0, width: size, height: size).insetBy(dx: CGFloat(size) * 0.04, dy: CGFloat(size) * 0.04)
    let background = NSBezierPath(
        roundedRect: canvas,
        xRadius: CGFloat(size) * 0.22,
        yRadius: CGFloat(size) * 0.22
    )
    NSColor(calibratedRed: 0.13, green: 0.12, blue: 0.15, alpha: 1).setFill()
    background.fill()

    let heights: [CGFloat] = [0.27, 0.43, 0.58, 0.39, 0.24]
    let barWidth = CGFloat(size) * 0.075
    let gap = CGFloat(size) * 0.038
    let totalWidth = barWidth * CGFloat(heights.count) + gap * CGFloat(heights.count - 1)
    let startX = (CGFloat(size) - totalWidth) / 2

    NSColor(calibratedRed: 0.76, green: 0.61, blue: 0.91, alpha: 1).setFill()
    for (index, ratio) in heights.enumerated() {
        let height = CGFloat(size) * ratio
        let rect = NSRect(
            x: startX + CGFloat(index) * (barWidth + gap),
            y: (CGFloat(size) - height) / 2,
            width: barWidth,
            height: height
        )
        NSBezierPath(roundedRect: rect, xRadius: barWidth / 2, yRadius: barWidth / 2).fill()
    }

    let indicatorSize = CGFloat(size) * 0.105
    let indicator = NSRect(
        x: CGFloat(size) * 0.72,
        y: CGFloat(size) * 0.72,
        width: indicatorSize,
        height: indicatorSize
    )
    NSColor(calibratedWhite: 0.98, alpha: 1).setFill()
    NSBezierPath(ovalIn: indicator).fill()

    NSGraphicsContext.restoreGraphicsState()
    if let data = bitmap.representation(using: .png, properties: [:]) {
        try data.write(to: outputDirectory.appendingPathComponent(icon.name))
    }
}
