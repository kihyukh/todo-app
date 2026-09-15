# GreenDay App Store release

Updated on **15 September 2026**. The release target is a native Mac app plus the iPhone/iPad app. **Developer membership has been renewed, authenticated App Store Connect no longer shows the expired-membership banner, and distribution signing is working.** The signed iOS App Store IPA and universal Mac App Store package have been exported and audited. The multiplatform app record is created, and public privacy/support pages are live. Both **1.0.0 (1)** uploads succeeded and finished processing; App Store Connect shows **Complete** and **Ready to Submit** on both platforms. Both platform versions now have their **1.0.0 (1)** builds, complete private review contacts, and review notes saved and verified. The phone number was provided privately and is intentionally omitted from repository files. Neither app has been submitted for review or publicly released. One iPhone screenshot and three iPad screenshots are uploaded and verified. A Mac screenshot and physical-device checks remain outstanding.

Executed app and device checks belong in [IOS-VALIDATION.md](IOS-VALIDATION.md). An unsigned archive validates compilation and resources; it cannot prove distribution signing, calendar permission continuity, file-provider delivery, or App Review acceptance.

## Release identity and remaining inputs

| Input                                                          | Needed for                                      |
| -------------------------------------------------------------- | ----------------------------------------------- |
| Applicable trader declarations, agreements, and release timing | Distribution settings and regional availability |

The publisher is **Kihyuk Hong**, with public support and TestFlight feedback email **hominot@gmail.com**. Copyright is **2026 Kihyuk Hong**. The user's **free global launch** preferences are saved in App Store Connect: base price **US$0.00**, zero prices verified for the other **174 territories**, and availability saved for **all 175 countries/regions**, including future territories. The availability table marks them available when the app is released. In-app purchases are a future plan and are not implemented or configured for this release.

Both release targets use **`com.kihyukh.greenday`**, under signing team **`3D637V9C9W`**, for version **1.0.0**, build **1**. The explicit identifier is registered in the publisher's team. App Store Connect record **`6812229239`** contains both iOS and macOS platforms in **Prepare for Submission**, with SKU **`greenday-2026`** and primary language **English (U.S.)**. The exact name GreenDay was unavailable, so the verified store listing name is **GreenDay: Tasks & Notes**; the app's displayed name remains GreenDay. Apple requires matching identifiers for a universal purchase, and separate records cannot simply be merged later. Development identifiers remain separate. [Apple platform workflow](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)

Both platform listings' **1.0.0** versions, descriptions, promotional text, keywords, support/marketing URLs, copyright, and **sign-in required: false** are saved and verified. The iOS selected build **1.0.0 (1)**, contact, and review notes were confirmed after reloading. The same authorized private contact and notes were saved for Mac with selected build **1.0.0 (1)**; Save is disabled and there are no validation errors. The metadata file deliberately retains `reviewContact.phone: null` because that value was entered privately in App Store Connect. The privacy-policy URL and **Data Not Collected** response are saved as an App Privacy **draft**, with publication awaiting the user's confirmation of Apple's certification dialog. The EU trader declaration remains unanswered. The final privacy certification dialog is open for the user; the draft is not published.

The user completed membership renewal. The release scripts use Xcode's authenticated account; no membership purchase or private account credential is embedded in repository files. The successful distribution export verifies current signing access. App Store Connect Business also confirms **Free Apps Agreement: Active**. The EU trader declaration and privacy-publication confirmation remain separate pending steps.

## Prepared release materials

- [Store and TestFlight metadata](../app-store/metadata.en-US.json): current product copy. Missing publisher/account/contact values are `null`, not invented data.
- [Review notes](../app-store/review-notes.md): current date-picker, checklist, file, equation, calendar, and sandbox walkthrough. Validate it on the submitted builds.
- [Privacy answers](../app-store/privacy-answers.md): implementation evidence for privacy labels, manifests, export compliance, and the native package boundary.
- [Public site source](../app-store/site/): publisher, effective date, and support email are filled; draft notices and `noindex` were removed. [Support](https://kihyukh.github.io/todo-app/support.html), [privacy policy](https://kihyukh.github.io/todo-app/privacy.html), and the [landing page](https://kihyukh.github.io/todo-app/) are published through GitHub Pages from the root of branch `codex/app-store-site`, site commit `1ccc663`. Both required policy/support URLs returned HTTP 200 and matched the source byte for byte after publication.
- [Screenshot sheet](../app-store/screenshots.md): capture guidance plus the four uploaded native iPhone/iPad assets and integrity manifest. The Mac set is still pending.

Apple requires a privacy-policy link both in App Store Connect and inside the app. The support URL must lead to actual support information. The native release embeds `VITE_PUBLIC_PRIVACY_URL` and `VITE_PUBLIC_SUPPORT_URL`; their format is checked before export/upload, but the publisher must still confirm that both pages are publicly reachable and accurate. [Privacy requirements](https://developer.apple.com/app-store/review/guidelines/#privacy), [platform metadata fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)

## Signed artifact status

The iOS release export is at `~/Library/Caches/GreenDay/AppStore/iOS-Signed/Export/Daymark.ipa`, with its archive at `~/Library/Caches/GreenDay/AppStore/iOS-Signed/GreenDay.xcarchive`. A read-only audit passed strict code-signature verification and confirmed an Apple Distribution certificate chain, the expected app identifier, an App Store provisioning profile without device restrictions, `get-task-allow=false`, and `beta-reports-active=true`.

Its 62 web resource files match the signed archive exactly and embed both public support/privacy URLs. The production-native resource audit and privacy-manifest comparison passed. The exported IPA SHA-256 is `bb0b47425512735f80bd688c14e735a6aba6c265843bec81c8ef0cacd7dbe2c8`. See [IOS-VALIDATION.md](IOS-VALIDATION.md) for scope and remaining runtime checks. Export and signature verification do not establish App Store processing or App Review approval.

The universal Mac package is at `~/Library/Caches/GreenDay/AppStore/macOS-Signed/Export/GreenDay.pkg`, with its archive at `~/Library/Caches/GreenDay/AppStore/macOS-Signed/GreenDay.xcarchive`. The installer uses the **3rd Party Mac Developer Installer** certificate; the enclosed application passed strict code-signature verification using **Apple Distribution**. Both certificate chains lead through Apple Worldwide Developer Relations to Apple Root CA. The app is arm64/x86_64, has hardened runtime and the expected App Sandbox entitlements, and carries a matching App Store provisioning profile without device restrictions or a debug entitlement.

The Mac export's 62 web files match its signed archive and the iOS package's web content. Both published URLs, the native privacy manifest, and the icon are present. Its SHA-256 is `a92045351f5b0a298d18520334cada4965627b93d847d1904b5e12143a94a514`. These were local export audits only; the packages were not installed over the user's working app or workspace. The subsequent uploads used the existing audited archives without rebuilding or retrying. Both `build/ios-upload.log` and `build/macos-upload.log` report “Uploaded package is processing,” “Upload succeeded,” and `EXPORT SUCCEEDED`, with command exit status 0. Upload success is distinct from completed processing, build selection, and App Review submission.

For final screenshot recapture, the Release simulator app at `~/Library/Caches/GreenDay/AppStore/Simulator-Final/Build/Products/Release-iphonesimulator/Daymark.app` was rebuilt from current source with the final public URLs. Its **62 web files, 2,572,298 bytes**, match the signed iOS archive byte for byte. It retains isolated QA identifier `app.daymark.mobile` and was installed in place on iPhone 17 Pro Max and iPad Pro 13-inch simulators. Four reviewed screenshots were captured from the relaunched native simulators and uploaded: one iPhone 6.9-inch image and three iPad 13-inch images. Assets and hashes are in `app-store/screenshots/ios`. The user's real app and workspace were untouched.

## Local archive and upload tools

Use the `--help` options for the complete configuration. These scripts never install over the user's working Mac app.

| Command                                      | Result                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bash scripts/build-ios.sh --simulator`      | iPhone/iPad simulator build                                                             |
| `bash scripts/build-ios.sh --archive`        | Unsigned device archive by default                                                      |
| `bash scripts/build-mac-store.sh --unsigned` | Universal Mac validation archive                                                        |
| `bash scripts/release-ios.sh --export`       | Signed iOS archive and local App Store IPA                                              |
| `bash scripts/release-mac.sh --export`       | Signed universal Mac archive and local store package                                    |
| Either release script with `--upload`        | Explicit App Store Connect upload for processing; does not submit for review or release |

Both release scripts require `DAYMARK_DEVELOPMENT_TEAM`, the platform's `DAYMARK_IOS_BUNDLE_IDENTIFIER` or `DAYMARK_MAC_BUNDLE_IDENTIFIER`, `DAYMARK_VERSION`, an unused positive `DAYMARK_BUILD_NUMBER`, `VITE_PUBLIC_PRIVACY_URL`, and `VITE_PUBLIC_SUPPORT_URL`. The Mac release also requires `DAYMARK_COPYRIGHT` containing the actual publisher's notice. `DAYMARK_PUBLIC_PRIVACY_URL` and `DAYMARK_PUBLIC_SUPPORT_URL` are aliases for the canonical Vite URL variables. Keep private account credentials and review contacts out of repository files.

The iOS archive/export paths default to `build/Daymark.xcarchive` and `build/app-store`. Mac store output defaults to `~/Library/Caches/GreenDay/AppStore/macOS`, away from the iCloud-managed repository. Override the documented output paths if needed. Release scripts rebuild the repository's UI and refuse a different `DAYMARK_WEB_DIST`, preventing a stale custom browser build from being uploaded accidentally.

Run platform release scripts sequentially: both regenerate the shared Xcode project and rebuild the repository's `dist` directory.

Native UI builds set `VITE_NATIVE_APP=1`: PDFs use system viewers, and browser-only PDF.js assets/fonts are excluded. `scripts/verify-web-release.mjs <directory> --native` checks the production asset inventory. `scripts/verify-public-urls.mjs` validates the two release URL environment values without contacting a server. Xcode signing uses the signed-in account; no password or API key is placed in these scripts.

Release-tool preparation passed 40 checks against temporary fixtures: valid production files and public URL formats; rejection of unknown files, source maps, symlinks, workspace directories, browser PDF assets, missing/remote entry resources, and invalid/local/placeholder URLs; plus script help and early failures before any build. Shell syntax and metadata-length checks passed. These checks did not sign, upload, publish, or use a personal workspace.

For iOS uploads, Apple's current requirement is Xcode 26 or later with the iOS 26 SDK or later, effective 28 April 2026. This does not raise the app's iOS 16 deployment target. Recheck requirements immediately before upload. [Apple SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)

## Build and privacy checks

1. Inspect each final archive's app identifier, version/build, icon, display name, copyright where applicable, entitlements, and privacy manifest. Mac uses App Sandbox and a separate Xcode target; the older ad hoc development bundle is not the store package. [Mac submission rules](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)
2. Confirm only application resources and fictional examples are packaged. The production-web check rejects unknown files, symlinks, source maps, workspace folders, and browser PDF resources. Manually review approved image/string content too; an asset filename allowlist cannot detect all personal data.
3. Generate Xcode's privacy report. Current native manifests declare own-app preferences (`CA92.1`); Mac also declares elapsed time between in-app events (`35F9.1`) for window dragging. The saved App Privacy draft says Data Not Collected, based on the exact archive and publisher practices documented in [privacy-answers.md](../app-store/privacy-answers.md).
4. Confirm native open-source notices are included and match the native bundle. Browser PDF.js, its codecs, CMaps, and Liberation fonts are excluded from native builds; browser distribution remains a separate package audit.
5. Use the actual release settings to test public links, sandbox first launch and folder reauthorization, imported file reopening, local offline edits, iPhone background/relaunch saves, and two-device iCloud delivery. Use a separate fictional workspace and dedicated test calendar. A local Saved label does not certify cloud upload completion.

## TestFlight and public submission

Both builds have completed processing, and their version selections, private review contacts, and review notes are saved. Resolve the remaining version requirements below. The saved age-rating questionnaire calculates **4+**, with regional exceptions displayed by Apple. Only declare accessibility features tested on the final builds. Apple's TestFlight service supports internal and external groups; an external beta may require review. [App record creation](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app), [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)

Before public submission, capture and upload the Mac screenshot, finish physical-iPhone and iCloud checks, obtain the user's applicable trader declaration, and publish the privacy draft after confirmation. Both platform listings, free global pricing, and availability are already saved. The current release option remains Apple’s automatic-after-approval default; no submission has been made. [Trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements), [release options](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option)

No demo login is needed, and the App Review contact is saved on both platforms. App Review still requires a complete, working build. Signed-device, sandbox, calendar-provider, and final screenshot checks remain release gates until their results are recorded.
