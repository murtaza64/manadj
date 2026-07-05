/**
 * Search-field keyboard flow (keyboard-focus 02, PRD decisions 5-6):
 *
 * - Cmd/Ctrl+F focuses the library search and selects the existing query
 *   (typing replaces it); the browser find bar is suppressed.
 * - Staged Escape: Escape while nothing type-y is focused and a search is
 *   active clears the search — the second stage after the field's own
 *   Escape (blur, filter kept — FilterBar).
 *
 * One self-registering hook, mounted by FilterBar — which every view's
 * browse surface renders (library, Performance, the editor's embedded
 * panel), so the rule lives once and follows the search field around.
 *
 * Escape ordering: modals/popovers must beat the staged clear. They
 * consume Escape before this document-bubble listener sees it (capture
 * phase + stopPropagation — BpmModal, CircleOfFifthsModal,
 * FollowParamsModal, ContextMenu; React stopPropagation — TagPopover,
 * SaveTemplateModal, AutoBlurSelect).
 *
 * `/` is NOT a search key here: it's deck B pad 4 (performanceKeys.ts).
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useFilters } from '../contexts/FilterContext';
import { isTextEntryTarget } from './performance/performanceKeys';

/** Cmd/Ctrl+F — the find chord, claimed for the library search. */
export function isFindChord(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'f'
  );
}

/** The staged-Escape rule (pure seam): clear only when there is a search
 * to clear and the keyboard isn't inside a typing target. */
export function shouldClearSearch(event: KeyboardEvent, activeSearch: string): boolean {
  return (
    event.key === 'Escape' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    activeSearch !== '' &&
    !isTextEntryTarget(event.target)
  );
}

/** Mount the search keys on the document (bubble phase — everything that
 * must beat the staged clear stops propagation before it gets here). */
export function useSearchKeys(inputRef: RefObject<HTMLInputElement | null>) {
  const { filters, clearSearch } = useFilters();
  const activeSearch = filters.search;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFindChord(event)) {
        event.preventDefault(); // no browser find bar
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (shouldClearSearch(event, activeSearch)) clearSearch();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inputRef, activeSearch, clearSearch]);
}
