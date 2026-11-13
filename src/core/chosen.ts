// Choices the player has taken before: every reader (Playtest, the playable page, Unity, Unreal) greys them out,
// still clickable, so a player coming back to a choice (on a later read, or a passage they loop back to) can see
// which ways they've already tried. A choice is known by its passage (Ink knot) and its text as written, so it
// survives Restart, and a translation or an unrelated edit elsewhere in the story doesn't lose it.
// Continue breaks and exits to the game aren't real choices, so they're never greyed out.

/** The knot a choice is offered in, from its Ink source path ("harbour.0.c-1" → "harbour"). */
export function knotOfPath(path: string): string {
  return path.split('.')[0] ?? '';
}

/** How a choice is remembered: "knot|text". */
export function chosenKey(sourcePath: string, text: string): string {
  return `${knotOfPath(sourcePath)}|${text.trim()}`;
}
