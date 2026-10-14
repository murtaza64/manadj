package dev.manadj.library

import java.io.File

/**
 * On-device cache under [root] (app-private storage):
 *
 *   snapshot.json                 last pulled snapshot (offline source of truth)
 *   previews/<id>-<rev>.mwf       preview waveforms
 *   audio/<id>-<rev>/<file name>  audio files, downloaded on demand / pre-synced
 *                                 (desktop file name kept: players fall back to it for a title)
 *
 * Revisions in the file names make a changed desktop artifact a cache miss;
 * [prune] drops files the current snapshot no longer references.
 */
class LibraryStore(val root: File) {
    private val snapshotFile = File(root, "snapshot.json")
    val previewDir = File(root, "previews")
    val audioDir = File(root, "audio")
    val waveformDir = File(root, "waveforms")

    init {
        previewDir.mkdirs()
        audioDir.mkdirs()
        waveformDir.mkdirs()
    }

    fun readSnapshotText(): String? = snapshotFile.takeIf { it.isFile }?.readText()

    fun writeSnapshotText(text: String) = atomicWrite(snapshotFile, text.toByteArray())

    fun previewFile(track: LibraryTrack): File? = track.previewRev?.let { File(previewDir, "${track.id}-$it.mwf") }

    fun hasPreview(track: LibraryTrack) = previewFile(track)?.isFile == true

    fun writePreview(track: LibraryTrack, blob: ByteArray) {
        atomicWrite(previewFile(track) ?: return, blob)
    }

    fun readPreview(track: LibraryTrack): PreviewWaveform? {
        val file = previewFile(track)?.takeIf { it.isFile } ?: return null
        return try { PreviewWaveform.parse(file.readBytes()) } catch (_: IllegalArgumentException) { null }
    }

    fun waveformFile(track: LibraryTrack): File? = track.waveformRev?.let { File(waveformDir, "${track.id}-$it.mwf") }

    fun hasWaveform(track: LibraryTrack) = waveformFile(track)?.isFile == true

    fun writeWaveform(track: LibraryTrack, blob: ByteArray, rev: String? = track.waveformRev) {
        atomicWrite(File(waveformDir, "${track.id}-${rev ?: return}.mwf"), blob)
    }

    /** The cached detail waveform; null when missing or unreadable (a corrupt file is deleted). */
    fun readWaveform(track: LibraryTrack): DetailWaveform? {
        val file = waveformFile(track)?.takeIf { it.isFile } ?: return null
        return try { PreviewWaveform.parse(file.readBytes()) } catch (_: RuntimeException) { file.delete(); null }
    }

    fun audioFile(track: LibraryTrack): File? {
        val rev = track.audioRev ?: return null
        val name = track.fileName.replace('/', '_').replace('\\', '_').takeIf { it.isNotBlank() && !it.startsWith(".") } ?: "audio"
        return File(File(audioDir, "${track.id}-$rev"), name)
    }

    fun hasAudio(track: LibraryTrack) = audioFile(track)?.isFile == true

    fun audioBytes(): Long = audioDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }

    /** Delete cached artifacts the snapshot no longer references (and stale partials). */
    fun prune(snapshot: Snapshot) {
        val previews = snapshot.tracks.mapNotNullTo(HashSet()) { previewFile(it)?.name }
        val audio = snapshot.tracks.mapNotNullTo(HashSet()) { audioFile(it)?.parentFile?.name }
        val waveforms = snapshot.tracks.mapNotNullTo(HashSet()) { waveformFile(it)?.name }
        previewDir.listFiles()?.forEach { if (it.name !in previews) it.delete() }
        waveformDir.listFiles()?.forEach { if (it.name !in waveforms) it.delete() }
        audioDir.listFiles()?.forEach { if (it.name !in audio) it.deleteRecursively() }
    }

    companion object {
        fun atomicWrite(target: File, bytes: ByteArray) {
            target.parentFile?.mkdirs()
            val tmp = File(target.parentFile, ".${target.name}.part")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(target)) {
                target.delete()
                check(tmp.renameTo(target)) { "could not write $target" }
            }
        }
    }
}
