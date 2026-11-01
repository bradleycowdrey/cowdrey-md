// Native features of Cowdrey.MD on iPhone and iPad, adapted from tauri-plugin-sharekit 0.3.1 (MIT, see LICENSE).
// - The share sheet: the standard sheet on iPhone; a popover from the Share button on iPad. Sheets, pickers and
//   the print panel are shown from a full-screen window of their own (see overlayController).
// - Printing and PDF: the page as it prints (the web view's print layout), with the margins the app passes.
// - Files edited in place: a file chosen in the Files picker stays where it is (iCloud Drive, On My iPhone,
//   or another provider); the app keeps a bookmark to it and saves changes back to it.
// - A sync folder: a folder chosen once (for example in iCloud Drive), whose Markdown files the app lists,
//   reads, writes and deletes, so every device that uses the same folder sees the same documents.

import Foundation
import LinkPresentation
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

struct SharePosition: Decodable {
  let x: Double
  let y: Double
  let preferredEdge: String?  // ignored on iOS
}

struct ShareOptions: Decodable {
  let text: String
  let position: SharePosition?
}

struct ShareFileOptions: Decodable {
  let url: String
  let title: String?
  let position: SharePosition?
}

struct PageOptions: Decodable {
  let title: String?
  let width: Double?
  let height: Double?
  let margin: Double?
  let position: SharePosition?
}

struct PickOptions: Decodable {
  let multiple: Bool?
}

struct SaveAsOptions: Decodable {
  let name: String
  let content: String
}

struct BookmarkOptions: Decodable {
  let bookmark: String
  let content: String?
}

struct FolderOptions: Decodable {
  let bookmark: String
  let path: String?
  let content: String?
}

struct LinkOptions: Decodable {
  let url: String
  let title: String?
  let text: String?
  let position: SharePosition?
}

/// A link for the share sheet with the app's name and icon at the top, as other apps show theirs.
class LinkItem: NSObject, UIActivityItemSource {
  let url: URL
  let title: String
  init(url: URL, title: String) { self.url = url; self.title = title }
  func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { url }
  func activityViewController(_ controller: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { url }
  func activityViewController(_ controller: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String { title }
  func activityViewControllerLinkMetadata(_ controller: UIActivityViewController) -> LPLinkMetadata? {
    let m = LPLinkMetadata()
    m.originalURL = url
    m.url = url
    m.title = title
    if let icon = LinkItem.appIcon() {
      m.iconProvider = NSItemProvider(object: icon)
      m.imageProvider = NSItemProvider(object: icon)
    }
    return m
  }
  /// The app's own icon, from its bundle.
  static func appIcon() -> UIImage? {
    if let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any],
      let primary = icons["CFBundlePrimaryIcon"] as? [String: Any],
      let files = primary["CFBundleIconFiles"] as? [String] {
      for name in files.reversed() { if let img = UIImage(named: name) { return img } }
    }
    return UIImage(named: "AppIcon")
  }
}

/// The message that goes with the link, for apps that take text (Messages, Mail, Notes).
class TextItem: NSObject, UIActivityItemSource {
  let text: String
  init(_ text: String) { self.text = text }
  func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { text }
  func activityViewController(_ controller: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
    activityType == .copyToPasteboard ? nil : text
  }
}

enum NativeError: Error, LocalizedError {
  case message(String)
  var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

/// Keeps the document picker's delegate alive until the person picks or cancels.
class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  let done: ([URL]) -> Void
  init(done: @escaping ([URL]) -> Void) { self.done = done }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done([]) }
}

class SharePlugin: Plugin {
  var webview: WKWebView!
  var pickerDelegate: PickerDelegate?

  public override func load(webview: WKWebView) {
    self.webview = webview
  }

  // MARK: presenting

  // Sheets, pickers and the print panel are shown from a window of their own that covers the screen.
  // Shown from the app's own window, iOS placed them from the middle of the screen, partly off it.
  private var overlay: UIWindow?

  private func overlayController() -> UIViewController? {
    if let w = overlay, let vc = w.rootViewController {
      var top: UIViewController = vc
      while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
      return top
    }
    let screen = self.webview.window?.windowScene?.screen ?? UIScreen.main
    let w: UIWindow
    if let scene = self.webview.window?.windowScene {
      w = UIWindow(windowScene: scene)
    } else {
      w = UIWindow(frame: screen.bounds)
    }
    w.frame = screen.bounds
    w.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.normal.rawValue + 1)
    w.backgroundColor = .clear
    let vc = UIViewController()
    vc.view.backgroundColor = .clear
    w.rootViewController = vc
    w.overrideUserInterfaceStyle = self.webview.window?.traitCollection.userInterfaceStyle ?? .unspecified
    w.makeKeyAndVisible()
    overlay = w
    return vc
  }

  private func closeOverlay() {
    guard let w = overlay else { return }
    overlay = nil
    w.isHidden = true
    w.rootViewController = nil
    self.webview.window?.makeKeyAndVisible()
  }

  /// A point for iPad popovers (from the Share button), in the overlay's coordinates, clamped on screen.
  private func anchor(_ position: SharePosition?) -> CGRect {
    let b = self.webview.bounds
    let x = min(max(position?.x ?? Double(b.maxX - 40), 1), Double(b.maxX - 1))
    let y = min(max(position?.y ?? Double(b.minY + 60), 1), Double(b.maxY - 1))
    let r = CGRect(x: x, y: y, width: 1, height: 1)
    let screen = self.webview.window?.windowScene?.screen ?? UIScreen.main
    return self.webview.convert(r, to: screen.coordinateSpace)
  }

  private func present(_ items: [Any], position: SharePosition?, invoke: Invoke) {
    guard let from = overlayController() else {
      invoke.reject("Nothing to present the share sheet from")
      return
    }
    let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
    if UIDevice.current.userInterfaceIdiom == .pad {
      sheet.modalPresentationStyle = .popover
      sheet.popoverPresentationController?.sourceView = from.view
      sheet.popoverPresentationController?.sourceRect = anchor(position)
      sheet.popoverPresentationController?.permittedArrowDirections = [.up, .down]
    }
    sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
      self?.closeOverlay()
      if let error = error {
        invoke.reject(error.localizedDescription)
      } else if completed {
        invoke.resolve()
      } else {
        invoke.reject("Share cancelled")
      }
    }
    from.present(sheet, animated: true, completion: nil)
  }

  private func showPicker(_ picker: UIDocumentPickerViewController, invoke: Invoke, done: @escaping ([URL]) -> Void) {
    guard let from = overlayController() else {
      invoke.reject("Nothing to present the file picker from")
      return
    }
    let delegate = PickerDelegate { [weak self] urls in
      self?.pickerDelegate = nil
      self?.closeOverlay()
      done(urls)
    }
    self.pickerDelegate = delegate
    picker.delegate = delegate
    from.present(picker, animated: true, completion: nil)
  }

  // MARK: share

  @objc func shareText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareOptions.self)
    DispatchQueue.main.async {
      self.present([args.text], position: args.position, invoke: invoke)
    }
  }

  @objc func shareFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareFileOptions.self)
    DispatchQueue.main.async {
      guard let fileUrl = URL(string: args.url), fileUrl.isFileURL else {
        invoke.reject("Invalid file URL")
        return
      }
      self.present([fileUrl], position: args.position, invoke: invoke)
    }
  }

  @objc func shareLink(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(LinkOptions.self)
    DispatchQueue.main.async {
      guard let url = URL(string: args.url) else {
        invoke.reject("Invalid link")
        return
      }
      var items: [Any] = [LinkItem(url: url, title: args.title ?? url.host ?? "Link")]
      if let text = args.text, !text.isEmpty { items.insert(TextItem(text), at: 0) }
      self.present(items, position: args.position, invoke: invoke)
    }
  }

  // MARK: printing and PDF

  private func renderer(_ args: PageOptions) -> UIPrintPageRenderer {
    let formatter = self.webview.viewPrintFormatter()
    let m = CGFloat(args.margin ?? 72)
    formatter.perPageContentInsets = UIEdgeInsets(top: m, left: m, bottom: m, right: m)
    let r = UIPrintPageRenderer()
    r.addPrintFormatter(formatter, startingAtPageAt: 0)
    return r
  }

  @objc func printPage(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PageOptions.self)
    DispatchQueue.main.async {
      let info = UIPrintInfo(dictionary: nil)
      info.outputType = .general
      info.jobName = args.title ?? "Document"
      let pc = UIPrintInteractionController.shared
      pc.printInfo = info
      pc.printPageRenderer = self.renderer(args)
      let done: UIPrintInteractionController.CompletionHandler = { [weak self] _, completed, error in
        self?.closeOverlay()
        if let error = error {
          invoke.reject(error.localizedDescription)
        } else if completed {
          invoke.resolve()
        } else {
          invoke.reject("Print cancelled")
        }
      }
      guard let from = self.overlayController() else {
        invoke.reject("Nothing to present the print panel from")
        return
      }
      if UIDevice.current.userInterfaceIdiom == .pad {
        pc.present(from: self.anchor(args.position), in: from.view, animated: true, completionHandler: done)
      } else {
        pc.present(animated: true, completionHandler: done)
      }
    }
  }

  @objc func exportPdf(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PageOptions.self)
    DispatchQueue.main.async {
      let paper = CGRect(x: 0, y: 0, width: args.width ?? 612, height: args.height ?? 792)
      let r = self.renderer(args)
      r.setValue(NSValue(cgRect: paper), forKey: "paperRect")
      r.setValue(NSValue(cgRect: paper), forKey: "printableRect")
      let pages = r.numberOfPages
      if pages == 0 {
        invoke.reject("There is nothing to put in the PDF")
        return
      }
      let data = NSMutableData()
      let title = args.title ?? "Document"
      UIGraphicsBeginPDFContextToData(data, paper, [kCGPDFContextTitle as String: title, kCGPDFContextCreator as String: "Cowdrey.MD"])
      r.prepare(forDrawingPages: NSRange(location: 0, length: pages))
      let bounds = UIGraphicsGetPDFContextBounds()
      for i in 0..<pages {
        UIGraphicsBeginPDFPage()
        r.drawPage(at: i, in: bounds)
      }
      UIGraphicsEndPDFContext()
      let safe = title.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: "-")
      let url = FileManager.default.temporaryDirectory.appendingPathComponent((safe.isEmpty ? "Document" : safe) + ".pdf")
      do {
        try data.write(to: url, options: .atomic)
      } catch {
        invoke.reject(error.localizedDescription)
        return
      }
      self.present([url], position: args.position, invoke: invoke)
    }
  }

  // MARK: files and folders

  private func millis(_ url: URL) -> Double {
    let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    return ((date ?? Date()).timeIntervalSince1970 * 1000).rounded()
  }

  private func bookmark(_ url: URL) throws -> String {
    return try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil).base64EncodedString()
  }

  private func resolve(_ bookmark: String) throws -> (URL, String?) {
    guard let data = Data(base64Encoded: bookmark) else { throw NativeError.message("That file link is not valid") }
    var stale = false
    let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    return (url, stale ? (try? self.bookmark(url)) : nil)
  }

  /// Runs body with access to a security-scoped URL.
  private func withAccess<T>(_ url: URL, _ body: () throws -> T) rethrows -> T {
    let ok = url.startAccessingSecurityScopedResource()
    defer { if ok { url.stopAccessingSecurityScopedResource() } }
    return try body()
  }

  private func coordinatedRead(_ url: URL) throws -> String {
    var result: Result<String, Error> = .failure(NativeError.message("Could not read \(url.lastPathComponent)"))
    var coordError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
      result = Result { try String(contentsOf: u, encoding: .utf8) }
    }
    if let e = coordError { throw e }
    return try result.get()
  }

  private func coordinatedWrite(_ url: URL, _ text: String) throws {
    var result: Result<Void, Error> = .success(())
    var coordError: NSError?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
      result = Result { try text.write(to: u, atomically: true, encoding: .utf8) }
    }
    if let e = coordError { throw e }
    try result.get()
  }

  private func background(_ invoke: Invoke, _ work: @escaping () throws -> JsonObject) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        invoke.resolve(try work())
      } catch {
        invoke.reject(error.localizedDescription)
      }
    }
  }

  private static let textTypes: [UTType] = {
    var types: [UTType] = [.plainText, .text]
    if let md = UTType("net.daringfireball.markdown") { types.insert(md, at: 0) }
    if let md = UTType(filenameExtension: "md") { types.append(md) }
    return types
  }()

  @objc func pickFiles(_ invoke: Invoke) throws {
    let args = (try? invoke.parseArgs(PickOptions.self)) ?? PickOptions(multiple: true)
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: SharePlugin.textTypes, asCopy: false)
      picker.allowsMultipleSelection = args.multiple ?? true
      self.showPicker(picker, invoke: invoke) { urls in
        self.background(invoke) {
          var files: [JsonObject] = []
          for url in urls {
            try self.withAccess(url) {
              let content = try self.coordinatedRead(url)
              files.append(["name": url.lastPathComponent, "content": content, "bookmark": try self.bookmark(url), "modified": self.millis(url)])
            }
          }
          return ["files": files]
        }
      }
    }
  }

  @objc func saveAsFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SaveAsOptions.self)
    let safe = args.name.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: "-")
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let tmp = dir.appendingPathComponent(safe.isEmpty ? "Untitled.md" : safe)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try args.content.write(to: tmp, atomically: true, encoding: .utf8)
    } catch {
      invoke.reject(error.localizedDescription)
      return
    }
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forExporting: [tmp], asCopy: false)
      self.showPicker(picker, invoke: invoke) { urls in
        guard let url = urls.first else {
          invoke.reject("Save cancelled")
          return
        }
        self.background(invoke) {
          try self.withAccess(url) {
            ["name": url.lastPathComponent, "bookmark": try self.bookmark(url), "modified": self.millis(url)]
          }
        }
      }
    }
  }

  @objc func readFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BookmarkOptions.self)
    background(invoke) {
      let (url, fresh) = try self.resolve(args.bookmark)
      return try self.withAccess(url) {
        var out: JsonObject = ["name": url.lastPathComponent, "content": try self.coordinatedRead(url), "modified": self.millis(url)]
        if let fresh = fresh { out["bookmark"] = fresh }
        return out
      }
    }
  }

  @objc func writeFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BookmarkOptions.self)
    background(invoke) {
      let (url, fresh) = try self.resolve(args.bookmark)
      return try self.withAccess(url) {
        try self.coordinatedWrite(url, args.content ?? "")
        var out: JsonObject = ["modified": self.millis(url)]
        if let fresh = fresh { out["bookmark"] = fresh }
        return out
      }
    }
  }

  @objc func pickFolder(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      self.showPicker(picker, invoke: invoke) { urls in
        guard let url = urls.first else {
          invoke.reject("Folder choice cancelled")
          return
        }
        self.background(invoke) {
          try self.withAccess(url) { ["name": url.lastPathComponent, "bookmark": try self.bookmark(url)] }
        }
      }
    }
  }

  private static let markdownExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"]

  @objc func listFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FolderOptions.self)
    background(invoke) {
      let (root, fresh) = try self.resolve(args.bookmark)
      return try self.withAccess(root) {
        var files: [JsonObject] = []
        var folders: [String] = []
        let base = root.standardizedFileURL.path
        let keys: [URLResourceKey] = [.isDirectoryKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants]) else {
          throw NativeError.message("Could not open the folder")
        }
        for case let url as URL in walker {
          var rel = String(url.standardizedFileURL.path.dropFirst(base.count))
          if rel.hasPrefix("/") { rel.removeFirst() }
          let name = url.lastPathComponent
          let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
          if name.hasPrefix(".") {
            // iCloud keeps files that aren't downloaded yet as ".Name.md.icloud": ask for them, and list them as pending.
            if name.hasSuffix(".icloud") {
              let real = String(name.dropFirst().dropLast(7))
              if SharePlugin.markdownExtensions.contains((real as NSString).pathExtension.lowercased()) {
                let realURL = url.deletingLastPathComponent().appendingPathComponent(real)
                try? FileManager.default.startDownloadingUbiquitousItem(at: realURL)
                let dir = (rel as NSString).deletingLastPathComponent
                files.append(["path": dir.isEmpty ? real : dir + "/" + real, "modified": 0, "pending": true])
              }
            } else if isDir {
              walker.skipDescendants()
            }
            continue
          }
          if isDir {
            folders.append(rel)
          } else if SharePlugin.markdownExtensions.contains(url.pathExtension.lowercased()) {
            files.append(["path": rel, "modified": self.millis(url)])
          }
        }
        var out: JsonObject = ["name": root.lastPathComponent, "files": files, "folders": folders]
        if let fresh = fresh { out["bookmark"] = fresh }
        return out
      }
    }
  }

  private func inside(_ root: URL, _ path: String?) throws -> URL {
    guard let path = path, !path.isEmpty, !path.split(separator: "/").contains(where: { $0 == ".." }) else {
      throw NativeError.message("That file name is not valid")
    }
    return root.appendingPathComponent(path)
  }

  @objc func readInFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FolderOptions.self)
    background(invoke) {
      let (root, _) = try self.resolve(args.bookmark)
      return try self.withAccess(root) {
        let url = try self.inside(root, args.path)
        return ["content": try self.coordinatedRead(url), "modified": self.millis(url)]
      }
    }
  }

  @objc func writeInFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FolderOptions.self)
    background(invoke) {
      let (root, _) = try self.resolve(args.bookmark)
      return try self.withAccess(root) {
        let url = try self.inside(root, args.path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try self.coordinatedWrite(url, args.content ?? "")
        return ["modified": self.millis(url)]
      }
    }
  }

  @objc func deleteInFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(FolderOptions.self)
    background(invoke) {
      let (root, _) = try self.resolve(args.bookmark)
      return try self.withAccess(root) {
        let url = try self.inside(root, args.path)
        var coordError: NSError?
        var result: Result<Void, Error> = .success(())
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { u in
          result = Result { if FileManager.default.fileExists(atPath: u.path) { try FileManager.default.removeItem(at: u) } }
        }
        if let e = coordError { throw e }
        try result.get()
        return [:]
      }
    }
  }
}

@_cdecl("init_plugin_share")
func initPlugin() -> Plugin {
  return SharePlugin()
}
