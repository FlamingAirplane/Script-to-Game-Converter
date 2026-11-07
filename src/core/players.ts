import type { ContentBlock, StoryProject } from './isr';

// "Players see only the dialogue" (presentation.dialogueOnly, in Review → Story settings): the story as players get
// it, in every reader (Playtest, the playable page, Twine, Unity, Unreal). Narration, transitions, scene headings and
// parentheticals are left out; they become notes, so the Ink keeps them as comments for the developer. Choices,
// pictures, cues, effects and exits to the game stay. A Continue break with nothing shown before it is dropped, so
// the player never meets a Continue button on an empty page.

export const HIDDEN_NOTE = 'Players don’t see this:';

export function dialogueOnly(project: Pick<StoryProject, 'presentation'>): boolean {
  return project.presentation?.dialogueOnly === true;
}

/** The story as players get it: unchanged unless dialogueOnly is on. */
export function forPlayers(project: StoryProject): StoryProject {
  if (!dialogueOnly(project)) return project;
  return {
    ...project,
    passages: project.passages.map((p) => {
      const content: ContentBlock[] = [];
      if (p.sceneHeading) content.push({ type: 'note', text: `${HIDDEN_NOTE} ${p.sceneHeading}`, origin: p.origin });
      let shown = false;
      for (const b of p.content) {
        if (b.type === 'action' || b.type === 'transition') {
          content.push({ type: 'note', text: `${HIDDEN_NOTE} ${b.text}`, origin: b.origin, source: b.source });
        } else if (b.type === 'dialogue') {
          shown = true;
          const { parenthetical: _hidden, ...line } = b;
          content.push(line);
        } else if (b.type === 'pause') {
          if (shown) content.push(b);
          shown = false;
        } else {
          if (b.type === 'exit') shown = false;
          content.push(b);
        }
      }
      return { ...p, sceneHeading: undefined, content };
    }),
  };
}
