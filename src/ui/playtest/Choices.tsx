import { CONTINUE_TEXT, exitOf } from '../../core/isr';
import type { LockedChoice } from '../../core/gating';
import type { SceneRequest } from '../NewScene';
import { Rich } from '../Rich';
import type { OfferedChoice } from './state';

/** What the reader can do next: the choices on offer, an exit to the game, locked choices, Play again, Add a scene. */
export function Choices({
  choices,
  playing,
  ended,
  chosenBefore,
  locked,
  T,
  exitNote,
  choose,
  skipCutscene,
  restart,
  canAddScene,
  lastWhere,
  onNewScene,
}: {
  choices: OfferedChoice[];
  /** A cutscene is playing: only Skip is offered. */
  playing: boolean;
  ended: boolean;
  chosenBefore: Set<string>;
  locked: LockedChoice[];
  T: (text: string) => string;
  exitNote: (name: string) => string | undefined;
  choose: (index: number, text: string) => void;
  skipCutscene: () => void;
  restart: () => void;
  /** The last passage read is still in the story, so a scene can be added after it. */
  canAddScene: boolean;
  lastWhere: string;
  onNewScene?: (r: SceneRequest) => void;
}) {
  return (
    <div className="choices">
      {playing ? (
        <button className="choice-btn continue cutscene-skip" onClick={skipCutscene} title="Show the rest of the cutscene now (1)">
          🎬 Cutscene · Skip
        </button>
      ) : choices.length === 1 && exitOf(choices[0].text) ? (
        // An exit to the game: in the game, gameplay happens here until it resumes the story.
        <div className="game-exit" role="group" aria-label="Exit to the game">
          <p>
            <strong>⇥ The game takes over here</strong> <code>{exitOf(choices[0].text)}</code>
          </p>
          {exitNote(exitOf(choices[0].text)!) && <p className="muted small">{exitNote(exitOf(choices[0].text)!)}</p>}
          <p className="muted small">In the game, the dialogue stops and the player plays until the game resumes the story. Here, resume it yourself.</p>
          <button className="choice-btn continue" onClick={() => choose(choices[0].index, choices[0].text)}>
            Resume the story
          </button>
        </div>
      ) : (
        choices.map((c, n) => {
          const goOn = choices.length === 1 && c.text === CONTINUE_TEXT;
          const before = !goOn && (chosenBefore.has(c.key) || chosenBefore.has(c.legacy));
          return (
            <button
              key={c.index}
              className={`choice-btn${goOn ? ' continue' : ''}${before ? ' chosen' : ''}`}
              onClick={() => choose(c.index, c.text)}
              title={
                before ? `You’ve chosen this before${n < 9 ? ` (${n + 1})` : ''}` : goOn ? 'Go on (Enter, Space or 1)' : n < 9 ? `Press ${n + 1}` : undefined
              }
            >
              {!goOn && choices.length > 1 && n < 9 && (
                <kbd className="choice-key" aria-hidden="true">
                  {n + 1}
                </kbd>
              )}
              <Rich text={T(c.text)} />
              {before && <span className="sr-only"> (chosen before)</span>}
            </button>
          );
        })
      )}
      {!playing &&
        locked.map((l) => (
          <p key={l.choiceId} className="choice-btn locked" aria-disabled="true">
            <span className="locked-text">
              <Rich text={T(l.text)} />
            </span>
            <span className="locked-needs">needs {l.needs.map(T).join(', ')}</span>
          </p>
        ))}
      {ended && (
        <button className="choice-btn" onClick={restart}>
          Play again
        </button>
      )}
      {ended && onNewScene && canAddScene && (
        <button
          className="btn small playtest-add-scene"
          onClick={() => onNewScene({ from: lastWhere, link: 'continue' })}
          title="Add a scene the story goes on into from here, or a choice that leads to one"
        >
          + Add a scene here
        </button>
      )}
    </div>
  );
}
