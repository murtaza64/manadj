---
slug: controllers
title: Controllers
summary: Check a controller's mapped controls and audio outputs, then tune DDJ-GRV6 jog response if needed.
order: 10
related: [audio, perform, beat-fx, start]
---

## Check your controller {#check}

1. Plug in the controller over USB and open **Settings → Controllers → Controller check**. You can also launch this guide alone from **Settings → Help → Setup**.
2. Choose **Master** and **Cue** outputs and use each **Test tone** button. Pick explicit output pairs when offered. A controller's headphone jack is often outputs 3/4; confirm by listening.
3. Under **MIDI controller**, find the device and check that it shows a **Mapping**.
4. Press a button or move a control. The guide displays its mapped action and counts the controls checked.
5. Click **Done**, or **Skip** to return later.

Supported models are the Pioneer DDJ-GRV6, Pioneer DDJ-SB3, and Hercules DJControl Inpulse 300 MK2. **No Mapping** means detection succeeded but that device's controls cannot operate manadj. An **Unmapped control** message on a supported model means that particular control has no assigned action.

If no device appears, check its connection. Allow MIDI access if prompted; a browser reporting MIDI unavailable cannot run this check. MIDI detection and audio routing are separate: a responding button does not confirm the headphone output. See [audio outputs](../audio/index.html#outputs) for PFL and Cue-bus checks.

The check observes real controller input; mapped controls still operate the app while you test them.

## Tune jog response {#jog-calibration}

Only the DDJ-GRV6 has adjustable jog calibration. Open **Settings → Controllers → Jog calibration**, or **Calibrate jog wheels** in Controller check when a GRV6 is detected.

1. Load a track in Performance and test a small rim movement during playback.
2. Adjust **Playback bend gain** for sensitivity and **Playback bend clamp** for the maximum bend. **Playback decay window** controls how the bend settles.
3. Pause and compare **Paused bare rim** with **Paused touch platter**. Adjust the response that feels too fast or slow.
4. Test Shift seeking before changing **Shift fast-seek base** or its acceleration controls.

Changes apply live and are saved. Use **Reset jog defaults** to start again. The SB3 uses fixed factory calibration; the Inpulse needs no calibration here. Computer-mouse jog controls are separate, under **Settings → Keyboard + mouse → Mouse jog**.
