# DocSwap Play Console Upload Checklist

Last reviewed: April 28, 2026

Use this checklist before submitting DocSwap to Google Play.

## 1. Mandatory app package checks

- [ ] Use an Android App Bundle (`.aab`) for upload.
- [ ] Confirm package name is correct: `com.docswap.app`.
- [ ] Confirm app name is correct: `DocSwap`.
- [ ] Confirm `versionCode` is higher than any previously uploaded build.
- [ ] Confirm `versionName` is the user-facing release version you want.
- [ ] Confirm release build targets modern Play requirements.

Current project state:
- Package name: `com.docswap.app`
- App name: `DocSwap`
- Current `versionCode`: `1`
- Current `versionName`: `1.0`
- Current `targetSdkVersion`: `36`

Project references:
- `android/app/build.gradle`
- `android/variables.gradle`
- `capacitor.config.ts`

## 2. Release signing checks

- [ ] Do not upload a debug-signed build.
- [ ] Create or provide a release upload keystore.
- [ ] Add `android/keystore.properties`, or set `DOCSWAP_UPLOAD_*` environment variables.
- [ ] Run `.\gradlew.bat printReleaseSigningStatus` and make sure it says `Release signing is configured.`
- [ ] Build the signed bundle with `.\gradlew.bat bundleRelease`.
- [ ] Keep the keystore and passwords backed up securely.

Current project state:
- Release signing is configured.
- Signed release bundle has been built successfully.

Helpful files:
- `android/keystore.properties.example`
- `android/app/build.gradle`
- `PLAY_STORE_SUBMISSION.md`

## 3. Privacy policy checks

- [ ] Public privacy policy URL works without login.
- [ ] Privacy policy URL in Play Console matches the public page.
- [ ] In-app privacy policy is present and accessible.
- [ ] Public privacy policy and in-app privacy policy match in substance.
- [ ] Developer contact email is shown in the policy.
- [ ] Last updated date is correct everywhere.

Current DocSwap policy values:
- Public policy URL: `https://sites.google.com/view/docswapepdftoword`
- Privacy contact email: `docswappdf@gmail.com`
- Last updated date: `April 28, 2026`

Policy references:
- `src/app/tab3/tab3.page.html`
- `https://sites.google.com/view/docswapepdftoword`

Note:
- The public page appears synced with the in-app policy content.
- The public page title still appears as `docswape PDF To Word`, so fix that typo in Google Sites if possible.

## 4. Data safety form checks

- [ ] Do not answer `No data collected`.
- [ ] Declare `Files and docs`.
- [ ] Declare IP-related handling conservatively under `Device or other IDs` if using it for quota/security handling.
- [ ] Answer `Yes` for encryption in transit.
- [ ] Answer `Yes` for deletion request path, based on support email and local deletion options.
- [ ] Keep answers consistent with actual app behavior and privacy policy.

Recommended answers for current DocSwap behavior:

### Top-level answers

- [ ] `Does your app collect or share any of the required user data types?` -> `Yes`
- [ ] `Is all user data collected by your app encrypted in transit?` -> `Yes`
- [ ] `Do you provide a way for users to request that their data is deleted?` -> `Yes`

### Data type: Files and docs

- [ ] Collected -> `Yes`
- [ ] Shared -> `No` if Cloudmersive is treated as your service provider in Play's form
- [ ] Required -> `Yes`
- [ ] Purposes:
  - `App functionality`
  - `Fraud prevention, security, and compliance`

Why this applies:
- The app sends selected PDF content and file names to the backend for conversion.

### Data type: Device or other IDs

- [ ] Collected -> `Yes`
- [ ] Shared -> `No` if used only by your backend/service providers
- [ ] Required -> `Yes`
- [ ] Purposes:
  - `Fraud prevention, security, and compliance`

Why this applies:
- Backend logic uses client address / equivalent connection data for quota, rate limiting, and abuse prevention.

Code references:
- `src/app/services/pdf-converter.service.ts`
- `functions/worker.mjs`
- `functions/server.js`
- `src/app/services/history.ts`

## 5. Store listing checks

- [ ] App title matches branding.
- [ ] Short description matches actual app behavior.
- [ ] Full description clearly explains remote conversion.
- [ ] Screenshots match the current UI.
- [ ] Feature graphic is ready if required by your listing setup.
- [ ] App category is correct.
- [ ] Contact email is correct.
- [ ] Privacy policy URL is entered in Play Console.

Important wording recommendation:
- Mention that PDF conversion uses a remote processing service.
- Do not imply fully offline conversion.

## 6. App content checks

- [ ] Confirm the app does not create user accounts.
- [ ] If Play Console asks about account deletion, answer consistently with `no in-app account system`.
- [ ] Confirm the app is not directed at children unless you intentionally choose that audience.
- [ ] Review whether your app needs any special declarations for user-generated content, health, finance, or government categories.

Current DocSwap behavior:
- No in-app account creation
- No visible ads SDK
- No visible analytics SDK
- No broad storage permission request in the main manifest

## 7. Technical verification checks

- [ ] Run web build successfully.
- [ ] Run signed Android release bundle build successfully.
- [ ] Test file picking on Android.
- [ ] Test conversion success flow.
- [ ] Test quota-exhausted message.
- [ ] Test open/share actions.
- [ ] Test history persistence and deletion.
- [ ] Test privacy policy tab opens correctly.

Previously verified in this repo:
- Web build succeeded with `npm run build`.
- Android release bundle task succeeded.
- Signed release bundle verification completed.

Still needed before real upload:
- Manual device testing and Play Console form completion.

## 8. Final upload items

- [ ] Signed `.aab`
- [ ] Release notes
- [ ] Privacy policy URL
- [ ] Data safety answers
- [ ] Store listing text
- [ ] Screenshots
- [ ] Contact details

Expected upload file after signed build:
- `android/app/build/outputs/bundle/release/app-release.aab`

## 9. Ready / blocked summary

Ready now:
- Privacy policy content
- Public policy URL content sync
- Target SDK compliance
- Signed Android bundle generation

Blocked right now:
- Final Play Console Data safety answers still need to be entered manually
- Store assets and listing text still need final review
