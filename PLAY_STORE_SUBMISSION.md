# DocSwap Play Store Submission Notes

Last reviewed: April 28, 2026

## 1. Release signing

Google Play uploads should use a release/upload keystore, not the debug keystore.

This project now supports two safe ways to provide release signing secrets:

1. Create `android/keystore.properties` from `android/keystore.properties.example`.
2. Or set these environment variables:
   - `DOCSWAP_UPLOAD_STORE_FILE`
   - `DOCSWAP_UPLOAD_STORE_PASSWORD`
   - `DOCSWAP_UPLOAD_KEY_ALIAS`
   - `DOCSWAP_UPLOAD_KEY_PASSWORD`

Example `android/keystore.properties`:

```properties
storeFile=docswap-upload.jks
storePassword=your-store-password
keyAlias=docswap-upload
keyPassword=your-key-password
```

Useful commands:

```powershell
cd android
.\gradlew.bat printReleaseSigningStatus
.\gradlew.bat bundleRelease
```

Example command to generate a new upload keystore:

```powershell
keytool -genkeypair -v -keystore android\docswap-upload.jks -alias docswap-upload -keyalg RSA -keysize 2048 -validity 10000
```

Important:
- The first upload key you use becomes important long-term for updates.
- Keep the keystore and passwords backed up securely.
- `android/keystore.properties` and common keystore file extensions are ignored by git.

## 2. Current app behavior summary

DocSwap currently:
- Lets users pick a PDF and send it to the DocSwap backend for conversion.
- Sends the file name and PDF content to the backend.
- Uses a remote conversion provider, Cloudmersive, as a service provider.
- Stores conversion history locally on device/browser.
- Stores converted files locally on device/browser.
- Uses IP-based quota and abuse prevention on the backend.
- Does not create in-app accounts.
- Does not include Firebase Analytics, AdMob, or other visible third-party analytics SDKs in the current build.

## 3. Recommended Data safety answers

These are recommended answers based on the code currently in this repo. Review again before publishing if behavior changes.

### Data collection and security

- Does your app collect or share any of the required user data types?
  - `Yes`
- Is all data encrypted in transit?
  - `Yes`
- Do you provide a way for users to request that their data is deleted?
  - `Yes`
  - Basis: privacy contact email `docswappdf@gmail.com` and in-app/local deletion options.

### Data types to declare

1. `Files and docs`
   - Collected: `Yes`
   - Shared: `No`, if Cloudmersive is treated as your service provider in the Play Data safety form
   - Required or optional: `Required`
   - Purposes:
     - `App functionality`
     - `Fraud prevention, security, and compliance`
   - Why:
     - The app sends PDF content and file names to the backend for conversion.
     - File metadata may appear in technical logs related to reliability and abuse prevention.

2. `Device or other IDs`
   - Collected: `Yes`
   - Shared: `No`, if used only by your backend/service providers
   - Required or optional: `Required`
   - Purposes:
     - `Fraud prevention, security, and compliance`
   - Why:
     - The backend uses client IP or equivalent connection information for quota enforcement, rate limiting, and abuse prevention.
   - Note:
     - This is a conservative mapping for Play Console because Google says IP handling must be disclosed according to how it is used.

### Data types that likely do not need declaration

- Local conversion history stored only on device/browser, if not transmitted off-device.
- Local file paths/URIs stored only on device.
- Share/open actions triggered directly by the user.
- Ads data, because the current app does not appear to include ads SDKs.
- Analytics data, because the current app does not appear to include analytics/tracking SDKs.

## 4. Privacy policy checklist

Google Play requires:
- A privacy policy link in Play Console.
- A privacy policy link or text inside the app.
- A public, active, non-PDF, non-geofenced URL.
- Policy content that matches actual app behavior.

DocSwap currently has in-app privacy policy content in:
- `src/app/tab3/tab3.page.html`

Public URL to verify manually:
- `https://sites.google.com/view/docswapepdftoword`

Before publishing, confirm:
- The page opens without login.
- The developer or publisher name shown in Play listing is named in the policy, or the app name is clearly identified.
- The public page matches the in-app policy in substance.

## 5. Known pre-publish checks

- `targetSdkVersion` is `36`, which is above the Google Play minimum requirement for current submissions.
- Release `.aab` can be built.
- Without release signing secrets, the generated release bundle is still not ready for Play upload.
