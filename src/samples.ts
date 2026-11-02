import type { ConversionMode } from './core/isr';

export interface Sample {
  id: string;
  name: string;
  fileName: string;
  mode: ConversionMode;
  blurb: string;
  text: string;
}

const LIGHTHOUSE = `Title: The Lighthouse Keeper
Author: Narrative Bridge Samples
Draft date: 2026-11-02

FADE IN:

EXT. CLIFF PATH - NIGHT

Rain lashes the rocks. MIRA (30s, oilskin coat, lantern) climbs toward a dark LIGHTHOUSE.

MIRA
(shouting over the wind)
Tomas! The lamp is out!

No answer. Only the sea.

INT. KEEPER'S COTTAGE - NIGHT

A table set for one. The fire has burned to embers. Mira picks up the brass key from the mantel.

MIRA
He never leaves without this.

[[Consider a flashback here.]]

EXT. LIGHTHOUSE BASE - NIGHT

Waves break over the steps. The tower door groans open on its own. Somewhere above, metal bangs against metal.

INT. LIGHTHOUSE STAIRWELL - NIGHT

The iron door at the top is shut. Mira unlocks the door with the brass key.

TOMAS (O.S.)
Who's there?

CUT TO:

INT. LAMP ROOM - NIGHT

TOMAS (60s) sits beside the shattered lens, bleeding but alive.

TOMAS
The *storm* took the lens. Ships are coming in blind.

MIRA
Then we light it by hand.

She raises her lantern to the window. Far below, a ship turns away from the rocks.

FADE OUT.
`;

const ARCHIVE = `# The Locked Archive

@item archive_key "Archive Key"
@var curiosity = 0

## Archive Entrance {#archive_entry}

Rows of shelves vanish into the dark. A steel door blocks the inner vault.

**MIRA:** The archive is locked.

+ {has archive_key} [Open the archive] -> archive_inside @take archive_key
+ [Search the reading room] -> find_key
+ [Leave] -> outside

## Reading Room {#find_key}

Dust motes drift over a long oak table.

@add curiosity 1

+ {not has archive_key} [Lift the loose floorboard] -> found_key
+ [Return to the entrance] -> archive_entry

## Under the Floorboard {#found_key}

Wrapped in oilcloth: a heavy iron key.

@give archive_key

-> find_key

## The Vault {#archive_inside}

The archive door opens. Inside, a single ledger glows faintly.

**MIRA:** Every story we ever lost.

-> END

## Outside {#outside}

You step back into the rain. Some doors are better left closed.

-> END
`;

const MOTEL = `INT. ROADSIDE MOTEL - NIGHT

A neon sign buzzes. JUNE (20s) drops her bag on the bed.

JUNE
Three hundred miles and nobody followed.

The phone rings. She stares at it.

INT. MOTEL OFFICE - NIGHT

The CLERK (70s) watches a muted television.

CLERK
Call for room six. Said you'd know who.

JUNE
I don't.

EXT. PARKING LOT - DAWN

June loads the car. A second car idles across the lot, headlights on.

JUNE
(to herself)
Okay. Okay.

She pulls out onto the highway.
`;

export const SAMPLES: Sample[] = [
  {
    id: 'archive',
    name: 'The Locked Archive',
    fileName: 'locked_archive.md',
    mode: 'structured',
    blurb: 'Structured Markdown with passages, a key item, a counter and two endings.',
    text: ARCHIVE,
  },
  {
    id: 'lighthouse',
    name: 'The Lighthouse Keeper',
    fileName: 'lighthouse.fountain',
    mode: 'adaptation',
    blurb: 'A linear Fountain screenplay. Adaptation mode proposes an optional key pickup and a gated door.',
    text: LIGHTHOUSE,
  },
  {
    id: 'motel',
    name: 'Room Six',
    fileName: 'room_six.txt',
    mode: 'faithful',
    blurb: 'Plain-text screenplay converted faithfully: scenes in order, nothing invented.',
    text: MOTEL,
  },
];
