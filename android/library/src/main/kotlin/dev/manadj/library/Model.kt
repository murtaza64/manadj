package dev.manadj.library

import java.time.Instant

/** A Tag as the track list shows it: color resolved (tag ?: category). */
data class LibraryTag(
    val id: Int,
    val name: String,
    val categoryId: Int,
    val categoryName: String,
    val color: String?,
    val displayOrder: Int,
) {
    /** [color] as opaque ARGB, or null when unset/unparseable. */
    val argb: Int? get() = parseHexColor(color)
}

fun parseHexColor(color: String?): Int? {
    val hex = color?.removePrefix("#") ?: return null
    if (hex.length != 6) return null
    return hex.toIntOrNull(16)?.let { it or 0xff000000.toInt() }
}

data class TagCategory(val id: Int, val name: String, val color: String?, val displayOrder: Int)

data class HotCue(val slot: Int, val time: Double, val label: String?, val color: String?)

/** One tempo segment of a saved Beatgrid (desktop ADR 0027 shape). */
data class TempoChange(val startTime: Double, val bpm: Double, val timeSignatureNum: Int, val barPosition: Int)

data class Beatgrid(val origin: String, val anchorTime: Double?, val tempoChanges: List<TempoChange>)

/**
 * A desktop Library Track as synced to the device. `id` is the desktop Track
 * id (the device's only identity for it). `audioRev`/`previewRev` change when
 * the desktop's file / preview waveform changes; null = not available there.
 */
data class LibraryTrack(
    val id: Int,
    val title: String,
    val artist: String?,
    val fileName: String,
    val bpm: Double?,
    val key: Int?,
    val keyOpenKey: String?,
    val keyCamelot: String?,
    val energy: Int?,
    val durationSecs: Double?,
    val dateAdded: Instant?,
    val mainCue: Double?,
    val codec: String?,
    val fileSizeBytes: Long?,
    val audioRev: String?,
    val previewRev: String?,
    val tagIds: List<Int>,
    val hotCues: List<HotCue>,
    val grid: Beatgrid?,
)

/** A desktop Playlist (flat — the desktop has no folders); [trackIds] in Play order. */
data class Playlist(val id: Int, val name: String, val color: String?, val displayOrder: Int, val trackIds: List<Int>) {
    val argb: Int? get() = parseHexColor(color)
}

/** Aggregated saved Transitions for one ordered pair (a = outgoing). */
data class TransitionEdge(val a: Int, val b: Int, val count: Int, val favorite: Boolean)

data class CameoEdge(val host: Int, val guest: Int, val count: Int, val favorite: Boolean)

/** Handover Takes for one ordered pair — raw material for Observed. */
data class TakeEdge(val a: Int, val b: Int, val count: Int, val lastAt: Instant?)

/** The whole pulled snapshot, as the desktop served it. */
data class Snapshot(
    val version: Int,
    val generatedAt: Instant?,
    val categories: List<TagCategory>,
    val tags: List<LibraryTag>,
    val tracks: List<LibraryTrack>,
    val playlists: List<Playlist>,
    val links: List<Pair<Int, Int>>,
    val transitions: List<TransitionEdge>,
    val cameos: List<CameoEdge>,
    val takes: List<TakeEdge>,
)
