import { Badge } from '../common';
import { languageName } from '../language';
import { dialogueOnly as playersSeeDialogueOnly } from '../../core/players';
import type { ProcessedStory } from '../../core/pipeline';

/** The heading and switches above the story text: voices, music, language, dialogue only, locked choices, undo, restart. */
export function Toolbar({
  processed,
  voicesOn,
  toggleVoices,
  hasCueSounds,
  cueSoundsOn,
  toggleCueSounds,
  languages,
  lang,
  setLanguage,
  dialogueOnly,
  onDialogueOnly,
  showGated,
  onShowGated,
  canUndo,
  undo,
  restart,
  chosenCount,
  forgetChosen,
}: {
  processed: ProcessedStory;
  voicesOn: boolean;
  toggleVoices: () => void;
  /** Some cue has a sound attached, so the music switch is shown. */
  hasCueSounds: boolean;
  cueSoundsOn: boolean;
  toggleCueSounds: () => void;
  languages: string[];
  lang: string;
  setLanguage: (code: string) => void;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
  showGated: boolean;
  onShowGated: (on: boolean) => void;
  canUndo: boolean;
  undo: () => void;
  restart: () => void;
  chosenCount: number;
  forgetChosen: () => void;
}) {
  return (
    <div className="stage-head">
      <h2>{processed.project.project.title}</h2>
      {playersSeeDialogueOnly(processed.project) && (
        <Badge
          tone="accent"
          title="Story settings: players see only the dialogue, so narration, transitions, scene headings and parentheticals are left out here and in every export"
        >
          players see dialogue only
        </Badge>
      )}
      <div className="row">
        <button
          className={`btn tiny ${voicesOn ? 'ok' : ''}`}
          aria-pressed={voicesOn}
          title="Read dialogue aloud: recorded clips, or each character's voice from Story settings"
          onClick={toggleVoices}
        >
          {voicesOn ? '🔊 Voices on' : '🔈 Voices off'}
        </button>
        {hasCueSounds && (
          <button
            className={`btn tiny ${cueSoundsOn ? 'ok' : ''}`}
            aria-pressed={cueSoundsOn}
            title="Play the music and sounds attached to the story's cues"
            onClick={toggleCueSounds}
          >
            {cueSoundsOn ? '♪ Music & sounds on' : '♪ Music & sounds off'}
          </button>
        )}
        {languages.length > 0 && (
          <select
            className="input small language-pick"
            value={lang}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Language"
            title="Show the story in a translation brought in on the Export page"
          >
            <option value="">As written</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </select>
        )}
        <button
          className={`btn tiny ${dialogueOnly ? 'ok' : ''}`}
          aria-pressed={dialogueOnly}
          title="Show only dialogue (D)"
          onClick={() => onDialogueOnly(!dialogueOnly)}
        >
          {dialogueOnly ? 'dialogue only' : 'all text'}
        </button>
        <button
          className={`btn tiny ${showGated ? 'ok' : ''}`}
          aria-pressed={showGated}
          title="Also show choices that need an item or value you don't have yet, and what they need (G)"
          onClick={() => onShowGated(!showGated)}
        >
          {showGated ? '🔒 locked shown' : '🔒 locked hidden'}
        </button>
        <button className="btn tiny" onClick={undo} disabled={!canUndo}>
          ↶ Undo choice
        </button>
        <button className="btn tiny" onClick={restart}>
          Restart
        </button>
        {chosenCount > 0 && (
          <button
            className="btn tiny"
            onClick={forgetChosen}
            title="Choices you’ve taken before are greyed out, as players see them. This forgets them, so every choice looks new again."
          >
            Forget chosen ({chosenCount})
          </button>
        )}
      </div>
    </div>
  );
}
