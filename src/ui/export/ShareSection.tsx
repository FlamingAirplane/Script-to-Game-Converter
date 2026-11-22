// The engine-only Ink runtime (~125 KB), embedded in playable-story exports.
import inkRuntime from '../../../node_modules/inkjs/dist/ink.js?raw';
import { useState } from 'react';
import {
  buildPlayableHtml,
  buildRecordingScript,
  buildRenpy,
  renpyFileName,
  recordingScriptFileName,
  buildTwee,
  ExportBlockedError,
  playableFileName,
  twineFileName,
  type TwineKind,
} from '../../core/export';
import { translationSheet } from '../../core/export/translations';
import { normaliseUnityTheme, panelThemeOf } from '../../core/export/unityTheme';
import { referencedAudio } from '../../core/audio';
import { referencedImages } from '../../core/images';
import { fileBase } from '../../core/isr';
import type { ProcessedStory } from '../../core/pipeline';
import { collectClips } from '../audioStore';
import { renderClips } from '../audioRender';
import { download } from '../common';
import type { StoryProject } from '../../core/isr';
import type { Update } from '../projectOps';
import { RecordingsImport } from '../RecordingsImport';
import { PLAY_PREFIX, storyLink } from '../storyLink';

import { ReaderNotesIn } from './ReaderNotesIn';
import { TranslationsIn } from './TranslationsIn';
import { languageList } from './helpers';

/** Exports that need no game engine (or a ready-made one): a playable web page for readers, a Twine project, a Ren'Py script. */
export function ShareSection({ processed, stale, project, update }: { processed: ProcessedStory; stale: boolean; project: StoryProject; update: Update }) {
  const [error, setError] = useState('');
  const [twineKind, setTwineKind] = useState<TwineKind>('sugarcube');
  // A copy for feedback: readers get a Note button, and send their notes back as a file.
  const [feedback, setFeedback] = useState(false);
  const [playLink, setPlayLink] = useState<{ url?: string; note?: string }>({});
  const [languages, setLanguages] = useState('');
  const blocked = processed.diagnostics.some((d) => d.exportBlocked) || stale;
  const run = async (fn: () => void | Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ExportBlockedError ? e.message : String(e));
    }
  };
  return (
    <>
      <h2 className="section-title">Share without a game engine</h2>
      <section className="share-grid">
        <div className="card share-card">
          <h2>Playable story</h2>
          <p className="muted small">
            One web page anyone can open to read and play your story, on a computer or phone. Send it by email or put it online. Readers' progress is saved in
            their browser.
          </p>
          <button
            className="btn primary"
            disabled={blocked}
            onClick={() =>
              run(async () => {
                const audio = await renderClips(referencedAudio(processed.project));
                const images = await collectClips(referencedImages(processed.project));
                download(playableFileName(processed), buildPlayableHtml(processed, inkRuntime, audio, images, { feedback }), 'text/html');
              })
            }
          >
            Download playable story (.html)
          </button>{' '}
          <button
            className="btn"
            disabled={blocked}
            title="The same story as a .zip with an index.html, the way itch.io and similar game sites take an HTML game"
            onClick={() =>
              run(async () => {
                const audio = await renderClips(referencedAudio(processed.project));
                const images = await collectClips(referencedImages(processed.project));
                const { default: JSZip } = await import('jszip');
                const zip = new JSZip();
                zip.file('index.html', buildPlayableHtml(processed, inkRuntime, audio, images, { feedback }));
                const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
                download(playableFileName(processed).replace(/\.html$/, '-web.zip'), bytes, 'application/zip');
              })
            }
          >
            For itch.io (.zip)
          </button>
          <p className="muted small">
            To publish it as a game: on{' '}
            <a href="https://itch.io/game/new" target="_blank" rel="noopener noreferrer">
              itch.io
            </a>
            , make a new project, set its kind to <em>HTML</em>, upload the .zip and tick <em>This file will be played in the browser</em>. Any web host works
            the same way.
          </p>
          <label className="check small feedback-check">
            <input type="checkbox" checked={feedback} onChange={(e) => setFeedback(e.target.checked)} /> For feedback: readers can leave notes as they read, and
            download them to send back to you
          </label>
          <details className="feedback-more">
            <summary className="small">Share for feedback with a link, or bring readers' notes in</summary>
            <p className="muted small">
              A play link opens just the story, with notes on, in any browser: nothing to download. The story is inside the link (after the #), so it isn't
              uploaded anywhere, but anyone with the link can read it. Pictures and recordings aren't included.
            </p>
            <button
              className="btn"
              disabled={blocked}
              onClick={() =>
                run(async () => {
                  const r = await storyLink(processed.project, location.href, PLAY_PREFIX);
                  if ('error' in r) return setPlayLink({ note: r.error });
                  try {
                    await navigator.clipboard.writeText(r.url);
                    setPlayLink({ url: r.url, note: 'Play link copied. Paste it into a message to your readers.' });
                  } catch {
                    setPlayLink({ url: r.url, note: 'Copy the play link below.' });
                  }
                })
              }
            >
              Copy a play link
            </button>
            {playLink.note && (
              <p className="small note-text" role="status">
                {playLink.note}
              </p>
            )}
            {playLink.url && (
              <input className="input mono small story-link" readOnly value={playLink.url} onFocus={(e) => e.target.select()} aria-label="Play link" />
            )}
            <ReaderNotesIn update={update} />
          </details>
        </div>
        <div className="card share-card">
          <h2>Recording script</h2>
          <p className="muted small">
            Every line of dialogue in story order, by character, with the file name each recording should be saved as. Opens in Excel, Numbers or Google Sheets,
            ready for a voice session.
          </p>
          <button
            className="btn"
            disabled={stale}
            onClick={() => run(() => download(recordingScriptFileName(processed.project), buildRecordingScript(processed.project), 'text/csv'))}
          >
            Download recording script (.csv)
          </button>
          <RecordingsImport project={project} update={update} />
        </div>
        <div className="card share-card">
          <h2>Translation sheet</h2>
          <p className="muted small">
            Every line, choice, name and button the player sees, one per row, for translators: add a column per language (for example <code>fr</code> or{' '}
            <code>de</code>) and fill it in. The Unity and Unreal exports show the story in any language the sheet has.
          </p>
          <label className="field">
            <span className="muted small">Language columns to start with (optional)</span>
            <input
              className="input mono"
              value={languages}
              placeholder="e.g. fr, de"
              onChange={(e) => setLanguages(e.target.value)}
              aria-label="Language columns to start with"
            />
          </label>
          <button
            className="btn"
            disabled={stale}
            onClick={() =>
              run(() =>
                download(
                  `${fileBase(processed.project)}-translations.csv`,
                  translationSheet(processed.project, normaliseUnityTheme(panelThemeOf(processed.project)), languageList(languages)),
                  'text/csv',
                ),
              )
            }
          >
            Download translation sheet (.csv)
          </button>
          <TranslationsIn project={project} update={update} />
        </div>
        <div className="card share-card">
          <h2>Twine</h2>
          <p className="muted small">
            A Twine project to keep editing the story visually. In Twine 2, choose <em>Library → Import</em> and pick the file.
          </p>
          <fieldset className="twine-kind">
            <legend className="muted small">What to include</legend>
            <label>
              <input type="radio" name="twine-kind" checked={twineKind === 'sugarcube'} onChange={() => setTwineKind('sugarcube')} />
              <span>
                <strong>Story and game logic</strong>
                <span className="muted small">Choices that need items, effects and a book style, for the SugarCube format.</span>
              </span>
            </label>
            <label>
              <input type="radio" name="twine-kind" checked={twineKind === 'plain'} onChange={() => setTwineKind('plain')} />
              <span>
                <strong>Story only</strong>
                <span className="muted small">
                  Just passages, their text and links. Nothing added, so it works in any Twine format; every choice is always shown.
                </span>
              </span>
            </label>
          </fieldset>
          <button className="btn" disabled={blocked} onClick={() => run(() => download(twineFileName(processed, twineKind), buildTwee(processed, twineKind)))}>
            Download for Twine (.twee)
          </button>
        </div>
        <div className="card share-card">
          <h2>Ren’Py</h2>
          <p className="muted small">
            The story as a visual novel for{' '}
            <a href="https://www.renpy.org" target="_blank" rel="noopener noreferrer">
              Ren’Py
            </a>
            , the free engine for dialogue-heavy games: characters, choices, items and endings. Make a project in the Ren’Py launcher, put this file in its{' '}
            <code>game</code> folder, delete the <code>script.rpy</code> the launcher made, and launch it. Add pictures and music there.
          </p>
          <button className="btn" disabled={blocked} onClick={() => run(() => download(renpyFileName(processed), buildRenpy(processed)))}>
            Download for Ren’Py (.rpy)
          </button>
          <p className="muted small">Checked against the story here; not yet opened in Ren’Py itself.</p>
        </div>
      </section>
      {blocked && !stale && <p className="error-text small">Fix the items marked “must fix” in Diagnostics to enable these downloads.</p>}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}
