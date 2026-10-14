package dev.manadj.library

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GridMathTest {
    private fun near(a: Double, b: Double, eps: Double = 1e-9) = assertTrue(kotlin.math.abs(a - b) < eps, "$a != $b")

    @Test fun setDownbeatWrapsBarPhaseBackToZero() {
        // 120 BPM (0.5 s beats): a mark at 10.25 s → 20 beats back to 0.25 s; 20 % 4 == 0 → downbeat.
        val tc = GridMath.setDownbeatAt(10.25, 120.0).single()
        near(tc.startTime, 0.25); assertEquals(1, tc.barPosition)
        // 10.75 s → 21 beats back; first beat is bar position 4.
        assertEquals(4, GridMath.setDownbeatAt(10.75, 120.0).single().barPosition)
        val downbeats = GridMath.expand(GridMath.setDownbeatAt(10.75, 120.0), 20.0).downbeats
        assertTrue(downbeats.any { kotlin.math.abs(it - 10.75) < 1e-9 })
    }

    @Test fun setDownbeatOnPlaceholderMakesEditedGridWithAnchor() {
        val g = GridMath.setDownbeat(null, 128.0, 3.0)!!
        assertEquals("edited", g.origin); assertEquals(3.0, g.anchorTime)
        assertNull(GridMath.setDownbeat(null, null, 3.0))
    }

    @Test fun variableGridReAnchorsByRigidShift() {
        val changes = listOf(TempoChange(0.0, 120.0, 4, 1), TempoChange(8.0, 140.0, 4, 1))
        val g = GridMath.setDownbeat(Beatgrid("imported", null, changes), null, 2.1)!!
        assertEquals(2, g.tempoChanges.size)
        near(g.tempoChanges[0].startTime, 0.1); near(g.tempoChanges[1].startTime, 8.1)
    }

    @Test fun nudgeShiftsAnchorByAppliedOffsetAndClamps() {
        val g = GridMath.nudge(Beatgrid("edited", 1.0, GridMath.constant(120.0, start = 0.0)), null, -500.0, 300.0)!!
        near(g.tempoChanges[0].startTime, -0.1); near(g.anchorTime!!, 0.9)
    }

    @Test fun retempoRespacesAroundAnchorAndRefusesVariable() {
        val g = GridMath.retempo(Beatgrid("edited", 10.0, GridMath.setDownbeatAt(10.0, 120.0)), null, 125.0)!!
        assertEquals(125.0, g.tempoChanges[0].bpm)
        assertTrue(GridMath.expand(g.tempoChanges, 30.0).downbeats.any { kotlin.math.abs(it - 10.0) < 1e-9 })
        assertNull(GridMath.retempo(Beatgrid("edited", null, listOf(TempoChange(0.0, 120.0, 4, 1), TempoChange(8.0, 140.0, 4, 1))), null, 130.0))
    }

    @Test fun growShrinkSnapsToRoundTempos() {
        assertEquals(127.97, GridMath.growShrink(128.0, grow = true))
        assertEquals(128.0, GridMath.growShrink(127.98, grow = false))
    }

    @Test fun gridOriginExtendsLateFirstMarkBackward() {
        // First stored beat at 2.0 s (downbeat), 120 BPM: origin extends back to 0.0.
        near(GridMath.gridOrigin(listOf(TempoChange(2.0, 120.0, 4, 1))), 0.0)
    }

    private fun downbeats(bars: Int) = DoubleArray(bars) { it * 2.0 } // 120 BPM 4/4: 2 s bars from 0

    @Test fun defaultLadderCountsFromOrigin() {
        val p = LadderProjection.resolve(GridMath.constant(120.0), downbeats(32), emptyList())!!
        assertEquals("1 of 16", p.label(0)); assertEquals("16 of 16", p.label(15)); assertEquals(4, p.tiers[16])
    }

    @Test fun anchorPeelsIntroBackward() {
        // Mark at bar 8: an 8-bar intro reads "1 of 8 … 8 of 8".
        val p = LadderProjection.resolve(GridMath.constant(120.0), downbeats(40), listOf(16.0))!!
        assertEquals("1 of 8", p.label(0)); assertEquals("8 of 8", p.label(7)); assertEquals("1 of 16", p.label(8))
        // A 9-bar intro leaves a leading +1 pickup.
        val q = LadderProjection.resolve(GridMath.constant(120.0), downbeats(40), listOf(18.0))!!
        assertEquals("+1", q.label(0)); assertEquals("1 of 8", q.label(1))
    }

    @Test fun boundedSegmentTrailingBarsAreParenthetical() {
        // Marks at bars 0 and 18: 18 bars = 16 + (2 extra).
        val p = LadderProjection.resolve(GridMath.constant(120.0), downbeats(40), listOf(0.0, 36.0))!!
        assertEquals("16 of 16", p.label(15)); assertEquals("+1", p.label(16)); assertEquals("+2", p.label(17)); assertEquals("1 of 16", p.label(18))
    }

    @Test fun gridAndMarksJournalAndOverlay() {
        val t = track(1)
        val grid = GridMath.setDownbeat(null, 174.0, 1.5)!!
        val (field, old) = TrackFields.current(t, TrackEdit.Grid(grid))
        assertEquals("grid", field); assertNull(old)
        val e = JournaledEdit.fromJson(EditJournal.newEdit(1, field, old, TrackFields.newValue(TrackEdit.Grid(grid))).toJson().let { org.json.JSONObject(it.toString()) })
        val applied = TrackFields.apply(t, e)
        assertEquals(grid.tempoChanges, applied.grid!!.tempoChanges); assertEquals(1.5, applied.grid!!.anchorTime)
        val m = EditJournal.newEdit(1, "reset_marks", TrackFields.read(t, "reset_marks"), TrackFields.newValue(TrackEdit.ResetMarks(listOf(32.0, 8.0))))
        val withMarks = TrackFields.apply(applied, JournaledEdit.fromJson(org.json.JSONObject(m.toJson().toString())))
        assertEquals(listOf(8.0, 32.0), withMarks.ladder!!.resetMarks)
        assertTrue(TrackFields.same(TrackFields.read(withMarks, "reset_marks"), org.json.JSONArray(listOf(8.0, 32.0))))
    }
}
