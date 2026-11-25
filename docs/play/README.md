# Cowdrey.MD on Google Play

Everything Google Play shows for Cowdrey.MD lives in this folder:

| File | What it is |
|---|---|
| `listing.json` | Title (30 characters), short description (80), full description (4000), contact email and website |
| `icon.png` | 512 × 512 app icon, full-bleed (Play rounds the corners) |
| `feature-graphic.png` | 1024 × 500 banner at the top of the listing |
| `phone-1.png` … `phone-6.png` | Phone screenshots, 1080 × 2160, dark mode: the page, writing, maths and diagrams, page styles, documents, sharing |

Two workflows send it to Play with `.github/scripts/play_publish.py`:

- **Android app** (`android-app.yml`) uploads the signed App Bundle to the **closed test** for release builds: a push to `main` that changes the version in `desktop/src-tauri/tauri.conf.json`, or a run started by hand (Actions → Android app → Run workflow). Other Android builds don't go to Play.
- **Google Play listing** (`play-listing.yml`) updates the text and pictures when anything here (except this README) changes on `main`, or when run by hand.

Both need the repository secret **`PLAY_SERVICE_ACCOUNT_JSON`**; without it they skip Play and still pass. The App Bundle is signed with the upload key from the secrets the Android workflow already uses: `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`.

**Version codes.** Tauri makes Android's version code from the version number: major × 1,000,000 + minor × 1,000 + patch, so 2.0.2 is 2000002 and 2.0.3 is 2000003. Each new version has a higher code. A build of a version Play already has is skipped (`[SKIP]` in the log); to send a new build to testers, raise the version as for any release.

**Target API level.** Play requires new apps to target Android 16 (API 36) or later. The Android project is generated in CI by the Tauri CLI pinned in `desktop/package-lock.json` (2.12.1), which sets `compileSdk` and `targetSdk` to 37; the APK built on 25 November 2026 reports targetSdk 37 and asks only for the Internet permission. Check this again after updating the Tauri CLI.

**Updates.** Google Play updates the copy it installs. That copy hides Check for updates and never offers the APK from GitHub: Play's rules don't allow an app to update itself any other way, and Play signs its copy with Google's app signing key, so the APK (signed with the upload key) can't install over it. Switching between the Play copy and the GitHub APK means uninstalling the other first (export or sync your documents before). The APK on GitHub still checks for updates as before.

The screenshots are the app's own interface at a Pixel 7's width (412 dp), taken from the offline bundle the Android app ships (`desktop/dist`), with the fictional documents from the App Store screenshots. In `phone-3.png` the diagram's labels are drawn with the label fix from the `design-refresh` branch (one CSS rule), which isn't on `main` yet.

## One-time setup in Play Console

### 1. Create the app

Play Console → **Create app**:
- App name: **Cowdrey.MD Markdown Editor**
- Default language: **English (United States) – en-US**
- App or game: **App**; Free or paid: **Free**
- Accept the declarations, then **Create app**.

Play Console doesn't ask for the package name here. The app gets it (`com.bradcowdrey.cowdreymd`) from the first App Bundle you upload in step 3.

### 2. Set up the closed test

**Test and release → Testing → Closed testing.** Use the track Play made (**Closed testing – Alpha**; the workflow's `alpha` track is this one).
- **Countries / regions:** add the countries your testers are in (or all).
- **Testers:** create an email list with your testers' Google accounts (at least 12), and save. Copy the **join link** to send them.

### 3. Upload the first App Bundle by hand

Play only lets the workflow in after the app's first bundle has been uploaded in Play Console.

1. Get `Cowdrey.MD.aab`: GitHub → **Actions → Android app** → the latest successful run on `main` → **Artifacts → Cowdrey.MD-Android** (a zip with the `.aab` and the `.apk`). It is signed with the upload key. Artifacts are kept for 90 days; if there's none, click **Run workflow** on that page and wait for the run.
2. Closed testing – Alpha → **Create new release**. App signing: **Google-generated app signing key** (Play's default, chosen for Cowdrey.MD; the first upload locks it in). The key that signed this bundle becomes the app's upload key.
3. Upload `Cowdrey.MD.aab`. Release name: e.g. `2.0.2 (2000002)`; release notes: a line or two of what's new. **Next → Save.** You roll it out in step 7.

From then on, the workflow uploads each new version itself.

### 4. Let the workflows in

- Google Cloud console: in a project of yours, enable the **Google Play Android Developer API**, create a **service account** and download a **JSON key** for it.
- GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret:** `PLAY_SERVICE_ACCOUNT_JSON`, with the whole JSON file as its value.
- Play Console → **Users and permissions → Invite new users:** the service account's email address. Under **App permissions**, add Cowdrey.MD with **View app information**, **Release apps to testing tracks**, **Manage testing tracks and edit tester lists** and **Manage store presence** (store listing).
- Run **Actions → Google Play listing → Run workflow** once, to fill in the store listing from this folder.

### 5. Store settings

**Grow users → Store presence → Store settings:** category **Productivity**; contact email **legal@bradcowdrey.com**; website **https://bradcowdrey.com/cowdrey-md** (the listing workflow also sets these two).

If **Advanced settings → Form factors** offers Android TV (Tauri's Android project includes a TV launcher entry), leave it off: TV needs its own screenshots and review.

### 6. App content (Policy and programs → App content)

Suggested answers, checked against the Android app's code and the [Terms](https://github.com/bradleycowdrey/cowdrey-md/blob/main/TERMS.md) (Sections 15 and 25):

- **Privacy policy:** `https://bradcowdrey.com/legal`
- **Ads:** No, the app doesn't contain ads.
- **App access:** All functionality is available without special access. (No account or login. On first launch it asks you to agree to the Terms; "I agree" opens the app.)
- **Content rating:** category **All Other App Types** (a productivity tool: not a game, social, news, entertainment or store app). Answer **No** to every question: violence, fear, sexuality, gambling, language, controlled substances, crude humour; users interacting or exchanging content with other users (documents are shared only through Android's share sheet, to apps the user picks); sharing location; buying digital goods; web browser or search engine. Expected result: Everyone, PEGI 3, USK 0.
- **Target audience and content:** **13–15, 16–17 and 18 and over** (or 18 and over only). Not designed for children: the Terms say the Services aren't directed to children under 13. "Could your store listing unintentionally appeal to children?" **No.**
- **News app:** No. **Government app:** No. **Financial features:** none. **Health:** none. **Advertising ID:** not used.
- **Data safety:**
  - *Does your app collect or share any of the required user data types?* **No.** Then submit; the encryption and deletion questions are only asked when data is collected.
  - The family's cautious rule (data the app itself sends to a third-party service counts as **shared**) changes nothing here: the only service the Play copy calls is GitHub, for the Terms, and that request carries no data of any type on Play's list (no identifiers, location, contacts, files or app activity).
  - Why: documents, their version history, settings and the Terms agreement are stored on the device (the app's own storage, and the files and sync folder the user picks in Android's file picker). Word, PDF and web page exports are made on the device. There are no accounts, servers of our own, analytics, ads, crash reporting or third-party SDKs. Fonts and code libraries are built into the app; nothing is loaded from a font service or CDN.
  - What leaves the device, and why none of it is a data type to declare:
    - At most once a day the app reads `TERMS.md` from GitHub (raw.githubusercontent.com) to see whether the Terms changed. The request sends nothing about the user or their documents; GitHub sees the IP address, as with any web request.
    - Pictures a user puts in a document by web address load from that address, as in a web page; web links open in the user's browser.
    - Sharing (Markdown, Word, web page, PDF) and printing happen only when the user chooses, through Android's share sheet and print dialog: Play counts this as user-initiated, not collection or sharing.
    - Files and a sync folder the user picks may be kept by a cloud app (such as a cloud drive); that app syncs them under its own terms. They never reach Bradley.
    - The APK from GitHub (not the Play copy) also asks GitHub once a day whether there's a newer version.
  - Judgement call: Play's data types don't cover the IP address a web server sees when the app fetches a public file (the Terms check), or the sites a user's own picture links point to. No user data is sent and nothing is used to identify anyone, so "No" is the usual answer, and it matches the Terms ("no accounts, no ads, no analytics and no tracking").

### 7. Roll out and run the test

- **Publishing overview → Send changes for review.** When the app's setup is complete, roll out the release from step 3 on the closed test (Closed testing – Alpha → Releases).
- Send testers the join link. Each one opens it, accepts, and installs Cowdrey.MD from Play.
- Because this is a personal developer account, **at least 12 testers must stay opted in for 14 days in a row** before you can apply for production (**Dashboard → Apply for production**). Keep the test running and the testers opted in for the whole 14 days; new versions during the test are fine.
