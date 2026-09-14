# App Store and TestFlight delivery

Prepared against Apple’s documentation on 14 September 2026. **Daymark is the working name; the public name and publisher are not yet selected.** Nothing in this folder creates an App Store record, accepts an agreement, uploads a build, or publishes a website.

See [iPhone build validation](IOS-VALIDATION.md) for executed checks and the remaining simulator, hardware, and account checks.

## Decisions needed to finish

| Input | Where it is used |
| --- | --- |
| Final app name and Apple Developer team | Signing, the App Store record, screenshots, policy pages |
| Publisher/copyright owner | Store listing and privacy policy |
| Public support email and hosting location | Support page and publicly accessible privacy policy URL |
| Private review contact: name, email, international-format phone | App Review and TestFlight contact fields; do not commit these details |
| Initial distribution: personal TestFlight or public App Store; price and countries | App Store Connect configuration |

The Account Holder must resolve membership and agreement requirements in their own account. Apple Developer Program membership is normally USD 99 per year, with local pricing and some fee waivers. No purchase is part of this preparation. [Apple membership details](https://developer.apple.com/help/account/membership/program-enrollment)

## Prepared material

- [`app-store/metadata.en-US.json`](../app-store/metadata.en-US.json): listing and beta copy, with explicit unresolved identity/contact fields.
- [`app-store/review-notes.md`](../app-store/review-notes.md): a short review walkthrough using synthetic tasks.
- [`app-store/privacy-answers.md`](../app-store/privacy-answers.md): code-based privacy, encryption, and age-rating answers to confirm against the archive.
- [`app-store/site/`](../app-store/site/): self-contained privacy and support page drafts. Fill every `__PLACEHOLDER__`, remove the draft banner, and publish them at the chosen HTTPS location. They use no scripts, external fonts, or analytics.
- [`app-store/screenshots.md`](../app-store/screenshots.md): four useful screenshots to capture from a clean example workspace.

## Build and beta sequence

1. Choose final bundle identifiers and an SKU, then create the matching app record in App Store Connect. Keep the bundle identifiers consistent between Xcode, provisioning, and the store record. [Apple’s app-record workflow](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-workflow)
2. Use [`scripts/release-ios.sh`](../scripts/release-ios.sh) for the archive/export workflow and the signing inputs documented in the repository README. Archive the signed **iOS application**, not the local browser preview or the ad hoc Mac development bundle. Since 28 April 2026, iOS uploads require Xcode 26 or later and the iOS 26 SDK or later; this build-SDK rule does not require raising the app’s minimum supported iOS version to 26. Recheck the requirement on the day of upload. [Apple SDK requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
3. In the archive, verify the application icon, display name, bundle/version/build identifiers, privacy manifest, and bundled web assets. Use an App Store Connect distribution upload, rather than “TestFlight Internal Only,” if the same build may later go to public review. [Apple’s beta distribution tutorial](https://developer.apple.com/tutorials/develop-in-swift/test-your-beta-app)
4. After processing, resolve the encryption questions, add the beta description and real feedback contact, and assign the build to a tester group. Internal testing supports up to 100 App Store Connect users; external testing supports up to 10,000 people and its first build requires review. TestFlight builds expire after 90 days. [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)

## Checks before public submission

- **Real-device save and sync:** create a test workspace; edit while offline; background and reopen the iPhone app; edit a different task on Mac; reconnect and verify both changes. Select the same iCloud Drive workspace folder on both devices. Confirm images/PDFs download and reopen. A local “saved” result is not a guarantee that iCloud finished uploading.
- **Release data boundary:** the bundle contains application code, icons, fonts, and clearly fictional examples only. No migration exports, personal tasks, attachment files, support credentials, or local workspace backups belong in it.
- **Privacy access:** finish and publish the policy and support pages, populate their URLs in App Store Connect, and check that the in-app policy matches the public version. A bundled policy is useful offline but does not replace the public URL. Apple requires both the metadata policy URL and an easily accessible in-app link. A support page must contain actual contact information. [Review privacy rules](https://developer.apple.com/app-store/review/guidelines/#privacy), [store fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- **Accurate claims:** use screenshots of the actual release build, answer the current age-rating questions, and declare only accessibility features tested on that build. Price, countries, trader status, and release timing remain publisher decisions. Apple requests a trader-status declaration, including for developers not distributing in the EU. [Trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)
- **Submission:** select the tested build, provide the review contact and notes, and choose manual release if the publisher wants to inspect approval before going live. No demo account is needed because this app has no sign-in.

## Separate Mac App Store gate

The installed Mac development build is not proof of Mac App Store readiness. Mac App Store submissions require App Sandbox. In a sandboxed build, the development shortcut that directly locates `~/Library/Mobile Documents/com~apple~CloudDocs/Daymark` must be replaced or bypassed by permitted storage access, such as the existing user-selected workspace folder and security-scoped bookmark flow. Verify first launch, bookmark restoration, attachments, external links, and an upgrade from the development workspace under the actual release entitlements. [Apple sandbox configuration](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)

Prepare a distinct, signed Mac archive and its own Mac screenshots when that target passes these checks. Do not advertise Mac App Store availability before approval.
