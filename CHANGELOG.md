# Changelog

iPhone and iPad builds go to TestFlight and the App Store. Mac app releases are on [GitHub Releases](https://github.com/bradleycowdrey/cowdrey-md/releases). The web app at [bradcowdrey.com/cowdrey-md](https://bradcowdrey.com/cowdrey-md) updates with every push to `main`.

## 1.0.24

- **One tap opens a document** from the document list on iPhone and iPad. Before, the first tap only revealed a hidden delete button (iOS spends a tap on hover-only controls) and a second tap was needed.
- On touch screens the delete button in the document list is always shown, so it can be reached at all.
- On iPad, one tap on the ✕ of a tab with unsaved changes closes it (it used to need two).
- A test now fails if any control is shown or hidden only on hover outside mouse and trackpad devices.

## 1.0.23

- **Undo and Redo grey out** in the ribbon and the Edit menu when there's nothing to undo or redo, instead of doing nothing when pressed (the phone toolbar already did).
- Every arrow and chevron control was checked at desktop, tablet and phone sizes. A new test fails if any of them ignores a press without being greyed out.

## 1.0.22

- **‹ Documents** on iPhone and Android now works both ways: the first press opens your document list, the second goes back to the document.

## 1.0.21

- **The title bar clears the status bar** on Android 15 tablets, foldables and phones held sideways, and on iPad. Before, the clock strip covered the top of the icon, the File/Edit… menus, Share app and Export.
- **Android: Check for updates** (··· → Help) finds a newer version and downloads it; open it and tap Update, and your documents are kept. It also checks once a day.
- **Android: Back closes an open dialog** before panels or editing.

## 1.0.20

- **Cowdrey.MD for Android**, built from the same code as the Mac and iPhone apps, with the same Pages- and Word-style phone layout.
  - **Open…** and **Save** use Android's system file picker (Google Drive, Downloads, any folder).
  - The **Back button** closes the open panel, then the document list, then leaves editing.
  - Adaptive icon that fits round and squircle launchers.

## 1.0.19

- **Line numbers no longer cover the text.** On iPhone, and in any narrow window showing only the editor, the numbers overlapped the start of each line. The text now always starts after the numbers.

## 1.0.18

- **Appearance (Automatic, Light, Dark) is at the top of the ··· menu on iPhone**, so you can switch it from the reading view or while editing. It's still in Format → Page too.

## 1.0.17

iPhone and iPad app refinements:
- **"Open in Cowdrey.MD"** from Files, Mail or any app now opens the file as a document.
- **Feels like a native app:** no text selection or callouts on toolbars, the interface doesn't pinch-zoom or bounce, and buttons are at least 44 pt.
- **Pinch the page** to make its text larger or smaller. **Swipe in from the left edge** for your documents.
- **The formatting bar shows what's applied** (bold, italic, lists, quote…), and Undo and Redo grey out when there's nothing to undo or redo.
- **Dynamic Type:** toolbars, panels and lists follow your iOS text size.
- **VoiceOver:**
  - Panels are true modal sheets: the app behind is inert, focus stays inside, and it returns to the button that opened the panel.
  - The style and title buttons announce their visible text.
- **The welcome document describes the iPhone layout**: Edit and Done, the formatting bar, and saving on this device.

## 1.0.16

- **The iPhone layout works like Pages and Word for iPhone.**
  - **Reading view.** The page fits the screen. Tap **Edit**, or double-tap a paragraph, to write there.
  - **Editing view.** Done, Undo and Redo at the top, and a formatting bar above the keyboard (style, bold, italic, underline, strikethrough, highlight, lists, indents, link, quote, code, insert).
  - **Format panel**, with Style, Text and Page tabs. **Insert panel**, with tables, pictures, links, equations, diagrams and more. **Share** and **More** panels. All slide up from the bottom.
  - The editor reads like a document: serif text, large headings and faded Markdown symbols.
  - **Documents** opens your document list. Tap the title to rename.
- Changing a paragraph style keeps your selection on the same words (before, it selected the whole line).

## 1.0.15

- The iPhone and iPad app says documents are saved **on this device** (not "in this browser").
- App Store screenshots and listing text are in `docs/app-store/`.

## 1.0.14

- **Cowdrey.MD for iPhone and iPad**, built for the App Store from the same code as the Mac app.
  - Export (.md or .html) opens the share sheet: Save to Files, AirDrop, Mail or any app.
  - Web links open in Safari, and the editor fits phone screens, with the menus scrolling sideways.
- On narrow screens the File, Edit, View… menus scroll sideways instead of running into each other.

## 1.0.13

- **Find and Replace open beside the ribbon's Find and Replace buttons**, as in Word, instead of over the top of your text. In a narrower window they open just below that group.
- **Move the find bar anywhere** by dragging its grip handle. It remembers the spot; double-click the grip to put it back beside Find.

## 1.0.12

- **Tabs above the editor and preview.** The tab bar now spans both panes.
- **Open many files at once.** Every file you open, choose or drop gets its own tab (before, only the last one did).
- **Close tabs like any other app.**
  - Closing the last tab leaves "No documents open", with New, Open and your recent documents, instead of opening another document.
  - Right-click a tab for Close, Close others, Close tabs to the right, Close all, Rename, Duplicate, Show in Finder and Copy file path.
  - Drag tabs to reorder them.
- **Keyboard:**
  - ⌘W closes a tab (Close Window moves to ⇧⌘W).
  - ⇧⌘] / ⇧⌘[ or ⌃Tab go to the next or previous tab.
  - ⌘1–⌘9 jump to a tab.
  - ⇧⌘T reopens a closed tab.
  - On the web, the keys are ⌘⌥] / ⌘⌥[ and ⌘⌥⇧T.
- **Unsaved work is never closed silently** (Mac app).
  - A dot on the tab marks unsaved changes to a file.
  - Closing it asks whether to Save, Don't save or Cancel. A new document that was never saved to a file asks whether to save it.
  - Quitting with unsaved files asks first, with Save all.
- **Save all** (⌥⇧⌘S) and **Open recent** in the File menu (Mac app).

## 1.0.11

- **Terms of Use and Privacy:** asked once when the app first opens, and always under **Help → Terms & Privacy** and in About.

## 1.0.10

- **Signed and notarized by Apple.** The Mac app is signed with a Developer ID and checked by Apple, so it opens with a double-click: no "Open Anyway" step.
- **Share app** copies the bradcowdrey.com/cowdrey-md link.

## Web: bradcowdrey.com, October 2026

- **Product page at [bradcowdrey.com/cowdrey-md](https://bradcowdrey.com/cowdrey-md).** It has the editor running live in a Mac window, plus the features, install steps and a Share button.
- **Full-screen editor at [bradcowdrey.com/cowdrey-md/app](https://bradcowdrey.com/cowdrey-md/app).** It always runs the latest version from this repository. Old `bradcowdrey.com/md` links redirect to the product page.
- **The in-app Share button** now copies the bradcowdrey.com link.
- **Download link:** `Cowdrey.MD.dmg` on every release always points at the newest Mac build.
- **GitHub Pages:** `index.html` is now a full standards-mode page, so the Pages copy renders the same as the Mac app.

## 1.0.9

- Phones and tablets get a sidebar button and a tap-outside-to-close overlay. Editor and preview split evenly, and the menus, ribbon and find bar fit at 320px.
- The Mac app's Quit menu item saves your work first. Undo, Redo, Cut, Copy, Paste and Select All use the standard Mac menu items. New document is ⌘N.
- Accessibility improvements:
  - Focus returns where it was after menus and dialogs.
  - Dialogs and status messages are labelled for screen readers.
  - Sidebar tabs work with the arrow keys.
  - Esc, then Tab, leaves the editor.

## 1.0.8

- The sidebar collapses and resizes. Drag its edge, or use **View → Sidebar** and **Compact sidebar**.

## 1.0.7

- The Mac menu bar matches the in-app File, Edit, View, Insert, Format, Tools and Help menus.

## 1.0.6

- Updates install in place: **Install and restart** saves your work, replaces the app and reopens it, with no DMG download needed.
- A **Share app** button at the top right copies the web link, the Mac download link or a ready-to-send message.

## 1.0.5

- New footer: "Made by Bradley Cowdrey. Free. Forever. · bradcowdrey.com ↗".

## 1.0.4

- New icon: a large C with a small MD.

## 1.0.3

- Renamed to Cowdrey.MD.

## 1.0.2

- **Help → Check for updates…**, plus a daily check.

## 1.0.1

- Fonts are bundled, so the app works fully offline.

## 1.0.0

- First release: side-by-side Markdown editor with a Docs-style page, Word-style ribbon, math, diagrams, callouts, tables and a Mac app.
