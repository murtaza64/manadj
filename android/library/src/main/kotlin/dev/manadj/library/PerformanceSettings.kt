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
 * `settings`, backend SYNCED_SETTINGS), typed and sanitized like the
 * desktop frontend does.
 */
data class PerformanceSettings(
    val waveformStyles: WaveformStyles = WaveformStyles.DEFAULT,
    val filter: FilterSettings = FilterSettings(),
) {
    companion object {
        const val WAVEFORM_STYLES = "manadj.waveformStyles"
        const val FILTER = "manadj-filter-settings"

        fun of(settings: Map<String, SyncedSetting>): PerformanceSettings = PerformanceSettings(
            waveformStyles = WaveformStyles.parse(settings[WAVEFORM_STYLES]?.json?.let(::obj)),
            filter = FilterSettings.parse(settings[FILTER]?.json?.let(::obj)),
        )

        private fun obj(text: String): JSONObject? = try { JSONObject(text) } catch (_: org.json.JSONException) { null }
    }
}

/**
 * The desktop DJ filter tuning (frontend/src/playback/filterSettings.ts):
 * [model] + parameters, clamped to the desktop's ranges.
 */
data class FilterSettings(
    /** current | res12 | res24 | res48 | dual. */
    val model: String = "res24",
    val resonance: Double = 17.0,
    val compensation: Double = 0.85,
    val curve: Double = 1.0,
    val deadzone: Double = 0.03,
    /** Hz: low-pass sweep floor. */
    val lpMin: Double = 40.0,
    /** Hz: high-pass sweep ceiling. */
    val hpMax: Double = 16000.0,
    val spread: Double = 0.8,
    /** dB. */
    val drive: Double = 0.0,
    /** dB. */
    val trim: Double = 0.0,
    /** ms. */
    val smoothing: Double = 20.0,
) {
    companion object {
        val MODELS = setOf("current", "res12", "res24", "res48", "dual")
        val RANGES: Map<String, ClosedFloatingPointRange<Double>> = mapOf(
            "resonance" to 0.0..24.0,
            "compensation" to 0.0..1.0,
            "curve" to 0.35..2.5,
            "deadzone" to 0.0..0.12,
            "lpMin" to 20.0..300.0,
            "hpMax" to 2000.0..20000.0,
            "spread" to 0.0..2.0,
            "drive" to 0.0..18.0,
            "trim" to -18.0..12.0,
            "smoothing" to 5.0..100.0,
        )

        /** sanitizeFilterSettings: unknown model / non-numbers → defaults, numbers clamped. */
        fun parse(json: JSONObject?): FilterSettings {
            val d = FilterSettings()
            json ?: return d
            fun n(key: String, fb: Double): Double {
                val v = json.opt(key) as? Number ?: return fb
                val x = v.toDouble().takeIf { it.isFinite() } ?: return fb
                return x.coerceIn(RANGES.getValue(key))
            }
            return FilterSettings(
                model = json.optString("model").takeIf { it in MODELS } ?: d.model,
                resonance = n("resonance", d.resonance),
                compensation = n("compensation", d.compensation),
                curve = n("curve", d.curve),
                deadzone = n("deadzone", d.deadzone),
                lpMin = n("lpMin", d.lpMin),
                hpMax = n("hpMax", d.hpMax),
                spread = n("spread", d.spread),
                drive = n("drive", d.drive),
                trim = n("trim", d.trim),
                smoothing = n("smoothing", d.smoothing),
            )
        }
    }
}
