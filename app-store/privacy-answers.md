# Privacy answers and native package audit

Prepared 15 September 2026 for the Mac and iPhone App Store release.

This records the implementation assessment, not answers already submitted to Apple. Revisit it if the release adds a server, analytics, crash-reporting SDK, ads, account system, or embedded third-party service.

## App Privacy

Proposed answer: **No, we do not collect data from this app.** The app has no developer-operated service or analytics endpoint. Tasks, notes, images, and selected files remain in the user’s local workspace or chosen file-provider folder. The developer cannot access a user’s private iCloud Drive through this app. Calendar access uses EventKit with explicit permission; calendar credentials stay with the system. Event reads remain in memory, while linked event titles, dates, and identifiers are saved in the user’s task workspace. Event edits are sent to the calendar provider through Apple Calendar. User-entered external links and remote images are addressed explicitly in the policy draft.

This conclusion is based on the current code. Apple distinguishes on-device processing from collection and says developers are not responsible for disclosing data collected by Apple itself. Any data the publisher actually receives from an Apple service must be assessed separately. A privacy policy URL is required even when no data is collected. [Apple privacy guidance](https://developer.apple.com/app-store/app-privacy-details/), [App Store Connect privacy fields](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)

Do not promise “no network requests”: user-chosen iCloud/file-provider and calendar-account syncing, remote note images, external links, and TestFlight services can use the network. Optional support correspondence can contain the contact details and information the user chooses to send. Do not request an entire private workspace to investigate a bug.

## Privacy manifest

| Manifest item                                | Current implementation                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NSPrivacyTracking`                          | `false`; no tracking domains                                                                                                                                                                   |
| `NSPrivacyCollectedDataTypes`                | Empty array, subject to the final archive audit                                                                                                                                                |
| `NSPrivacyAccessedAPICategoryUserDefaults`   | `CA92.1`: the app reads/writes its own workspace bookmark and preferences                                                                                                                      |
| `NSPrivacyAccessedAPICategorySystemBootTime` | Mac only: `35F9.1`; `ProcessInfo.systemUptime` checks elapsed time since an in-app mouse-down before moving the window. The value is not sent off-device. iOS has no corresponding direct use. |
| File timestamp, disk space, active keyboards | No direct use found in the native source audit; do not add reasons without an actual use                                                                                                       |

Task dates are values inside the app’s JSON records; they are not filesystem timestamp reads. File byte counts use loaded `Data.count`. The Mac manifest is `native/macOS/PrivacyInfo.xcprivacy`; iOS has its own manifest at `native/iOS/PrivacyInfo.xcprivacy`. The app uses Apple frameworks and bundled JavaScript libraries, with no native third-party telemetry SDK found. Inspect Xcode’s generated privacy report and the final archive for any changed dependencies. [Apple required-reason API guidance](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), [approved API reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)

## Export compliance

Proposed `ITSAppUsesNonExemptEncryption`: **NO** for the current implementation. The app provides no proprietary encryption, VPN, secure messenger, or file-encryption feature. Apple handles HTTPS and file-provider transport; CryptoKit SHA-256 is used to name recovery revisions by their content, not to encrypt tasks. Confirm the exact archive and dependency set before affirming the questionnaire. This does not assert that the app uses no cryptography or that every possible reporting obligation is waived. [Apple export guidance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations), [the Info.plist key](https://developer.apple.com/documentation/BundleResources/Information-Property-List/ITSAppUsesNonExemptEncryption)

## Age rating and review access

The current app contains no ads, gambling, chat, social feed, public content sharing, medical advice, or unrestricted in-app web browser. Private notes are not a broadly distributed user-content service; arbitrary web links open in the external browser. Answer the current questionnaire on that basis and let App Store Connect calculate the rating. Do not hardcode a rating before completing it. No reviewer login is required. [Apple age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions)

## Native package and license boundary

Native UI builds set `VITE_NATIVE_APP=1`. PDFs open through system viewers, and the browser-only PDF.js viewer is excluded from these bundles. This also excludes PDF.js's Liberation font binaries and their GPL-with-exception distribution terms from the native App Store packages. Do not substitute an ordinary browser `dist` directory when archiving. Native builds include a separate generated notice collection for their actual runtime package set.

The browser development build still uses PDF.js, including its CMaps, codecs, and standard fonts. Its aggregated notices preserve the PDF.js and embedded-resource licenses. This native release assessment does not approve a separately distributed browser package or satisfy any additional source-distribution obligations for that package.

`verify-web-release.mjs --native` rejects browser PDF assets, source maps, symlinks, unrecognized output, workspace folders, and non-bundled entry resources. The final archive still needs an inventory review: the allowlist validates package structure, not the truth or privacy of every image or string in approved asset files. Only the fictional `createInitialState` examples may be bundled; migration snapshots, private tasks, credentials, and workspace attachments stay outside the app resources.

No policy/support site has been published by this audit. The HTML drafts contain no script, external font, form, or analytics service. Their publisher, support email, and effective date remain unresolved. Actual hosting practices must match the final policy. The signed release must receive the real public URLs through `VITE_PUBLIC_PRIVACY_URL` and `VITE_PUBLIC_SUPPORT_URL`; the app exposes those links in Settings → Privacy. A placeholder-free URL format check is not proof that the pages are reachable or complete.
