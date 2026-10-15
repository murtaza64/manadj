package dev.manadj.app

import androidx.compose.ui.geometry.Rect
import org.junit.Assert.assertEquals
import org.junit.Test

/** keepOut against the human's phone (Nothing A069P, 1260x2800 px): 162px corner radii, punch hole 577-683 x 0-162. */
class ScreenShapeTest {
    private val r = 162f
    private val phone = ScreenShape(
        listOf(ScreenCorner(true, true, r, 162f, 162f), ScreenCorner(false, true, r, 1098f, 162f), ScreenCorner(false, false, r, 1098f, 2638f), ScreenCorner(true, false, r, 162f, 2638f)),
        listOf(Rect(577f, 0f, 683f, 162f)),
    )

    @Test fun clearOfEverythingNeedsNoPadding() = assertEquals(0f to 0f, phone.keepOut(Rect(20f, 800f, 620f, 900f), 0f))

    @Test fun deckAInTheBandDodgesCornerAndHole() {
        val (l, rt) = phone.keepOut(Rect(20f, 41f, 620f, 162f), 0f) // 44dp-ish row bottom-aligned in the 162px band
        assertEquals(162f - kotlin.math.sqrt(r * r - 121f * 121f) - 20f, l, .01f)
        assertEquals(620f - 577f, rt, .01f)
    }

    @Test fun deckBDodgesHoleOnItsLeft() = assertEquals(683f - 640f, phone.keepOut(Rect(640f, 41f, 1240f, 162f), 0f).first, .01f)

    @Test fun bottomRowFollowsBottomCornerArc() {
        val (l, rt) = phone.keepOut(Rect(20f, 2700f, 620f, 2780f), 0f)
        assertEquals(162f - kotlin.math.sqrt(r * r - 142f * 142f) - 20f, l, .01f)
        assertEquals(0f, rt, .01f) // right edge 620 is outside the bottom-right corner square
    }

    @Test fun marginOnlyWhenIntruding() = assertEquals(4f, phone.keepOut(Rect(0f, 2700f, 100f, 2800f), 4f).first - phone.keepOut(Rect(0f, 2700f, 100f, 2800f), 0f).first, .01f)
}
