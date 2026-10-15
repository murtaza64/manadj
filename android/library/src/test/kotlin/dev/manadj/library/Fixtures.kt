package dev.manadj.library

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant

fun track(
    id: Int,
    title: String = "Track $id",
    artist: String? = "Artist $id",
    bpm: Double? = 174.0,
    key: String? = null,
    energy: Int? = null,
    tags: List<Int> = emptyList(),
    added: Long = id.toLong(),
    audioRev: String? = "a$id",
    previewRev: String? = null,
) = LibraryTrack(
    id = id, title = title, artist = artist, fileName = "$title.mp3", bpm = bpm, key = null,
    keyOpenKey = key, keyCamelot = null, energy = energy, durationSecs = 300.0,
    dateAdded = Instant.ofEpochSecond(added), mainCue = null, codec = "mp3", fileSizeBytes = null,
    audioRev = audioRev, previewRev = previewRev, tagIds = tags, hotCues = emptyList(), grid = null,
    bpmCenti = bpm?.let { Math.round(it * 100) },
)

fun snapshot(
    tracks: List<LibraryTrack>,
    links: List<Pair<Int, Int>> = emptyList(),
    transitions: List<TransitionEdge> = emptyList(),
    cameos: List<CameoEdge> = emptyList(),
    takes: List<TakeEdge> = emptyList(),
    playlists: List<Playlist> = emptyList(),
) = Snapshot(1, null, emptyList(), emptyList(), tracks, playlists, links, transitions, cameos, takes)

/** A minimal valid MWF1 blob (desktop layout), 4 bins × 8 bands. */
fun mwf1(peaks: ByteArray = byteArrayOf(0, 64, 127, -1), duration: Double = 300.0): ByteArray {
    val nBands = 8
    val bands = ByteArray(peaks.size * nBands) { (it * 3).toByte() }
    val buf = ByteBuffer.allocate(40 + (nBands + 1) * 4 + 8 + peaks.size + bands.size).order(ByteOrder.LITTLE_ENDIAN)
    buf.put("MWF1".toByteArray()).putShort(2).putShort(0).putInt(44100).putDouble(duration)
        .putInt(128).putInt(512).putInt(2048).put(nBands.toByte()).put(ByteArray(3)).putFloat(0.5f)
    repeat(nBands + 1) { buf.putFloat(it * 100f) }
    buf.putInt(peaks.size).putInt(peaks.size).put(peaks).put(bands)
    return buf.array()
}
