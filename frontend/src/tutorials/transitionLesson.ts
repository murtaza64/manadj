import type { Lesson, LessonContext, TutorialStep } from './engine';

function task(id: string, title: string, instruction: string, target: string, key?: string): TutorialStep {
  return { id, copy: () => ({ title, instruction, target, key }),
    accepts: (event, context) => event.type === id && (!context.artifact || event.artifact === context.artifact) };
}
const saved = (c: LessonContext) => c.editedVersion !== undefined && c.savedVersion !== undefined && c.savedVersion >= c.editedVersion;

export const transitionLesson: Lesson = {
  id: 'transition', title: 'Your first Transition', area: 'edit',
  observe: (progress, event) => {
    const context = progress.context;
    const update = (next: LessonContext) => ({ ...progress, context: next });
    if (event.type === 'transition-created' && progress.step === 2 && event.artifact && !context.artifact) {
      return update({ ...context, artifact: event.artifact });
    }
    if (!context.artifact || event.artifact !== context.artifact) return progress;
    if (event.type === 'transition-edited' && event.version !== undefined) return update({ ...context, editedVersion: event.version, saveError: false });
    if (event.type === 'transition-saved' && event.version !== undefined) return update({ ...context,
      savedVersion: Math.max(context.savedVersion ?? -1, event.version),
      saveError: event.version >= (context.editedVersion ?? -1) ? false : context.saveError });
    if (event.type === 'transition-save-failed' && (event.version ?? -1) >= (context.editedVersion ?? -1)) return update({ ...context, saveError: true });
    if (event.type === 'transition-restored' && event.version !== undefined) {
      // A reopened artifact proves only what was saved, not an abandoned draft.
      // Re-do automation/audition if the last edit had no acknowledgment.
      const pending = (context.editedVersion ?? -1) > (context.savedVersion ?? -1);
      return { ...progress, step: pending ? Math.min(progress.step, 4) : progress.step,
        context: { ...context, editedVersion: event.version, savedVersion: event.version, saveError: false } };
    }
    return progress;
  },
  steps: [
    task('transition-pick-a', 'Choose the outgoing Track', 'Search for a Track in the Mix picker on the right and pick a result. This is the Track you will mix out of. If chips are already filled, clear them with × first. This lesson creates a real Transition.', '[data-tour="edit.picker"]', 'Search → Enter'),
    task('transition-pick-b', 'Choose the incoming Track', 'Search again and pick a different Track. The left chip is outgoing; the right chip is incoming. Loaded-deck shortcuts work too.', '[data-tour="edit.picker"]', 'Search → Enter'),
    task('transition-created', 'Create the Transition', 'Choose + New Transition in the picker. This opens an unsaved draft; simply opening or auditioning it saves nothing.', '[data-tutorial="new-transition"]', '+ New Transition'),
    task('transition-slide', 'Align the incoming audio', 'Select mode (V): hold Alt and drag the incoming waveform horizontally, then release. This is Slide: the audio moves under its automation. A plain drag moves the audio and its treatment together.', '.rt-wave-row[data-slot="1"]', 'V → Alt + drag'),
    task('transition-automation', 'Shape the handover', 'On a FADER or EQ lane, click ✎ to expand it if needed. Click the line to add a point, then drag the point to shape the level. Selecting the lane alone does not count. Changes save automatically.', '[data-tutorial-control="fader"]', 'Click / drag a point'),
    task('transition-audition', 'Listen to your Transition', 'Click Play in the editor transport. The editor borrows the Decks; wait for the Tracks to load. Listen to your alignment and level change. Click Play again to pause.', '[data-tour="edit.transport"] .re-play', 'Play'),
    {
      ...task('transition-saved', 'Save your work', 'Waiting for the latest edit to be saved. There is no Save button: autosave runs after you stop editing. Keep this Transition open. If saving fails, make another edit to retry.', '[data-tour="edit.picker"]'),
      accepts: (event, context) => event.type === 'transition-saved' && event.artifact === context.artifact && saved(context),
      satisfied: saved,
    },
  ],
};
