# Playbook for a new Bradley Cowdrey app

Read this before starting a new app. It sums up how the existing apps are built, released and documented, so a new app matches them. The repositories are the source of truth: when this page and the code differ, the code wins.

## The apps

| | Cowdrey.MD | Meridian | Two Degrees | True North |
|---|---|---|---|---|
| Repo | [bradleycowdrey/cowdrey-md](https://github.com/bradleycowdrey/cowdrey-md) | [bradleycowdrey/meridian](https://github.com/bradleycowdrey/meridian) | [bradleycowdrey/two-degrees](https://github.com/bradleycowdrey/two-degrees) | [bradleycowdrey/true-north](https://github.com/bradleycowdrey/true-north) |
| What it is | Markdown editor | World clock and time-zone planner | Weather in °F and °C at once | Compass with coordinates, elevation and a map on one screen |
| How it's built | One web app (`src/`, built by `build.py` into `index.html`) wrapped by **Tauri 2** for Mac, iPhone, iPad and Android (`desktop/src-tauri`) | **SwiftUI** for Mac and iPhone, with widgets; **Kotlin and Jetpack Compose** for Android; web version hosted on bradcowdrey.com | **SwiftUI** for Mac, iPhone and iPad, with widgets; **Kotlin** for Android; web version on GitHub Pages, served through bradcowdrey.com | **SwiftUI** for Mac, iPhone and iPad (one shared screen, MapKit); **Kotlin and Jetpack Compose** for Android (MapLibre with OpenFreeMap, no Play services); web version on GitHub Pages. Coordinate maths tested against one shared fixture on all three |
| Mac | Notarized DMG on GitHub Releases, in-place updates (Tauri updater, signed `updates/latest.json`) | DMG on GitHub Releases, update check against the GitHub releases API | DMG on GitHub Releases, update banner | DMG on GitHub Releases, update banner (no compass on a Mac: coordinates, elevation, map) |
| iPhone and iPad | App Store (TestFlight builds from CI) | App Store (iPhone only) | App Store and TestFlight | App Store and TestFlight (workflow ready) |
| Android | Signed APK on the GitHub release | APK | Signed APK on the GitHub release | Signed APK on the GitHub release |
| Web | bradcowdrey.com/cowdrey-md | bradcowdrey.com/meridian | bradcowdrey.com/two-degrees | bradcowdrey.com/true-north |

Read each repo's `README.md`, `CHANGELOG.md` and `.github/workflows/` to see the patterns in full.

## Principles shared by every app

- **Free, open source (MIT), no accounts, no ads, no analytics, no tracking.** Data stays on the device.
- **Made by Bradley Cowdrey · bradcowdrey.com** in the README header, the About box and the product page.
- **Plain, consistent wording** in the interface and docs. Apple's style where it applies (e.g. "10:21 PM", "+1 hr").
- **Works on every platform** the app targets, with a layout made for each (Mac menus and shortcuts, iPhone sheets and safe areas, Android Back button and edge-to-edge).
- **Tested in CI**: a self-test or end-to-end test suite runs on every push; build logs are published to a public branch (`ios-build-log`, `android-build-log`) so they can be read without signing in.

## Terms of Use and Privacy (one shared document)

- **Canonical file:** [`TERMS.md` in cowdrey-md](https://github.com/bradleycowdrey/cowdrey-md/blob/main/TERMS.md). It covers every app and future apps. Each app repo keeps a copy synced from it, and **bradcowdrey.com/legal** renders it live.
- **Before a new app is released, add it to the terms** (Section 1 lists exactly where):
  - Section 6: a notice for the app (its main risk and what users must check themselves);
  - Section 15: what it stores, what leaves the device and where it goes, location, update and terms checks;
  - Section 25: a column in the disclosures table;
  - Sections 9, 22 and 26 if it uses new services, open-source software or data that needs credit.
- **Agreement in the app:** ask on first launch, and again when the terms change, **at most once a month**. Cowdrey.MD and Meridian read `TERMS.md` from `raw.githubusercontent.com/bradleycowdrey/cowdrey-md/main/TERMS.md` at most once a day; Two Degrees builds the terms version into each release. The dialog offers **I Agree**, **Read the Terms** (opens bradcowdrey.com/legal) and **Quit**.
- After editing `TERMS.md`: rebuild Cowdrey.MD (`python3 build.py` updates the built-in hash), sync the copy into each app repo, and ask Lovable to refresh `src/content/legal-fallback.md`.

## Website (bradcowdrey.com, a Lovable project)

- Each app has a product page on bradcowdrey.com with download buttons for every platform, the web version running in the page where possible, and Share buttons. The software section of the home page lists every app.
- Downloads go through an email gate (`public/download-gate.js`) that stores the address with the app's name; the consent wording links to /legal.
- Website changes are made by sending instructions to the Lovable project, then deploying.

## Release and signing

- **Version** in every manifest at once, plus a `CHANGELOG.md` entry written for users ("What's new").
- **Mac:** Developer ID signing and notarization in CI; the update is published after the release exists.
- **iPhone and iPad:** App Store Connect API key (Team key, Admin access) in repo secrets; CI builds, signs and uploads to TestFlight. The Info.plist sets `ITSAppUsesNonExemptEncryption = false`. App Store listing text and screenshots are kept in the repo and uploaded by a workflow; submission for review is done by Bradley.
- **Android:** upload keystore in repo secrets (`ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`); CI signs the APK and App Bundle and runs an emulator smoke test.
- **Never** put private keys, passwords or secret values in a repository or in chat; Bradley adds secrets in GitHub settings himself.

## Working conventions

- Commit only what was asked; push to `main` unless told otherwise. Merging pull requests is left to Bradley.
- Commit messages explain what changed for users and why. No model names in commits, code or docs.
- Before saying something works, check it: run the tests, read the CI log, and say plainly what was and wasn't verified on a real device.
