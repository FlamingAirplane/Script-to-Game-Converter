import { dialogueOnly } from '../core/players';
import type { StoryProject } from '../core/isr';
import type { Update } from './projectOps';

/**
 * "Players see only the dialogue" (presentation.dialogueOnly), saved with the story: what every player gets
 * (Playtest, the playable page, Twine, Unity, Unreal) leaves out narration, transitions, scene headings and
 * parentheticals. Unlike the Dialogue only view (D), which only changes what the writer sees here.
 */
export function DialogueOnlySetting({ project, update }: { project: StoryProject; update: Update }) {
  const on = dialogueOnly(project);
  const imported = project.inkPassthrough !== undefined;
  return (
    <div className="field dialogue-only-setting">
      <label>
        <input
          type="checkbox"
          checked={on}
          disabled={imported}
          onChange={(e) =>
            update((d) => {
              const rest = { ...d.presentation };
              if (e.target.checked) rest.dialogueOnly = true;
              else delete rest.dialogueOnly;
              d.presentation = Object.keys(rest).length ? rest : undefined;
            })
          }
        />{' '}
        <strong>Players see only the dialogue</strong>
      </label>
      <span className="muted small">
        {imported
          ? 'This story was imported as Ink and is played as written, so this can’t be changed here.'
          : on
            ? 'Narration, transitions, scene headings and parentheticals are left out of Playtest and every export (the Ink keeps them as comments). Choices, pictures, music and sounds stay.'
            : 'Leave out narration, transitions, scene headings and parentheticals everywhere the story is played: Playtest, the playable page, Twine, Unity and Unreal.'}
      </span>
    </div>
  );
}
