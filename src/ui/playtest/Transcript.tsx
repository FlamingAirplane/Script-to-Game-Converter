import { Fragment, type RefObject } from 'react';
import { cuesIn, cueWantsSound } from '../../core/cues';
import { exitOf } from '../../core/isr';
import type { Line } from '../../core/reader';
import { Rich } from '../Rich';
import { isCutscene } from './state';

/** The story as read so far: lines, cues, choices taken, scene headings, pictures. */
export function Transcript({
  lines,
  visible,
  dialogueOnly,
  fresh,
  dropCapAt,
  playing,
  ended,
  hasSound,
  T,
  portraitOf,
  pictureFor,
  transcript,
  bottom,
}: {
  lines: Line[];
  /** How many lines show (a cutscene reveals its lines one at a time). */
  visible: number;
  dialogueOnly: boolean;
  /** A class that fades in the lines a choice just led to. */
  fresh: (i: number) => string;
  dropCapAt: number;
  /** A cutscene is playing. */
  playing: boolean;
  ended: boolean;
  /** Whether a cue's tag has a sound attached. */
  hasSound: (tag: string) => boolean;
  T: (text: string) => string;
  portraitOf: (l: Line) => { url: string } | null | undefined;
  pictureFor: (l: Line) => { url: string; alt: string } | null | undefined;
  transcript: RefObject<HTMLDivElement | null>;
  bottom: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="transcript" ref={transcript} tabIndex={0} aria-label="Story text">
      {lines.slice(0, visible).map((l, i) =>
        dialogueOnly && ((l.kind === 'text' && !l.speaker) || l.kind === 'cue') ? null : l.pause ? null : l.kind === 'cue' ? (
          <p key={i} data-at={i} className={`t-cue${fresh(i)}`} title="A cue for the game (Review → + Cue)">
            ♪ {l.text.replace(':', ': ')}
            {cuesIn(l.tags).some((c) => cueWantsSound(c.name, c.value) && !hasSound(c.tag)) ? ' · no sound attached' : ''}
          </p>
        ) : l.kind === 'choice' && exitOf(l.text) ? (
          <p key={i} data-at={i} className={`t-exit${fresh(i)}`}>
            ⇥ the game played here ({exitOf(l.text)}) ⇤
          </p>
        ) : l.kind === 'choice' ? (
          <p key={i} data-at={i} className={`t-choice${fresh(i)}`}>
            › <Rich text={T(l.text)} />
          </p>
        ) : l.speaker ? (
          <p
            key={i}
            data-at={i}
            className={`t-dialogue${fresh(i)}${portraitOf(l) ? ' with-portrait' : ''}${isCutscene(l) ? ' t-cutscene' : ''}${isCutscene(l) && i === visible - 1 && playing ? ' now' : ''}`}
          >
            {portraitOf(l) && <img className="t-portrait" src={portraitOf(l)!.url} alt="" />}
            <span className="t-speaker">{T(l.speaker)}</span>
            {l.tags.find((t) => t.startsWith('paren:')) && <span className="t-paren">({T(l.tags.find((t) => t.startsWith('paren:'))!.slice(6))})</span>}
            <span className="t-text">
              <Rich text={T(l.text)} />
            </span>
          </p>
        ) : (
          <Fragment key={i}>
            {l.tags.find((t) => t.startsWith('scene:')) && (
              <span data-at={i} className={`t-scene${fresh(i)}`}>
                {T(l.tags.find((t) => t.startsWith('scene:'))!.slice(6))}
              </span>
            )}
            {pictureFor(l) && (
              <figure data-at={i} className={`t-picture${fresh(i)}`}>
                <img src={pictureFor(l)!.url} alt={pictureFor(l)!.alt} />
              </figure>
            )}
            <p data-at={i} className={(l.tags.includes('transition') ? 't-transition' : `t-action${i === dropCapAt ? ' drop' : ''}`) + fresh(i)}>
              <Rich text={T(l.text)} />
            </p>
          </Fragment>
        ),
      )}
      {ended && <p className="t-end">— The End —</p>}
      <div ref={bottom} />
    </div>
  );
}
