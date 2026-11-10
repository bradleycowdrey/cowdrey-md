// Writes what a WebView shows to a PDF file, without the print dialog. It lives in android.print because the
// callbacks a PrintDocumentAdapter reports to can only be created from that package.
package android.print

import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

object PdfWriter {
    /** Lays out and writes every page of [adapter] to [out]; calls [done] with null, or with what went wrong. */
    fun write(adapter: PrintDocumentAdapter, attrs: PrintAttributes, out: File, done: (String?) -> Unit) {
        adapter.onStart()
        adapter.onLayout(null, attrs, CancellationSignal(), object : PrintDocumentAdapter.LayoutResultCallback() {
            override fun onLayoutFinished(info: PrintDocumentInfo?, changed: Boolean) {
                val fd = try {
                    ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_READ_WRITE)
                } catch (e: Exception) {
                    adapter.onFinish(); done(e.message ?: "Could not create the PDF"); return
                }
                adapter.onWrite(arrayOf(PageRange.ALL_PAGES), fd, CancellationSignal(), object : PrintDocumentAdapter.WriteResultCallback() {
                    override fun onWriteFinished(pages: Array<out PageRange>?) { fd.close(); adapter.onFinish(); done(null) }
                    override fun onWriteFailed(error: CharSequence?) { fd.close(); adapter.onFinish(); done(error?.toString() ?: "Could not write the PDF") }
                    override fun onWriteCancelled() { fd.close(); adapter.onFinish(); done("cancelled") }
                })
            }
            override fun onLayoutFailed(error: CharSequence?) { adapter.onFinish(); done(error?.toString() ?: "Could not lay out the PDF") }
            override fun onLayoutCancelled() { adapter.onFinish(); done("cancelled") }
        }, null)
    }
}
