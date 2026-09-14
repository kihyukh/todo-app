# iPhone build validation — 14 September 2026

Working name: Daymark. Version 1.0.0, build 1. Built with Xcode 26.6 and the iOS 26.5 SDK; minimum deployment target iOS 16.

## Completed

- 296 frontend tests pass, covering the existing editor and storage behavior plus mobile setup, keyboard dismissal, link actions, cursor visibility after viewport changes, synced note updates, visible save errors, multi-date calendars, and repeated Upcoming entries.
- All 36 native persistence checks and 89 migration checks pass using temporary test folders, including preservation of date arrays and cleared schedules.
- The simulator app builds for arm64 and x86_64. It has been installed and launched on iPhone 17 Pro Max and iPad Pro 13-inch (M5) simulators running iOS 26.5.
- A Release archive for an arm64 iOS device builds at `build/Daymark.xcarchive`. It is unsigned and cannot be distributed as-is.
- The archive contains the icon, privacy manifest, bundled editor assets, and license notices. No personal task records, migration exports, attachment workspace, recovery history, or source files are bundled.
- iPhone visual checks confirmed local first-launch setup, the Today list, task details, independent calendar selections, the selected-date summary, and the unchanged deadline. Opening a display equation now keeps its LaTeX visible above the keyboard; Done dismisses the keyboard and restores rendering.
- Browser interaction checks confirmed nonconsecutive dates across September and October, removing one date, the after-deadline hint, and every work day appearing in Upcoming separately from its deadline. Only fictional sample tasks were edited.

## Still needed before distribution

- Finish the remaining native interaction checks: touch link Open/Edit, deadline/tag sheets, image/PDF import and preview, folder selection, and error recovery. Capture App Store screenshots from the final build using fictional data.
- Sign into Xcode with an Apple Developer Program team; reserve the final bundle identifier and create the App Store Connect record. No signing identity or authenticated App Store Connect session was available during this build.
- Test on a physical iPhone: foreground/background persistence, local offline edits, Files permissions after relaunch, attachments, and cross-device iCloud delivery with the Mac using a separate test workspace. Simulator compilation does not verify these device/provider behaviors.
- Finish the public name, publisher/contact details, privacy/support URLs, listing, and distribution settings described in [App Store delivery](APP-STORE.md).

No build has been uploaded to TestFlight or submitted to App Review.
