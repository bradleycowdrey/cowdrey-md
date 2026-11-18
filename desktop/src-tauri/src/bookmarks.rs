//! Security-scoped bookmarks for the Mac App Store build (feature `app-store`).
//!
//! The App Store build runs in the App Sandbox: it may only touch files the person chose in an Open or Save
//! panel, dropped on the app or opened from Finder, and only until the app quits. The page keeps plain paths
//! (recent files, the file a document is saved back to, the sync folder), so after a restart they would no
//! longer open. Each time a path is read or written successfully we keep a security-scoped bookmark for it
//! (com.apple.security.files.bookmarks.app-scope), and at launch every bookmark is resolved and its access
//! started again, so the same paths keep working. A file inside a bookmarked folder needs no bookmark of its own.
//!
//! In every other build these functions do nothing.

use std::path::Path;

#[cfg(all(target_os = "macos", feature = "app-store"))]
mod imp {
    use base64::Engine;
    use std::ffi::c_void;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    type CFTypeRef = *const c_void;
    type CFIndex = isize;
    type CFOptionFlags = usize;
    type Boolean = u8;

    // CFURLBookmarkCreationOptions / CFURLBookmarkResolutionOptions (CFURL.h)
    const CREATE_WITH_SECURITY_SCOPE: CFOptionFlags = 1 << 11;
    const RESOLVE_WITH_SECURITY_SCOPE: CFOptionFlags = 1 << 10;
    const RESOLVE_WITHOUT_UI: CFOptionFlags = 1 << 8;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFURLCreateFromFileSystemRepresentation(alloc: CFTypeRef, buffer: *const u8, len: CFIndex, is_dir: Boolean) -> CFTypeRef;
        fn CFURLCreateBookmarkData(alloc: CFTypeRef, url: CFTypeRef, options: CFOptionFlags, keys: CFTypeRef, relative: CFTypeRef, error: *mut CFTypeRef) -> CFTypeRef;
        fn CFURLCreateByResolvingBookmarkData(alloc: CFTypeRef, data: CFTypeRef, options: CFOptionFlags, relative: CFTypeRef, keys: CFTypeRef, is_stale: *mut Boolean, error: *mut CFTypeRef) -> CFTypeRef;
        fn CFURLStartAccessingSecurityScopedResource(url: CFTypeRef) -> Boolean;
        fn CFURLGetFileSystemRepresentation(url: CFTypeRef, resolve_against_base: Boolean, buffer: *mut u8, max_len: CFIndex) -> Boolean;
        fn CFDataCreate(alloc: CFTypeRef, bytes: *const u8, len: CFIndex) -> CFTypeRef;
        fn CFDataGetLength(data: CFTypeRef) -> CFIndex;
        fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
        fn CFRelease(cf: CFTypeRef);
    }

    /// A bookmark for `path`, if the app may reach it right now.
    fn create(path: &Path) -> Option<Vec<u8>> {
        let bytes = path.as_os_str().as_bytes();
        unsafe {
            let url = CFURLCreateFromFileSystemRepresentation(std::ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex, path.is_dir() as Boolean);
            if url.is_null() {
                return None;
            }
            let mut err: CFTypeRef = std::ptr::null();
            let data = CFURLCreateBookmarkData(std::ptr::null(), url, CREATE_WITH_SECURITY_SCOPE, std::ptr::null(), std::ptr::null(), &mut err);
            CFRelease(url);
            if !err.is_null() {
                CFRelease(err);
            }
            if data.is_null() {
                return None;
            }
            let out = std::slice::from_raw_parts(CFDataGetBytePtr(data), CFDataGetLength(data) as usize).to_vec();
            CFRelease(data);
            Some(out)
        }
    }

    /// Resolves a bookmark and starts using it (for as long as the app runs). Returns the path it points to
    /// now and whether the bookmark should be made again (the file moved or was replaced).
    fn resolve(bookmark: &[u8]) -> Option<(PathBuf, bool)> {
        unsafe {
            let data = CFDataCreate(std::ptr::null(), bookmark.as_ptr(), bookmark.len() as CFIndex);
            if data.is_null() {
                return None;
            }
            let mut stale: Boolean = 0;
            let mut err: CFTypeRef = std::ptr::null();
            let url = CFURLCreateByResolvingBookmarkData(std::ptr::null(), data, RESOLVE_WITH_SECURITY_SCOPE | RESOLVE_WITHOUT_UI, std::ptr::null(), std::ptr::null(), &mut stale, &mut err);
            CFRelease(data);
            if !err.is_null() {
                CFRelease(err);
            }
            if url.is_null() {
                return None;
            }
            // The URL is kept (never released) while access lasts, which is until the app quits.
            let started = CFURLStartAccessingSecurityScopedResource(url) != 0;
            let mut buf = vec![0u8; 4096];
            let ok = CFURLGetFileSystemRepresentation(url, 1, buf.as_mut_ptr(), buf.len() as CFIndex) != 0;
            if !started {
                CFRelease(url);
                return None;
            }
            if !ok {
                return None;
            }
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            Some((PathBuf::from(std::ffi::OsStr::from_bytes(&buf[..end])), stale != 0))
        }
    }

    /// Newest last. Paths are the ones the page uses.
    struct Store {
        file: Option<PathBuf>,
        items: Vec<(String, String)>,
    }

    static STORE: Mutex<Store> = Mutex::new(Store { file: None, items: Vec::new() });
    const MAX: usize = 300;

    fn save(store: &Store) {
        if let Some(file) = &store.file {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(json) = serde_json::to_vec(&store.items) {
                let _ = std::fs::write(file, json);
            }
        }
    }

    fn covered(items: &[(String, String)], path: &Path) -> bool {
        items.iter().any(|(p, _)| path.starts_with(Path::new(p)))
    }

    pub fn restore(data_dir: PathBuf) {
        let file = data_dir.join("bookmarks.json");
        let saved: Vec<(String, String)> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let engine = base64::engine::general_purpose::STANDARD;
        let mut items = Vec::new();
        for (path, b64) in saved {
            let Ok(bytes) = engine.decode(&b64) else { continue };
            let Some((now, stale)) = resolve(&bytes) else { continue };
            // A moved or replaced file gets a fresh bookmark; the page still knows it by its old path.
            let b64 = if stale { create(&now).map(|b| engine.encode(b)).unwrap_or(b64) } else { b64 };
            items.push((path, b64));
        }
        let mut store = STORE.lock().unwrap();
        store.file = Some(file);
        store.items = items;
        save(&store);
    }

    pub fn remember(path: &Path) {
        let mut store = STORE.lock().unwrap();
        if store.file.is_none() || covered(&store.items, path) {
            return;
        }
        let Some(bytes) = create(path) else { return };
        let key = path.to_string_lossy().into_owned();
        // A folder replaces the bookmarks of the files inside it.
        store.items.retain(|(p, _)| !Path::new(p).starts_with(path));
        store.items.push((key, base64::engine::general_purpose::STANDARD.encode(bytes)));
        let len = store.items.len();
        if len > MAX {
            store.items.drain(..len - MAX);
        }
        save(&store);
    }
}

/// At launch: resolves the saved bookmarks and starts using them again.
#[allow(dead_code)]
#[allow(unused_variables)]
pub fn restore(data_dir: Option<std::path::PathBuf>) {
    #[cfg(all(target_os = "macos", feature = "app-store"))]
    if let Some(dir) = data_dir {
        imp::restore(dir);
    }
}

/// After a successful read or write: keeps a bookmark for the path so it opens again after a restart.
#[allow(unused_variables)]
pub fn remember(path: &Path) {
    #[cfg(all(target_os = "macos", feature = "app-store"))]
    imp::remember(path);
}
