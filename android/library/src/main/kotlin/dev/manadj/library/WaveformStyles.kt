package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/** 0..1 RGB. */
data class Rgb(val r: Float, val g: Float, val b: Float) {
    /** Opaque ARGB. */
    val argb: Int get() = (0xff shl 24) or (ch(r) shl 16) or (ch(g) shl 8) or ch(b)
    private fun ch(v: Float) = (v.coerceIn(0f, 1f) * 255f + 0.5f).toInt()
}

/**
 * One desktop Waveform style slot (frontend/src/waveform/styles.ts +
 * styleSlots.ts, ADR 0015): a style id + the shared params. Synced in the
 * snapshot (`waveform_styles`) so the phone draws the desktop's palette.
 */
data class WaveformStyle(
    val styleId: String = DEFAULT_STYLE_ID,
    /** Extra display exponent on de-quantized amplitudes. */
    val displayGamma: Float = 1f,
    val master: Float = 0.85f,
    /** Low/mid/high group gains. */
    val gains: List<Float> = listOf(0.7f, 1.05f, 1.5f),
    /** Bands [0,b1) low, [b1,b2) mid, [b2,8) high. */
    val b1: Int = 3,
    val b2: Int = 5,
    /** Interpolate band frames (off = raw ~12 ms steps). */
    val smooth: Boolean = true,
    val coreWhite: Float = 0.45f,
    val coreBloom: Float = 0.3f,
    /** Low/mid/high colors; null = the style's own defaults ([colors] resolves). */
    val customColors: List<Rgb>? = null,
) {
    /**
     * The persisted slot JSON (styleSlots.ts shape) over [base]: only fields
     * that differ from [base]'s parsed values are rewritten, so untouched
     * values (and unknown keys) round-trip exactly.
     */
    fun toJson(base: JSONObject? = null, fallback: WaveformStyle = WaveformStyle()): JSONObject {
        val was = parse(base, fallback)
        val out = JSONObject(base?.toString() ?: "{}")
        val params = out.optJSONObject("params") ?: JSONObject()
        fun <T> put(key: String, now: T, then: T, wire: (T) -> Any) { if (base == null || now != then) params.put(key, wire(now)) }
        put("displayGamma", displayGamma, was.displayGamma) { it.wire() }
        put("master", master, was.master) { it.wire() }
        put("gains", gains, was.gains) { g -> JSONArray(g.map { it.wire() }) }
        put("b1", b1, was.b1) { it }
        put("b2", b2, was.b2) { it }
        put("smooth", smooth, was.smooth) { it }
        put("coreWhite", coreWhite, was.coreWhite) { it.wire() }
        put("coreBloom", coreBloom, was.coreBloom) { it.wire() }
        put("colors", customColors, was.customColors) { c -> c?.let { JSONArray(it.map { rgb -> JSONArray(listOf(rgb.r.wire(), rgb.g.wire(), rgb.b.wire())) }) } ?: JSONObject.NULL }
        if (base == null || styleId != was.styleId) out.put("styleId", styleId)
        return out.put("params", params)
    }

    /** Low/mid/high group colors to draw with. */
    val colors: List<Rgb> get() = customColors ?: STYLE_DEFAULT_COLORS[styleId] ?: ADDITIVE_COLORS

    /** De-quantized amplitude (from [PreviewWaveform.band]/[PreviewWaveform.amplitude]) → display amplitude. */
    fun amp(v: Float): Float = v.toDouble().pow(displayGamma.toDouble()).toFloat()

    /** Column height 0..1 from the column's max peak (renderer: clamp(peak * master)). */
    fun peakHeight(peak: Float): Float = (amp(peak) * master).coerceIn(0f, 1f)

    /**
     * Low/mid/high group heights 0..1 from 8 band amplitudes (renderer
     * groupAmps: RMS per group × gain, soft-limited, × master).
     */
    fun groupHeights(bands: FloatArray): FloatArray {
        val e = FloatArray(3)
        for (i in bands.indices) {
            val a = amp(bands[i])
            e[if (i < b1) 0 else if (i < b2) 1 else 2] += a * a
        }
        return FloatArray(3) { (softLimit(sqrt(e[it]) * gains[it]) * master).coerceIn(0f, 1f) }
    }

    /**
     * Pixel color at amplitude coordinate [y] (0 = center/baseline, 1 = edge)
     * for a column with peak height [p] and group heights [g] — the style's
     * GLSL styleColor() with BG = transparent black (null = background).
     * Implemented: additive-rgb, additive-soft, additive-screen,
     * layered-opaque, dominant-band; other ids draw as additive-soft.
     */
    fun color(y: Float, p: Float, g: FloatArray): Rgb? {
        val (lo, mid, hi) = colors
        return when (styleId) {
            "additive-rgb" -> additive(y, g, lo, mid, hi)?.clamp()?.rgb()
            "additive-screen" -> {
                if (y >= g[0] && y >= g[1] && y >= g[2]) return null
                var c = V3(0f, 0f, 0f)
                if (y < g[0]) c = screen(c, lo)
                if (y < g[1]) c = screen(c, mid)
                if (y < g[2]) c = screen(c, hi)
                c.rgb()
            }
            "layered-opaque" -> when {
                y < g[2] -> hi
                y < g[1] -> mid
                y < g[0] -> lo
                y < p -> Rgb(0.15f, 0.15f, 0.20f)
                else -> null
            }
            "dominant-band" -> {
                if (y >= p) return null
                val w = FloatArray(3) { g[it] * g[it] * g[it] }
                val sum = w.sum() + 1e-6f
                val c = (V3(lo) * w[0] + V3(mid) * w[1] + V3(hi) * w[2]) * (1f / sum)
                (c * (0.45f + 0.55f * min(1f, max(g[0], max(g[1], g[2]))))).rgb()
            }
            else -> soft(y, g, lo, mid, hi)
        }
    }

    private fun additive(y: Float, g: FloatArray, lo: Rgb, mid: Rgb, hi: Rgb): V3? {
        if (y >= g[0] && y >= g[1] && y >= g[2]) return null
        var c = V3(0f, 0f, 0f)
        if (y < g[0]) c += V3(lo)
        if (y < g[1]) c += V3(mid)
        if (y < g[2]) c += V3(hi)
        return c
    }

    private fun soft(y: Float, g: FloatArray, lo: Rgb, mid: Rgb, hi: Rgb): Rgb? {
        var c = additive(y, g, lo, mid, hi) ?: return null
        val over = (c.max() - 1f).coerceIn(0f, 1f)
        if (over > 0f) {
            val w = FloatArray(3) { g[it] * g[it] }
            var d = (V3(lo) * w[0] + V3(mid) * w[1] + V3(hi) * w[2]) * (1f / (w.sum() + 1e-6f))
            d *= 1f / (d.max() + 1e-6f)
            val core = d.mix(V3(1f, 1f, 1f), (coreWhite + coreBloom * over).coerceIn(0f, 1f))
            c = c.clamp().mix(core, smoothstep(0f, 0.5f, over))
        }
        return c.clamp().rgb()
    }

    companion object {
        const val DEFAULT_STYLE_ID = "additive-rgb"
        val ADDITIVE_COLORS = listOf(Rgb(1f, 0.1f, 0.1f), Rgb(0f, 1f, 0.25f), Rgb(0.2f, 0.45f, 1f))
        private val STYLE_DEFAULT_COLORS = mapOf(
            "layered-opaque" to listOf(Rgb(0.08f, 0.22f, 1f), Rgb(1f, 0.56f, 0f), Rgb(1f, 1f, 1f)),
            "dominant-band" to listOf(Rgb(1f, 0.15f, 0.1f), Rgb(0.1f, 1f, 0.25f), Rgb(0.25f, 0.55f, 1f)),
            "transient-flux" to listOf(Rgb(0.02f, 0.3f, 1f), Rgb(0f, 0.85f, 0.3f), Rgb(0.93f, 1f, 0.97f)),
        )

        private fun softLimit(x: Float): Float {
            val knee = 0.6f
            return if (x <= knee) x else knee + (1f - knee) * (1f - exp(-(x - knee) / (1f - knee)))
        }

        private fun smoothstep(e0: Float, e1: Float, x: Float): Float {
            val t = ((x - e0) / (e1 - e0)).coerceIn(0f, 1f)
            return t * t * (3f - 2f * t)
        }

        private fun screen(c: V3, k: Rgb) = V3(1f - (1f - c.r) * (1f - 0.82f * k.r), 1f - (1f - c.g) * (1f - 0.82f * k.g), 1f - (1f - c.b) * (1f - 0.82f * k.b))

        /** Parse one persisted slot, sanitized like styleSlots.ts (bad fields fall back to [fallback]). */
        fun parse(json: JSONObject?, fallback: WaveformStyle): WaveformStyle {
            json ?: return fallback
            val p = json.optJSONObject("params") ?: JSONObject()
            fun num(key: String, fb: Float) = p.opt(key).let { if (it is Number && it.toDouble().isFinite()) it.toFloat() else fb }
            val gains = p.optJSONArray("gains")?.takeIf { it.length() == 3 }?.let { a -> List(3) { a.optDouble(it, 1.0).toFloat() } } ?: fallback.gains
            val b1 = num("b1", fallback.b1.toFloat()).let { Math.round(it) }.coerceIn(1, 7)
            var b2 = num("b2", fallback.b2.toFloat()).let { Math.round(it) }.coerceIn(2, 8)
            if (b2 <= b1) b2 = b1 + 1
            val colors = p.optJSONArray("colors")?.takeIf { it.length() == 3 }?.let { a ->
                (0 until 3).map { i -> a.optJSONArray(i)?.takeIf { it.length() == 3 }?.let(::rgb) }
                    .takeIf { list -> list.all { it != null } }?.map { it!! }
            } ?: fallback.customColors
            return WaveformStyle(
                styleId = json.optString("styleId").takeIf { it in STYLE_IDS } ?: fallback.styleId,
                displayGamma = num("displayGamma", fallback.displayGamma),
                master = num("master", fallback.master),
                gains = gains,
                b1 = b1,
                b2 = b2,
                smooth = (p.opt("smooth") as? Boolean) ?: fallback.smooth,
                coreWhite = num("coreWhite", fallback.coreWhite).coerceIn(0f, 1f),
                coreBloom = num("coreBloom", fallback.coreBloom).coerceIn(0f, 1f),
                customColors = colors,
            )
        }

        private fun rgb(a: JSONArray) = Rgb(a.optDouble(0).toFloat().coerceIn(0f, 1f), a.optDouble(1).toFloat().coerceIn(0f, 1f), a.optDouble(2).toFloat().coerceIn(0f, 1f))

        val STYLE_IDS = setOf(
            "additive-rgb", "additive-soft", "additive-screen", "layered-opaque",
            "dominant-band", "spectral-hue", "transient-flux", "additive-ticks",
        )
    }
}

/** The desktop's two Waveform style slots: [full] (decks, detail waveforms) and [minimap] (overview strips, previews). */
data class WaveformStyles(val full: WaveformStyle, val minimap: WaveformStyle) {
    /** The persisted `manadj.waveformStyles` JSON, keeping unknown keys of [base]. */
    fun toJson(base: JSONObject? = null): JSONObject {
        val out = JSONObject(base?.toString() ?: "{}").put("version", 1)
        return out.put("full", full.toJson(out.optJSONObject("full"), DEFAULT.full))
            .put("minimap", minimap.toJson(out.optJSONObject("minimap"), DEFAULT.minimap))
    }

    companion object {
        /** styleSlots.ts defaultSlots(): used when the desktop sent none. */
        val DEFAULT = WaveformStyles(WaveformStyle(), WaveformStyle(master = 2f))

        fun parse(json: JSONObject?): WaveformStyles {
            if (json == null || json.optInt("version", 1) != 1) return DEFAULT
            return WaveformStyles(
                WaveformStyle.parse(json.optJSONObject("full"), DEFAULT.full),
                WaveformStyle.parse(json.optJSONObject("minimap"), DEFAULT.minimap),
            )
        }
    }
}

/** Float → the shortest Double that prints the same (0.32f → 0.32, not 0.3199999928). */
private fun Float.wire(): Double = toString().toDouble()

private data class V3(val r: Float, val g: Float, val b: Float) {
    constructor(c: Rgb) : this(c.r, c.g, c.b)
    operator fun plus(o: V3) = V3(r + o.r, g + o.g, b + o.b)
    operator fun times(k: Float) = V3(r * k, g * k, b * k)
    fun max() = max(r, max(g, b))
    fun clamp() = V3(min(r, 1f), min(g, 1f), min(b, 1f))
    fun mix(o: V3, t: Float) = V3(r + (o.r - r) * t, g + (o.g - g) * t, b + (o.b - b) * t)
    fun rgb() = Rgb(r.coerceIn(0f, 1f), g.coerceIn(0f, 1f), b.coerceIn(0f, 1f))
}
