import { buildStory } from '../src/core/builder';

/** Builds a story from one script, as the tests do everywhere. */
export const build = async (text: string, fileName = 'x.fountain', mode: 'faithful' | 'adaptation' | 'structured' = 'faithful') =>
  buildStory([{ fileName, text }], { mode });
