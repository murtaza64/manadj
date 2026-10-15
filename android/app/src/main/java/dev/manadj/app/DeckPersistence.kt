package dev.manadj.app

import dev.manadj.audio.BeatFxEffect
import dev.manadj.audio.BeatFxState
import dev.manadj.audio.BeatFxTarget
import dev.manadj.audio.DeckId
import org.json.JSONArray
import org.json.JSONObject

/**
 * What re-creates a deck's source after a restart / reinstall: a library load ([file] in app storage, plus
 * its metadata, grid, stored cues and stems) or a local document ([uri] with a persisted grant).
 */
data class SavedSource(
    val sourceId: String, val title: String, val artist: String, val durationSeconds: Double?,
    val file: String? = null, val uri: String? = null,
    val bpm: Double? = null, val firstBeatSeconds: Double? = null,
    val mainCueSeconds: Double? = null, val hotCues: Map<Int, Double> = emptyMap(), val stems: List<String>? = null,
)

/** A deck's restorable state (engine-applied values from its snapshot). */
data class SavedDeck(
    val source: SavedSource,
    val position: Double, val cue: Double?, val hotCues: List<Double?>,
    val loopStart: Double?, val loopEnd: Double?,
    val pitch: Double, val keyLock: Boolean,
    val fader: Double, val trim: Double, val eq: List<Double>, val filter: Double, val pfl: Boolean,
    val stemGains: List<Double>,
)

/** The whole performance surface's restorable state. */
data class SavedSession(
    val decks: Map<DeckId, SavedDeck>, val crossfade: Double, val cueMix: Double, val beatFx: BeatFxState,
)

/** JSON codec (SharedPreferences value). Unknown/garbled input decodes to null; never throws. */
object DeckPersistence {
    const val PREFS = "manadj-decks"
    const val KEY = "session"

    fun encode(s: SavedSession): String = JSONObject().apply {
        put("v", 1)
        put("crossfade", s.crossfade); put("cueMix", s.cueMix)
        put("beatFx", JSONObject().apply {
            put("effect", s.beatFx.effect?.name ?: JSONObject.NULL); put("target", s.beatFx.target.name); put("on", s.beatFx.on)
            put("depth", s.beatFx.depth); put("beats", s.beatFx.beats); put("held", JSONArray(s.beatFx.held.map { it.name }))
        })
        put("decks", JSONObject().apply { s.decks.forEach { (id, d) -> put(id.name, deck(d)) } })
    }.toString()

    private fun deck(d: SavedDeck) = JSONObject().apply {
        val src = d.source
        put("source", JSONObject().apply {
            put("sourceId", src.sourceId); put("title", src.title); put("artist", src.artist)
            opt("duration", src.durationSeconds); opt("file", src.file); opt("uri", src.uri)
            opt("bpm", src.bpm); opt("firstBeat", src.firstBeatSeconds); opt("mainCue", src.mainCueSeconds)
            put("hotCues", JSONObject().apply { src.hotCues.forEach { (k, v) -> put(k.toString(), v) } })
            src.stems?.let { put("stems", JSONArray(it)) }
        })
        put("position", d.position); opt("cue", d.cue)
        put("hotCues", JSONArray(d.hotCues.map { it ?: JSONObject.NULL }))
        opt("loopStart", d.loopStart); opt("loopEnd", d.loopEnd)
        put("pitch", d.pitch); put("keyLock", d.keyLock)
        put("fader", d.fader); put("trim", d.trim); put("eq", JSONArray(d.eq)); put("filter", d.filter); put("pfl", d.pfl)
        put("stemGains", JSONArray(d.stemGains))
    }

    private fun JSONObject.opt(key: String, value: Any?) { if (value != null) put(key, value) }
    private fun JSONObject.double(key: String): Double? = if (has(key) && !isNull(key)) getDouble(key).takeIf { it.isFinite() } else null
    private fun JSONObject.string(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null
    private fun JSONArray.doubles() = List(length()) { if (isNull(it)) null else getDouble(it) }

    fun decode(json: String?): SavedSession? = runCatching {
        val o = JSONObject(json ?: return null)
        if (o.optInt("v") != 1) return null
        val fx = o.getJSONObject("beatFx")
        val beatFx = BeatFxState(
            effect = fx.string("effect")?.let { BeatFxEffect.valueOf(it) }, target = BeatFxTarget.valueOf(fx.getString("target")),
            on = fx.getBoolean("on"), depth = fx.getDouble("depth"), beats = fx.getDouble("beats"),
            held = fx.getJSONArray("held").let { a -> List(a.length()) { DeckId.valueOf(a.getString(it)) }.toSet() },
        )
        val decks = o.getJSONObject("decks")
        SavedSession(
            decks = decks.keys().asSequence().associate { key ->
                val d = decks.getJSONObject(key)
                val s = d.getJSONObject("source")
                val hot = s.getJSONObject("hotCues")
                DeckId.valueOf(key) to SavedDeck(
                    source = SavedSource(
                        sourceId = s.getString("sourceId"), title = s.getString("title"), artist = s.getString("artist"),
                        durationSeconds = s.double("duration"), file = s.string("file"), uri = s.string("uri"),
                        bpm = s.double("bpm"), firstBeatSeconds = s.double("firstBeat"), mainCueSeconds = s.double("mainCue"),
                        hotCues = hot.keys().asSequence().associate { it.toInt() to hot.getDouble(it) },
                        stems = if (s.has("stems")) s.getJSONArray("stems").let { a -> List(a.length()) { a.getString(it) } } else null,
                    ),
                    position = d.getDouble("position"), cue = d.double("cue"), hotCues = d.getJSONArray("hotCues").doubles(),
                    loopStart = d.double("loopStart"), loopEnd = d.double("loopEnd"),
                    pitch = d.getDouble("pitch"), keyLock = d.getBoolean("keyLock"),
                    fader = d.getDouble("fader"), trim = d.getDouble("trim"), eq = d.getJSONArray("eq").doubles().map { it ?: .5 },
                    filter = d.getDouble("filter"), pfl = d.getBoolean("pfl"),
                    stemGains = d.getJSONArray("stemGains").doubles().map { it ?: 1.0 },
                )
            },
            crossfade = o.getDouble("crossfade"), cueMix = o.getDouble("cueMix"), beatFx = beatFx,
        )
    }.getOrNull()
}
