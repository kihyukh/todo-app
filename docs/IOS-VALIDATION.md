# iPhone build validation — 14 September 2026

Working name: Daymark. Version 1.0.0, build 1. Built with Xcode 26.6 and the iOS 26.5 SDK; minimum deployment target iOS 16.

## Completed

- 268 frontend tests pass, covering the existing editor and storage behavior plus mobile setup, keyboard dismissal, link actions, cursor visibility after viewport changes, synced note updates, and visible save errors.
- All 28 native persistence checks pass using temporary test folders.
- The simulator app builds for arm64 and x86_64. It has been installed and launched on iPhone 17 Pro Max and iPad Pro 13-inch (M5) simulators running iOS 26.5.
- A Release archive for an arm64 iOS device builds at `build/Daymark.xcarchive`. It is unsigned and cannot be distributed as-is.
- The archive contains the icon, privacy manifest, bundled editor assets, and license notices. No personal task records, migration exports, attachment workspace, recovery history, or source files are bundled.
- Initial iPhone visual checks confirmed the Today list, task details, and keyboard activation from a display equation. A cursor visibility issue discovered there was fixed and covered by a regression test.

## Still needed before distribution

- The final touch-layout retest is pending: the Mac locked during simulator review. Recheck low and multiline equations with the keyboard open, Done, touch link Open/Edit, date/tag sheets, image/PDF import and preview, folder selection, and errors. Capture App Store screenshots from the final build using fictional data.
- Sign into Xcode with an Apple Developer Program team; reserve the final bundle identifier and create the App Store Connect record. No signing identity or authenticated App Store Connect session was available during this build.
- Test on a physical iPhone: foreground/background persistence, local offline edits, Files permissions after relaunch, attachments, and cross-device iCloud delivery with the Mac using a separate test workspace. Simulator compilation does not verify these device/provider behaviors.
- Finish the public name, publisher/contact details, privacy/support URLs, listing, and distribution settings described in [App Store delivery](APP-STORE.md).

No build has been uploaded to TestFlight or submitted to App Review.
