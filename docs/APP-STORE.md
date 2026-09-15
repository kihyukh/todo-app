# GreenDay App Store release

Prepared against Apple's current documentation on **15 September 2026**. The release target is a native Mac app plus the iPhone/iPad app. **App Store Connect and the Apple Developer account are signed in, but both report that the Developer Program membership has expired.** No local signing identity is available, and no build has been uploaded, submitted, or released. Public privacy/support pages and final screenshots are not published or ready for submission yet.

Executed app and device checks belong in [IOS-VALIDATION.md](IOS-VALIDATION.md). An unsigned archive validates compilation and resources; it cannot prove distribution signing, calendar permission continuity, file-provider delivery, or App Review acceptance.

## Remaining publisher inputs

| Input                                                            | Needed for                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| Renew expired Developer Program membership; configure the Xcode signing team and required agreements | Signing, provisioning, and release access |
| Registered release bundle identifier and available GreenDay name | App record and both platform archives                  |
| Actual publisher/copyright owner and public support email        | Store metadata, Mac copyright field, public pages      |
| Chosen public HTTPS hosting URLs for privacy and support         | Store fields and the links embedded in each release    |
| Private review contact: name, email, international-format phone  | App Review and TestFlight; enter privately, not in Git |
| Price, countries/regions, trader status, and release timing      | Distribution settings; no choices have been submitted  |

Prefer one GreenDay app record with iOS and macOS platforms, using the **same release bundle identifier** for both native targets. Apple requires matching identifiers for a universal purchase; separate records cannot simply be merged later. Development identifiers may remain separate from the configured release identifier. Reserve the final identifier against the publisher's account before archiving. [Apple platform workflow](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)

The Developer account currently offers **Renew membership** and displays a **US$99 annual fee**. The user was asked to renew through their own account; no renewal, payment, or agreement acceptance was attempted. After renewal, verify active membership and configure the signing team in Xcode before generating distribution packages. The scripts do not purchase membership, create an account, or accept agreements. [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment)

## Prepared release materials

- [Store and TestFlight metadata](../app-store/metadata.en-US.json): current product copy. Missing publisher/account/contact values are `null`, not invented data.
- [Review notes](../app-store/review-notes.md): current date-picker, checklist, file, equation, calendar, and sandbox walkthrough. Validate it on the submitted builds.
- [Privacy answers](../app-store/privacy-answers.md): implementation evidence for privacy labels, manifests, export compliance, and the native package boundary.
- [Public privacy/support pages](../app-store/site/): self-contained green-themed drafts. Complete every `__PLACEHOLDER__`, remove the draft notice and `noindex` marker, then publish at the chosen HTTPS location. No website was deployed during preparation.
- [Screenshot sheet](../app-store/screenshots.md): five concrete shots for each platform, using fictional data. The iOS target also supports iPad, so its required 13-inch set must be captured.

Apple requires a privacy-policy link both in App Store Connect and inside the app. The support URL must lead to actual support information. The native release embeds `VITE_PUBLIC_PRIVACY_URL` and `VITE_PUBLIC_SUPPORT_URL`; their format is checked before export/upload, but the publisher must still confirm that both pages are publicly reachable and accurate. [Privacy requirements](https://developer.apple.com/app-store/review/guidelines/#privacy), [platform metadata fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)

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

Native UI builds set `VITE_NATIVE_APP=1`: PDFs use system viewers, and browser-only PDF.js assets/fonts are excluded. `scripts/verify-web-release.mjs <directory> --native` checks the production asset inventory. `scripts/verify-public-urls.mjs` validates the two release URL environment values without contacting a server. Xcode signing uses the signed-in account; no password or API key is placed in these scripts.

Release-tool preparation passed 40 checks against temporary fixtures: valid production files and public URL formats; rejection of unknown files, source maps, symlinks, workspace directories, browser PDF assets, missing/remote entry resources, and invalid/local/placeholder URLs; plus script help and early failures before any build. Shell syntax and metadata-length checks passed. These checks did not sign, upload, publish, or use a personal workspace.

For iOS uploads, Apple's current requirement is Xcode 26 or later with the iOS 26 SDK or later, effective 28 April 2026. This does not raise the app's iOS 16 deployment target. Recheck requirements immediately before upload. [Apple SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)

## Build and privacy checks

1. Inspect each final archive's app identifier, version/build, icon, display name, copyright where applicable, entitlements, and privacy manifest. Mac uses App Sandbox and a separate Xcode target; the older ad hoc development bundle is not the store package. [Mac submission rules](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)
2. Confirm only application resources and fictional examples are packaged. The production-web check rejects unknown files, symlinks, source maps, workspace folders, and browser PDF resources. Manually review approved image/string content too; an asset filename allowlist cannot detect all personal data.
3. Generate Xcode's privacy report. Current native manifests declare own-app preferences (`CA92.1`); Mac also declares elapsed time between in-app events (`35F9.1`) for window dragging. Proposed App Privacy answer is no developer-collected data, subject to the exact archive and publisher practices documented in [privacy-answers.md](../app-store/privacy-answers.md).
4. Confirm native open-source notices are included and match the native bundle. Browser PDF.js, its codecs, CMaps, and Liberation fonts are excluded from native builds; browser distribution remains a separate package audit.
5. Use the actual release settings to test public links, sandbox first launch and folder reauthorization, imported file reopening, local offline edits, iPhone background/relaunch saves, and two-device iCloud delivery. Use a separate fictional workspace and dedicated test calendar. A local Saved label does not certify cloud upload completion.

## TestFlight and public submission

Create the app record after renewing membership and confirming the release identity. Upload the signed platform builds, wait for processing, select them for the appropriate versions, and resolve the encryption questions. Complete the current age-rating questionnaire and only declare accessibility features tested on the final builds. Apple's TestFlight service supports internal and external groups; an external beta may require review. [App record creation](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app), [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)

Before public submission, complete screenshots, support and privacy URLs, copyright, the real review contact, pricing/availability, and applicable trader declarations. Prefer manual release so approval can be reviewed before going live; this is a proposed setting, not a configuration already saved in the account. [Trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements), [release options](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option)

No demo login is needed. App Review still needs a reachable human contact and a complete, working build. Signed-device, sandbox, calendar-provider, and final screenshot checks remain release gates until their results are recorded.
