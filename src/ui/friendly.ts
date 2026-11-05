import type { Diagnostic, Severity } from '../core/diagnostics';
import type { StoryProject } from '../core/isr';
import { passageForEntity } from './projectOps';

// Plain-language wording for diagnostics, for writers. The technical message, code and stage stay
// available behind "details"; this only decides what is said first.

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'must fix',
  review: 'needs your OK',
  warning: 'worth a look',
  info: 'note',
};

const TITLES: Record<string, string> = {
  INK_TARGET_MISSING: 'A choice leads to a passage that doesn’t exist.',
  CHOICE_NO_TARGET: 'A choice doesn’t lead anywhere yet.',
  CHOICE_TEXT_MISSING: 'A choice has no wording.',
  START_MISSING: 'The story has no valid first passage.',
  DUPLICATE_PASSAGE_ID: 'Two passages share the same ID.',
  INVALID_PASSAGE_ID: 'A passage ID uses characters that aren’t allowed.',
  UNREACHABLE_PASSAGE: 'Readers can never reach this passage.',
  NO_AVAILABLE_CHOICES: 'Readers get stuck here: there’s no choice and no next passage.',
  ALL_CHOICES_CONDITIONAL: 'Readers could get stuck here if every locked choice stays locked.',
  NO_REACHABLE_ENDING: 'The story never reaches an ending.',
  ITEM_UNDECLARED: 'Something uses an item that hasn’t been created.',
  VAR_UNDECLARED: 'Something uses a variable that hasn’t been created.',
  ITEM_NEVER_ACQUIRED: 'A choice needs an item the reader can never get.',
  CONDITION_TYPE_MISMATCH: 'A condition compares two things that don’t match.',
  CONDITION_BAD_OPERATOR: 'A condition uses a comparison that doesn’t work for this kind of value.',
  UNUSED_VARIABLE: 'A variable is created but never used.',
  UNUSED_ITEM: 'An item is created but never used.',
  EMPTY_PASSAGE: 'This passage has no text.',
  PAUSE_WITHOUT_TEXT: 'A Continue break has nothing to show on one side.',
  EXIT_NAME_REUSED: 'Two exits to the game share a name.',
  EXIT_THEN_END: 'The story ends right after an exit to the game.',
  IMAGE_WITHOUT_TEXT: "A scene picture won't show: the passage has no text.",
  MULTIPLE_DIVERTS: 'This passage says where to go next more than once.',
  UNAPPROVED_GENERATED: 'A suggestion is waiting for your OK.',
  UNSUPPORTED_CONSTRUCT: 'Part of your script couldn’t be converted, so it was kept as a note.',
  PARSE_AMBIGUOUS_CUE: 'We weren’t sure whether this line is a character’s name.',
  ITEM_AUTO_DECLARED: 'An item was created for you because the script uses it.',
  VAR_AUTO_DECLARED: 'A variable was created for you because the script uses it.',
  INPUT_FORMAT_SNIFFED: 'Your file’s format was recognised from its contents.',
  INPUT_CONVERTED: 'Your file was converted so Narrative Bridge can read it. All the words are kept.',
  INPUT_TOO_LARGE: 'This file is too large (over 5 MB).',
  INPUT_BINARY: 'This file isn’t plain text.',
  INPUT_ENCODING: 'Some characters in this file couldn’t be read.',
  INPUT_EMPTY: 'No story text was found.',
  INK_COMPILE_ERROR: 'The story couldn’t be built.',
  INK_COMPILE_WARNING: 'The story builder raised a warning.',
  RUNTIME_ERROR: 'Something went wrong while playing the story.',
  RUNTIME_NO_ENDING: 'Test playthroughs never reached an ending.',
  RUNTIME_UNVISITED: 'Test playthroughs never reached this passage.',
  RUNTIME_GATE_NEVER_OPEN: 'A locked choice never opened in test playthroughs.',
};

export interface FriendlyDiagnostic {
  title: string;
  /** The specific technical message, shown under the title when it adds information. */
  detail?: string;
  where?: string;
}

export function friendly(d: Diagnostic, project?: StoryProject): FriendlyDiagnostic {
  const title = TITLES[d.code] ?? d.message;
  const pid = project ? passageForEntity(project, d.entityId, d.details?.passageId) : undefined;
  const where = pid ? project!.passages.find((p) => p.id === pid)?.title : undefined;
  return { title, detail: title === d.message ? undefined : d.message, where };
}
