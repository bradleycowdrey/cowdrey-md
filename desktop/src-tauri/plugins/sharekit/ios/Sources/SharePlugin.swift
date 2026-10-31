// Share sheet for Cowdrey.MD, adapted from tauri-plugin-sharekit 0.3.1 (MIT, see LICENSE).
// Change: on iPhone the share sheet is presented as a normal bottom sheet (full width, medium and
// large heights), never as a popover anchored inside the web view, which on recent iOS opened
// squeezed and cut off at the screen edge. On iPad it stays a popover pointing at the Share button.

import Foundation
import SwiftRs
import Tauri
import UIKit
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

class SharePlugin: Plugin {
  var webview: WKWebView!
  public override func load(webview: WKWebView) {
    self.webview = webview
  }

  /// The controller to present from: the top of whatever is already presented.
  private func presenter() -> UIViewController? {
    var top = self.manager.viewController ?? self.webview.window?.rootViewController
    while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
    return top
  }

  private func present(_ items: [Any], position: SharePosition?, invoke: Invoke) {
    let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)

    if UIDevice.current.userInterfaceIdiom == .pad {
      // iPad requires a popover: point it at the Share button (web view coordinates, clamped on screen).
      let b = self.webview.bounds
      let x = min(max(position?.x ?? Double(b.maxX - 40), 1), Double(b.maxX - 1))
      let y = min(max(position?.y ?? Double(b.minY + 60), 1), Double(b.maxY - 1))
      sheet.modalPresentationStyle = .popover
      sheet.popoverPresentationController?.sourceView = self.webview
      sheet.popoverPresentationController?.sourceRect = CGRect(x: x, y: y, width: 1, height: 1)
      sheet.popoverPresentationController?.permittedArrowDirections = [.up, .down]
    } else {
      // iPhone: a standard sheet from the bottom of the screen, full width.
      sheet.modalPresentationStyle = .pageSheet
      if #available(iOS 15.0, *), let s = sheet.sheetPresentationController {
        s.detents = [.medium(), .large()]
        s.prefersGrabberVisible = false
      }
    }

    sheet.completionWithItemsHandler = { _, completed, _, error in
      if let error = error {
        invoke.reject(error.localizedDescription)
      } else if completed {
        invoke.resolve()
      } else {
        invoke.reject("Share cancelled")
      }
    }

    guard let from = presenter() else {
      invoke.reject("Nothing to present the share sheet from")
      return
    }
    from.present(sheet, animated: true, completion: nil)
  }

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
}

@_cdecl("init_plugin_share")
func initPlugin() -> Plugin {
  return SharePlugin()
}
