package dev.manadj.library

import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WaveformStylesTest {
    // backend/shipped_defaults.json "manadj.waveformStyles" (trimmed colors).
    private val shipped = """
        {"version":1,
         "full":{"styleId":"additive-soft","params":{"displayGamma":1,"master":1,"gains":[0.7,1.05,1.5],"b1":3,"b2":5,"smooth":true,
           "coreWhite":0.32,"coreBloom":0.3,"colors":[[0.78,0.06,0.06],[0.24,0.69,0.07],[0.06,0.59,1]]}},
         "minimap":{"styleId":"additive-soft","params":{"master":1.16,"coreWhite":0.12,"colors":null}}}
    """.trimIndent()

    @Test fun parsesSlotsAndSanitizes() {
        val styles = WaveformStyles.parse(JSONObject(shipped))
        assertEquals("additive-soft", styles.full.styleId)
        assertEquals(0.32f, styles.full.coreWhite)
        assertEquals(Rgb(0.24f, 0.69f, 0.07f), styles.full.colors[1])
        // Missing params fall back to the slot defaults; null colors = the style's own.
        assertEquals(1.16f, styles.minimap.master)
        assertEquals(listOf(0.7f, 1.05f, 1.5f), styles.minimap.gains)
        assertEquals(WaveformStyle.ADDITIVE_COLORS, styles.minimap.colors)

        val bad = WaveformStyles.parse(JSONObject("""{"version":1,"full":{"styleId":"nope","params":{"b1":9,"b2":1,"coreWhite":5,"master":"x"}}}"""))
        assertEquals("additive-rgb", bad.full.styleId)
        assertEquals(7, bad.full.b1)
        assertEquals(8, bad.full.b2)
        assertEquals(1f, bad.full.coreWhite)
        assertEquals(0.85f, bad.full.master)
        assertEquals(WaveformStyles.DEFAULT, WaveformStyles.parse(null))
        assertEquals(WaveformStyles.DEFAULT, WaveformStyles.parse(JSONObject("""{"version":2}""")))
    }

    @Test fun groupHeightsMatchRenderer() {
        val style = WaveformStyle(master = 1f, gains = listOf(1f, 1f, 1f))
        val bands = floatArrayOf(0.3f, 0.4f, 0f, 0f, 0f, 0f, 0f, 0f)
        val g = style.groupHeights(bands)
        assertEquals(0.5f, g[0], 1e-5f) // sqrt(.09+.16), below the 0.6 knee: linear
        assertEquals(0f, g[1])
        val loud = style.groupHeights(floatArrayOf(1f, 1f, 1f, 0f, 0f, 0f, 0f, 0f))[0]
        assertTrue(loud < 1f && loud > 0.9f) // soft-limited, not clipped
    }

    @Test fun additiveSoftCoreAndFringes() {
        val style = WaveformStyle(styleId = "additive-soft", coreWhite = 0f, coreBloom = 0f)
        val g = floatArrayOf(0.8f, 0.4f, 0.2f)
        assertNull(style.color(0.9f, 0.9f, g)) // above every group: background
        assertEquals(WaveformStyle.ADDITIVE_COLORS[0], style.color(0.5f, 0.9f, g)) // low only: pure low color
        val core = style.color(0.1f, 0.9f, g)!! // all three stacked: dominant (low) hue, not white
        assertTrue(core.r > core.g && core.r > core.b)
        assertEquals(Rgb(1f, 1f, 1f), WaveformStyle(styleId = "additive-rgb").color(0.1f, 0.9f, floatArrayOf(1f, 1f, 1f))) // plain sum clips white
    }
}
