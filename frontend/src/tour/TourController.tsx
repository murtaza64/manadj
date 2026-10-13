/**
 * TourController (feature-tour #282): mounts once in App, above the view
 * switch. Watches where the user is (tourState activity stores), auto-
 * starts an unseen section's coach marks on first entry, and serves
 * explicit replays from the TopBar ? menu.
 *
 * First-run interplay (story 4): auto-start holds off while anything
 * wearing `data-tour-suppress` is in the DOM (the onboarding welcome
 * screen's hook) or any keyboard overlay (dialog/menu/modal) is open —
 * it retries while the section stays current, so the tour begins right
 * after the welcome flow ends.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hasKeyboardOverlay } from '../components/performance/performanceKeys';
import { tourSection } from './steps';
import { visibleSteps } from './anchors';
import { TourOverlay } from './TourOverlay';
import { activeTutorial, lessonById, subscribeTutorial, tutorialVersion } from '../tutorials/tutorialState';
import {
  activeTourSection,
  allToursSkipped,
  consumeTourRequest,
  isSectionSeen,
  markSectionSeen,
  pendingTourRequest,
  skipAllTours,
  subscribeTour,
  tourVersion,
  type TourSectionId,
} from './tourState';

function suppressed(): boolean {
  return document.querySelector('[data-tour-suppress]') !== null || hasKeyboardOverlay();
}

export function TourController() {
  const tutorial = useSyncExternalStore(subscribeTutorial, tutorialVersion);
  const version = useSyncExternalStore(subscribeTour, tourVersion);
  const [active, setActive] = useState<{ section: TourSectionId; auto: boolean } | null>(null);
  // A consumed replay request survives effect re-runs (the navigation it
  // triggers — mode switch, Settings toggle — bumps the store version and
  // would otherwise cancel the polling below mid-flight).
  const replayRef = useRef<TourSectionId | null>(null);
  useEffect(() => {
    const lesson = activeTutorial();
    if (active?.auto && lesson && lessonById(lesson).area === active.section) {
      markSectionSeen(active.section);
      setActive(null);
    }
  }, [active, tutorial]);

  useEffect(() => {
    // Explicit replay beats everything, including a tour already open.
    const incoming = pendingTourRequest();
    if (incoming) {
      consumeTourRequest();
      replayRef.current = incoming;
    }
    const requested = replayRef.current;
    if (!requested && active) return;
    const candidate = requested ?? activeTourSection();
    if (candidate === null) return;
    // First entry teaches a real Transition. Coach marks remain explicit replay.
    if (!requested && candidate === 'edit') return;
    if (!requested && (allToursSkipped() || isSectionSeen(candidate))) return;
    const section = tourSection(candidate);
    if (!section) return;
    // Poll until the view's anchors are rendered (lazy panes, replay right
    // after a mode switch) and — for auto-start — until the first-run
    // welcome / open dialogs clear. Auto-start abandons if the user moves
    // on; a replay gives up after a few seconds.
    let tries = 0;
    const timer = setInterval(() => {
      if (!requested && activeTourSection() !== candidate) {
        clearInterval(timer);
        return;
      }
      if (!requested && suppressed()) return;
      const lesson = activeTutorial();
      if (!requested && lesson && lessonById(lesson).area === candidate) return;
      if (requested && ++tries > 20) {
        replayRef.current = null;
        clearInterval(timer);
        return;
      }
      if (visibleSteps(section.steps).length === 0) return;
      if (requested) replayRef.current = null;
      clearInterval(timer);
      setActive({ section: candidate, auto: !requested });
    }, 250);
    return () => clearInterval(timer);
  }, [version, active, tutorial]);

  if (!active) return null;
  const section = tourSection(active.section);
  if (!section) return null;
  return (
    <TourOverlay
      key={active.section}
      section={section}
      auto={active.auto}
      onDone={() => {
        markSectionSeen(active.section);
        setActive(null);
      }}
      onSkipAll={() => {
        skipAllTours();
        setActive(null);
      }}
    />
  );
}
