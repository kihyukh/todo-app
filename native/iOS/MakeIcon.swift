import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// iOS masks the icon itself; the opaque square also satisfies App Store alpha rules.
guard CommandLine.arguments.count == 2 else { fatalError("Expected output PNG path") }
let size: CGFloat = 1024
let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 38 / 255, green: 115 / 255, blue: 77 / 255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.move(to: CGPoint(x: size * 0.25, y: size * 0.50))
context.addLine(to: CGPoint(x: size * 0.425, y: size * 0.325))
context.addLine(to: CGPoint(x: size * 0.765, y: size * 0.67))
context.setLineWidth(size * 0.10)
context.setLineCap(.round)
context.setLineJoin(.round)
context.setStrokeColor(CGColor(gray: 1, alpha: 1))
context.strokePath()
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not write app icon") }
