import AppKit

guard CommandLine.arguments.count == 2 else { fatalError("Expected an iconset output directory") }
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

func render(_ pixels: Int, name: String) throws {
    let size = CGFloat(pixels)
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.shouldAntialias = true
    let shape = NSBezierPath(roundedRect: NSRect(x: size * 0.07, y: size * 0.07, width: size * 0.86, height: size * 0.86), xRadius: size * 0.19, yRadius: size * 0.19)
    NSColor(deviceRed: 85 / 255, green: 121 / 255, blue: 220 / 255, alpha: 1).setFill()
    shape.fill()
    let check = NSBezierPath()
    check.move(to: NSPoint(x: size * 0.28, y: size * 0.51))
    check.line(to: NSPoint(x: size * 0.435, y: size * 0.355))
    check.line(to: NSPoint(x: size * 0.735, y: size * 0.66))
    check.lineWidth = size * 0.092
    check.lineCapStyle = .round
    check.lineJoinStyle = .round
    NSColor.white.setStroke()
    check.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(name))
}

for points in [16, 32, 128, 256, 512] {
    try render(points, name: "icon_\(points)x\(points).png")
    try render(points * 2, name: "icon_\(points)x\(points)@2x.png")
}
