import type { SavedMode } from '../src/core/isr';
import { buildStory } from '../src/core/builder';

/** Builds a story from one script, as the tests do everywhere. */
export const build = async (text: string, fileName = 'x.fountain', mode: SavedMode = 'structured') =>
  buildStory([{ fileName, text }], { mode });
