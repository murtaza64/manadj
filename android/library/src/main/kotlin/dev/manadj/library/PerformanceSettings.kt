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
) {
    companion object {
        const val WAVEFORM_STYLES = "manadj.waveformStyles"
        const val FILTER = "manadj-filter-settings"

        fun of(settings: Map<String, SyncedSetting>): PerformanceSettings = PerformanceSettings(
            waveformStyles = WaveformStyles.parse(settings[WAVEFORM_STYLES]?.json?.let(::obj)),
            filterJson = settings[FILTER]?.json,
        )

        private fun obj(text: String): JSONObject? = try { JSONObject(text) } catch (_: org.json.JSONException) { null }
    }
}
