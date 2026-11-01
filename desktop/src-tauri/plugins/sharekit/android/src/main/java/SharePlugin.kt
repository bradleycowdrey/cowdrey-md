// Native features of Cowdrey.MD on Android, adapted from tauri-plugin-sharekit 0.3.1 (MIT, see LICENSE).
// - Sharing text and files through the Android share sheet.
// - Printing, and saving as PDF, through the Android print dialog (its "Save as PDF" printer).
// - Files edited in place: a file chosen in the system picker keeps a lasting permission, so changes are saved back to it.
// - A sync folder: a folder chosen once in the system picker, whose Markdown files the app lists, reads, writes and deletes.
package app.tauri.share

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareTextOptions {
    lateinit var text: String
    var mimeType: String = "text/plain"
    var title: String? = null
}

@InvokeArg
class ShareFileOptions {
    lateinit var url: String
    var mimeType: String = "*/*"
    var title: String? = null
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private val markdown = setOf("md", "markdown", "mdown", "mkd", "mkdn", "txt")
    private val rw = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    override fun load(webView: WebView) {
        this.webView = webView
    }

    /** Runs file work off the main thread and answers with its result or its error. */
    private fun background(invoke: Invoke, work: () -> JSObject) {
        Thread {
            try {
                invoke.resolve(work())
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }.start()
    }

    // ---- share ----

    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareTextOptions::class.java)
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            type = args.mimeType
            putExtra(Intent.EXTRA_TEXT, args.text)
            putExtra(Intent.EXTRA_TITLE, args.title)
        }
        activity.startActivity(Intent.createChooser(sendIntent, null))
        invoke.resolve()
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileOptions::class.java)
        val source = if (args.url.startsWith("file://")) File(Uri.parse(args.url).path!!) else File(args.url)
        val temp = File(activity.cacheDir, source.name)
        source.inputStream().use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", temp)
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            type = args.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_TITLE, args.title)
        }
        activity.startActivity(Intent.createChooser(sendIntent, args.title))
        invoke.resolve()
    }

    // ---- printing and PDF ----

    @Command
    fun printPage(invoke: Invoke) {
        val args = invoke.getArgs()
        val title = args.getString("title", "Document") ?: "Document"
        val a4 = args.optBoolean("a4", false)
        activity.runOnUiThread {
            val wv = webView
            if (wv == null) {
                invoke.reject("There is no page to print")
                return@runOnUiThread
            }
            try {
                val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val attrs = PrintAttributes.Builder()
                    .setMediaSize(if (a4) PrintAttributes.MediaSize.ISO_A4 else PrintAttributes.MediaSize.NA_LETTER)
                    .build()
                pm.print(title, wv.createPrintDocumentAdapter(title), attrs)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Could not print")
            }
        }
    }

    // ---- files edited in place ----

    private fun displayName(uri: Uri): String {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) return c.getString(0)
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "Document.md"
    }

    private fun modified(uri: Uri): Long {
        try {
            activity.contentResolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
            }
        } catch (_: Exception) {
        }
        return 0L
    }

    private fun readText(uri: Uri): String =
        activity.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw Exception("Could not read the file")

    private fun writeText(uri: Uri, text: String) {
        val out = activity.contentResolver.openOutputStream(uri, "wt") ?: throw Exception("Could not write the file")
        out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
    }

    /** Keeps the permission to read, and if allowed write, the file after the app restarts. Returns whether writing is allowed. */
    private fun keep(uri: Uri): Boolean {
        return try {
            activity.contentResolver.takePersistableUriPermission(uri, rw)
            true
        } catch (_: Exception) {
            try {
                activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: Exception) {
            }
            false
        }
    }

    @Command
    fun pickFiles(invoke: Invoke) {
        val multiple = invoke.getArgs().optBoolean("multiple", true)
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            addFlags(rw or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickFilesResult")
    }

    @ActivityCallback
    private fun pickFilesResult(invoke: Invoke, result: ActivityResult) {
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.resolve(JSObject().apply { put("files", JSArray()) })
            return
        }
        val uris = mutableListOf<Uri>()
        val clip = data.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
        } else {
            data.data?.let { uris.add(it) }
        }
        background(invoke) {
            val files = JSArray()
            for (uri in uris) {
                val writable = keep(uri)
                files.put(JSObject().apply {
                    put("name", displayName(uri))
                    put("content", readText(uri))
                    put("bookmark", uri.toString())
                    put("modified", modified(uri))
                    put("writable", writable)
                })
            }
            JSObject().apply { put("files", files) }
        }
    }

    private var pendingSave: String? = null

    @Command
    fun saveAsFile(invoke: Invoke) {
        val args = invoke.getArgs()
        pendingSave = args.getString("content", "") ?: ""
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "text/markdown"
            putExtra(Intent.EXTRA_TITLE, args.getString("name", "Untitled.md"))
            addFlags(rw or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "saveAsFileResult")
    }

    @ActivityCallback
    private fun saveAsFileResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        val text = pendingSave ?: ""
        pendingSave = null
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("Save cancelled")
            return
        }
        background(invoke) {
            keep(uri)
            writeText(uri, text)
            JSObject().apply {
                put("name", displayName(uri))
                put("bookmark", uri.toString())
                put("modified", modified(uri))
            }
        }
    }

    @Command
    fun readFile(invoke: Invoke) {
        val uri = Uri.parse(invoke.getArgs().getString("bookmark"))
        background(invoke) {
            JSObject().apply {
                put("name", displayName(uri))
                put("content", readText(uri))
                put("modified", modified(uri))
            }
        }
    }

    @Command
    fun writeFile(invoke: Invoke) {
        val args = invoke.getArgs()
        val uri = Uri.parse(args.getString("bookmark"))
        val text = args.getString("content", "") ?: ""
        background(invoke) {
            writeText(uri, text)
            JSObject().apply { put("modified", modified(uri)) }
        }
    }

    // ---- sync folder ----

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(rw or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    private fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("Folder choice cancelled")
            return
        }
        background(invoke) {
            activity.contentResolver.takePersistableUriPermission(uri, rw)
            val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
            JSObject().apply {
                put("name", displayName(root))
                put("bookmark", uri.toString())
            }
        }
    }

    private class Entry(val id: String, val name: String, val mime: String, val modified: Long)

    private fun children(tree: Uri, parentId: String): List<Entry> {
        val out = mutableListOf<Entry>()
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )
        activity.contentResolver.query(uri, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                out.add(Entry(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "", if (c.isNull(3)) 0L else c.getLong(3)))
            }
        }
        return out
    }

    private fun isDir(e: Entry) = e.mime == DocumentsContract.Document.MIME_TYPE_DIR

    /** The document id of path inside the folder, or null. With create, missing folders (and the file) are created. */
    private fun find(tree: Uri, path: String, create: Boolean): String? {
        val parts = path.split('/').filter { it.isNotEmpty() }
        if (parts.isEmpty() || parts.any { it == ".." }) throw Exception("That file name is not valid")
        var parent = DocumentsContract.getTreeDocumentId(tree)
        for ((i, part) in parts.withIndex()) {
            val last = i == parts.size - 1
            val hit = children(tree, parent).firstOrNull { it.name == part }
            parent = when {
                hit != null -> hit.id
                !create -> return null
                else -> {
                    val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, parent)
                    val made = DocumentsContract.createDocument(
                        activity.contentResolver, parentUri,
                        if (last) "text/markdown" else DocumentsContract.Document.MIME_TYPE_DIR, part
                    ) ?: throw Exception("Could not create $part")
                    DocumentsContract.getDocumentId(made)
                }
            }
        }
        return parent
    }

    @Command
    fun listFolder(invoke: Invoke) {
        val tree = Uri.parse(invoke.getArgs().getString("bookmark"))
        background(invoke) {
            val files = JSArray()
            val folders = JSArray()
            fun walk(id: String, prefix: String, depth: Int) {
                for (e in children(tree, id)) {
                    if (e.name.startsWith(".")) continue
                    val rel = if (prefix.isEmpty()) e.name else "$prefix/${e.name}"
                    if (isDir(e)) {
                        folders.put(rel)
                        if (depth < 8) walk(e.id, rel, depth + 1)
                    } else if (e.name.substringAfterLast('.', "").lowercase() in markdown) {
                        files.put(JSObject().apply {
                            put("path", rel)
                            put("modified", e.modified)
                        })
                    }
                }
            }
            walk(DocumentsContract.getTreeDocumentId(tree), "", 0)
            val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            JSObject().apply {
                put("name", displayName(root))
                put("files", files)
                put("folders", folders)
            }
        }
    }

    @Command
    fun readInFolder(invoke: Invoke) {
        val args = invoke.getArgs()
        val tree = Uri.parse(args.getString("bookmark"))
        val path = args.getString("path")
        background(invoke) {
            val id = find(tree, path, false) ?: throw Exception("$path is not in the folder")
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
            JSObject().apply {
                put("content", readText(uri))
                put("modified", modified(uri))
            }
        }
    }

    @Command
    fun writeInFolder(invoke: Invoke) {
        val args = invoke.getArgs()
        val tree = Uri.parse(args.getString("bookmark"))
        val path = args.getString("path")
        val text = args.getString("content", "") ?: ""
        background(invoke) {
            val id = find(tree, path, true) ?: throw Exception("Could not create $path")
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
            writeText(uri, text)
            JSObject().apply { put("modified", modified(uri)) }
        }
    }

    @Command
    fun deleteInFolder(invoke: Invoke) {
        val args = invoke.getArgs()
        val tree = Uri.parse(args.getString("bookmark"))
        val path = args.getString("path")
        background(invoke) {
            val id = find(tree, path, false)
            if (id != null) DocumentsContract.deleteDocument(activity.contentResolver, DocumentsContract.buildDocumentUriUsingTree(tree, id))
            JSObject()
        }
    }
}
