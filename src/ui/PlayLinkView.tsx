import { useEffect, useState } from 'react';
import { ExportBlockedError } from '../core/export/common';
import { buildPlayableHtml } from '../core/export/playable';
import type { StoryProject } from '../core/isr';
import { processProject } from '../core/pipeline';
import { validateSchema } from '../core/schema';
import inkRuntime from '../../node_modules/inkjs/dist/ink.js?raw';
import { PLAY_PREFIX, readStoryLink } from './storyLink';

/**
 * A play link (#play=…): the story as its readers see it, with a Note button for feedback, filling the page. Nothing
 * of the writing app opens, and this browser's own projects are left alone. Notes stay in this browser until the
 * reader downloads them for the writer (see readerNotes.ts).
 */
export function PlayLinkView({ hash }: { hash: string }) {
  const [state, setState] = useState<{ html?: string; title?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const text = await readStoryLink(hash, PLAY_PREFIX);
        const data = JSON.parse(text ?? 'null');
        const project: StoryProject | undefined = data?.project;
        if (!project || validateSchema(project).some((d) => d.severity === 'error')) throw new Error('not a story');
        const story = processProject(project);
        const html = buildPlayableHtml(story, inkRuntime, {}, {}, { feedback: true });
        if (live) setState({ html, title: project.project.title });
      } catch (e) {
        const blocked = e instanceof ExportBlockedError;
        if (live)
          setState({
            error: blocked
              ? 'This story can’t be played yet: it has problems its writer needs to fix first.'
              : 'This link couldn’t be read. It may have been cut short when it was copied: ask for the whole link again.',
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [hash]);

  useEffect(() => {
    if (state.title) document.title = state.title;
  }, [state.title]);

  if (state.error)
    return (
      <div className="play-link-status" role="alert">
        <p>{state.error}</p>
        <p>
          <a href={location.pathname}>Open Narrative Bridge</a>
        </p>
      </div>
    );
  if (!state.html) return <p className="play-link-status">Opening the story…</p>;
  return <iframe className="play-link-frame" title={state.title ?? 'Story'} srcDoc={state.html} />;
}
