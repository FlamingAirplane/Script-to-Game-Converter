import type { StoryProject } from '../core/isr';
import { errorData, log } from '../core/log';
import { sweepMedia } from './audioStore';
import { draftProjects } from './draftStore';
import { projectMediaRefs } from './projectFile';

// Voice clips, pictures, session recordings and original files are stored in this browser by id (audioStore.ts) and
// nothing deleted them, so storage only grew. On start-up this deletes the ones no project here uses any more: not the
// autosaved story, not any draft. To be safe it runs only when no other tab of the app is open (another tab's story
// may not be autosaved yet), and never touches files stored in the last day (see MEDIA_GRACE_MS).

const logger = log('audio');

/** Held shared by every open tab of the app; the sweep needs it exclusively. */
const APP_LOCK = 'pen-to-ink-app';

/** Every stored file these projects need, including the sessions their regions play from. */
export function mediaInUse(projects: StoryProject[]): Set<string> {
  const ids = new Set<string>();
  for (const p of projects) {
    for (const r of projectMediaRefs(p)) ids.add(r.id);
    for (const passage of p.passages)
      for (const b of passage.content) if ((b.type === 'dialogue' || b.type === 'cue') && b.audio?.from) ids.add(b.audio.from.session);
  }
  return ids;
}

/**
 * Sweeps unused media once, if this is the only tab, then holds the app's lock (shared) for as long as the tab is open.
 * `autosaved` is the story this browser has kept, as read on start-up; null when that read failed, which skips the
 * sweep (its files can't be told apart from unused ones) but still marks this tab as open.
 */
export async function sweepUnusedMediaOnce(autosaved: (StoryProject | null | undefined)[] | null): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return; // without locks there's no telling whether another tab is open: keep everything
  if (autosaved) {
    try {
      await locks.request(APP_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) return logger.debug('Media sweep skipped: the app is open in another tab');
        const projects = [...autosaved.filter((p): p is StoryProject => !!p), ...(await draftProjects())];
        const { deleted, kept } = await sweepMedia(mediaInUse(projects));
        if (deleted) logger.info('Removed media no story uses any more', { deleted, kept });
      });
    } catch (e) {
      logger.warn('Media sweep failed; nothing was removed after the error', errorData(e));
    }
  }
  // From now on, other tabs know this one is open.
  void locks.request(APP_LOCK, { mode: 'shared' }, () => new Promise<void>(() => {}));
}
