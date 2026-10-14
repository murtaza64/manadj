package dev.manadj.app

import androidx.compose.ui.graphics.Color

/** OpenKey notation (desktop keyUtils): accepts OpenKey ("8m") or Camelot ("5A") and returns OpenKey. */
fun toOpenKey(key: String?): String? {
    val k = key?.trim() ?: return null
    Regex("^(\\d{1,2})([md])$").matchEntire(k)?.let { return k }
    val m = Regex("^(\\d{1,2})([AB])$", RegexOption.IGNORE_CASE).matchEntire(k) ?: return null
    val camelot = m.groupValues[1].toInt().takeIf { it in 1..12 } ?: return null
    val num = (camelot - 8 + 12) % 12 + 1 // Camelot 8B = C major = OpenKey 1d
    return "$num" + if (m.groupValues[2].equals("A", true)) "m" else "d"
}

private fun hsl(h: Float, l: Float) = Color.hsl(h % 360f, 1f, l)

/** Desktop getBpmColor: hue 180 → 300 over 60–200 BPM, hsl(h, 100%, 75%). */
fun bpmColor(bpm: Double?): Color? = bpm?.takeIf { it > 0 }?.let { hsl(180f + ((it.coerceIn(60.0, 200.0) - 60) / 140 * 120).toFloat(), .75f) }

/** Desktop getKeyColor: 30° per OpenKey position, minor 60% / major 75% lightness. */
fun keyColor(openKey: String?): Color? {
    val m = Regex("^(\\d{1,2})([md])$").matchEntire(openKey ?: return null) ?: return null
    return hsl(((m.groupValues[1].toInt() - 1) * 30).toFloat(), if (m.groupValues[2] == "m") .60f else .75f)
}

/** Desktop matchScore keyRelation: same / relative (m↔d) / up / down (±1 on the wheel, same mode) / other. */
enum class KeyRelation(val strength: Float) { SAME(1f), RELATIVE(.8f), UP(.7f), DOWN(.6f), OTHER(0f) }

fun keyRelation(reference: String?, candidate: String?): KeyRelation {
    val r = Regex("^(\\d{1,2})([md])$").matchEntire(reference ?: return KeyRelation.OTHER) ?: return KeyRelation.OTHER
    val c = Regex("^(\\d{1,2})([md])$").matchEntire(candidate ?: return KeyRelation.OTHER) ?: return KeyRelation.OTHER
    val rn = r.groupValues[1].toInt(); val cn = c.groupValues[1].toInt()
    if (cn == rn) return if (c.groupValues[2] == r.groupValues[2]) KeyRelation.SAME else KeyRelation.RELATIVE
    if (c.groupValues[2] != r.groupValues[2]) return KeyRelation.OTHER
    if (cn == (if (rn == 12) 1 else rn + 1)) return KeyRelation.UP
    if (cn == (if (rn == 1) 12 else rn - 1)) return KeyRelation.DOWN
    return KeyRelation.OTHER
}
