package dev.manadj.library

import org.json.JSONObject
import java.time.Instant

/**
 * One synced desktop setting as the snapshot carries it: [json] is the
 * value the desktop persists (settings #176; null when unset/unparseable),
 * [updatedAt] null when it's the shipped default rather than a user value.
 */
data class SyncedSetting(val json: String?, val updatedAt: Instant?)

/**
 * The desktop performance settings the phone plays with (snapshot
 * `settings`, backend SYNCED_SETTINGS). Waveform styles are typed here; the
 * filter is raw JSON for the engine (dev.manadj.audio.FilterSettings.fromJson
 * / toJson, PlayerModel.updateFilterSettings).
 */
data class PerformanceSettings(
    val waveformStyles: WaveformStyles = WaveformStyles.DEFAULT,
    /** manadj-filter-settings as persisted (null = none synced yet). */
    val filterJson: String? = null,
    /** The desktop's Follow parameters (manadj-follow-params; seed is session-local, not synced). */
    val follow: FollowParams = FollowParams(),
) {
    companion object {
        const val WAVEFORM_STYLES = "manadj.waveformStyles"
        const val FILTER = "manadj-filter-settings"
        const val FOLLOW = "manadj-follow-params"

        /** paramsStore.ts loadParams: defaults under the stored value; temperature 0..1, threshold 0..15. */
        fun parseFollow(json: JSONObject?): FollowParams {
            val d = FollowParams()
            json ?: return d
            fun num(key: String, fb: Double) = (json.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: fb
            return d.copy(
                bpm = json.opt("bpm") as? Boolean ?: d.bpm,
                bpmThresholdPercent = num("bpmThresholdPercent", d.bpmThresholdPercent).coerceIn(0.0, 15.0),
                knownOnly = json.opt("knownOnly") as? Boolean ?: d.knownOnly,
                temperature = num("temperature", d.temperature).coerceIn(0.0, 1.0),
            )
        }

        fun followJson(params: FollowParams, base: JSONObject?): JSONObject = JSONObject(base?.toString() ?: "{}")
            .put("bpm", params.bpm).put("bpmThresholdPercent", params.bpmThresholdPercent.let { if (it % 1.0 == 0.0) it.toInt() else it })
            .put("knownOnly", params.knownOnly).put("temperature", params.temperature)

        fun of(settings: Map<String, SyncedSetting>): PerformanceSettings = PerformanceSettings(
            waveformStyles = WaveformStyles.parse(settings[WAVEFORM_STYLES]?.json?.let(::obj)),
            filterJson = settings[FILTER]?.json,
            follow = parseFollow(settings[FOLLOW]?.json?.let(::obj)),
        )

        private fun obj(text: String): JSONObject? = try { JSONObject(text) } catch (_: org.json.JSONException) { null }
    }
}
