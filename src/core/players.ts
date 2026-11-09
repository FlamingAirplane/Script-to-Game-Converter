import type { ContentBlock, Passage, StoryProject } from './isr';

// The story as players get it, in every reader (Playtest, the playable page, Twine, Unity, Unreal):
//  - "Players see only the dialogue" (presentation.dialogueOnly, in Review → Story settings) applies to every passage;
//  - a cutscene (Passage.cutscene, Review → the passage's "Cutscene" box, or @cutscene in a script) to its own.
// In those, narration, transitions, scene headings and parentheticals are left out; they become notes, so the Ink
// keeps them as comments for the developer. Choices, pictures, cues, effects and exits to the game stay.
// A Continue break with nothing shown before it is dropped, so the player never meets a Continue button on an empty
// page; in a cutscene every Continue break is dropped, since a cutscene goes on by itself. (Its lines carry
// #cutscene in the Ink, and readers show them one at a time; see inkgen.ts.)

export const HIDDEN_NOTE = 'Players don’t see this:';

export function dialogueOnly(project: Pick<StoryProject, 'presentation'>): boolean {
  return project.presentation?.dialogueOnly === true;
}

/** Seconds a cutscene line stays before the next: time to read it, at least 2 and at most 9. */
export function cutsceneSeconds(text: string): number {
  return Math.min(9, Math.max(2, 1.2 + text.length * 0.055));
}

function onlyDialogue(p: Passage): Passage {
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
      if (shown && !p.cutscene) content.push(b);
      shown = false;
    } else {
      if (b.type === 'exit') shown = false;
      content.push(b);
    }
  }
  return { ...p, sceneHeading: undefined, content };
}

/** The story as players get it: unchanged unless players see only the dialogue, or it has cutscenes. */
export function forPlayers(project: StoryProject): StoryProject {
  const all = dialogueOnly(project);
  if (!all && !project.passages.some((p) => p.cutscene)) return project;
  return { ...project, passages: project.passages.map((p) => (all || p.cutscene ? onlyDialogue(p) : p)) };
}
