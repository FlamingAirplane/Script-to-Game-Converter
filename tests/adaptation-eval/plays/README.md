# Public-domain play excerpts

Scene-length excerpts from sixteen plays, cut from Project Gutenberg's plain-text editions and converted to Fountain
by `scripts/play-excerpts.mjs`. They are the bulk of the adaptation evaluation set (see `../README.md`).

| File | Excerpt | Author | Translator | Language | Gutenberg ebook | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| `dolls-house.fountain` | A Doll's House, Act 1 (opening) | Henrik Ibsen | R. Farquharson Sharp | en | [2542](https://www.gutenberg.org/ebooks/2542) | 88–200 |
| `earnest.fountain` | The Importance of Being Earnest, Act 1 (the cigarette case) | Oscar Wilde | — | en | [844](https://www.gutenberg.org/ebooks/844) | 296–400 |
| `pygmalion.fountain` | Pygmalion, Act 2 (Doolittle) | Bernard Shaw | — | en | [3825](https://www.gutenberg.org/ebooks/3825) | 1459–1690 |
| `hedda-gabler.fountain` | Hedda Gabler, Act 3 (the manuscript) | Henrik Ibsen | William Archer | en | [4093](https://www.gutenberg.org/ebooks/4093) | 7900–8080 |
| `trifles.fountain` | Trifles (the bird-cage) | Susan Glaspell | — | en | [10623](https://www.gutenberg.org/ebooks/10623) | 440–640 |
| `riders-to-the-sea.fountain` | Riders to the Sea (the bundle) | J. M. Synge | — | en | [994](https://www.gutenberg.org/ebooks/994) | 165–260 |
| `arms-and-the-man.fountain` | Arms and the Man, Act 1 (the fugitive) | Bernard Shaw | — | en | [3618](https://www.gutenberg.org/ebooks/3618) | 440–600 |
| `macbeth.fountain` | Macbeth, Act 2 scenes 1 and 2 (the daggers) | William Shakespeare | — | en | [1533](https://www.gutenberg.org/ebooks/1533) | 1060–1262 |
| `uncle-vanya.fountain` | Uncle Vanya, Act 4 (the morphine) | Anton Chekhov | Marian Fell | en | [1756](https://www.gutenberg.org/ebooks/1756) | 1930–2010 |
| `sea-gull.fountain` | The Sea-Gull, Act 2 (the dead gull) | Anton Chekhov | Marian Fell | en | [1754](https://www.gutenberg.org/ebooks/1754) | 1095–1160 |
| `the-bear.fountain` | The Bear (the duel) | Anton Chekhov | Julius West | en | [7986](https://www.gutenberg.org/ebooks/7986) | 2940–3040 |
| `lady-windermere.fountain` | Lady Windermere's Fan, Act 1 (the bank book) | Oscar Wilde | — | en | [790](https://www.gutenberg.org/ebooks/790) | 664–760 |
| `l-avare.fountain` | L'Avare, acte 4 scènes 6 et 7 (la cassette) | Molière | — | fr | [6318](https://www.gutenberg.org/ebooks/6318) | 5305–5412 |
| `hamlet.fountain` | Hamlet, Act 5 scene 2 (the foils and the cup) | William Shakespeare | — | en | [1524](https://www.gutenberg.org/ebooks/1524) | 6341–6470 |
| `ideal-husband.fountain` | An Ideal Husband, Act 1 (the brooch) | Oscar Wilde | — | en | [885](https://www.gutenberg.org/ebooks/885) | 1180–1232 |
| `playboy.fountain` | The Playboy of the Western World, Act 2 (the looking-glass) | J. M. Synge | — | en | [1240](https://www.gutenberg.org/ebooks/1240) | 1160–1300 |

## Rights

Every text is in the public domain in the United States, which is the basis on which Project Gutenberg publishes it.
The authors died between 1616 and 1950 and the translations were first published before 1929. Elsewhere the term can
differ: Bernard Shaw (died 1950) and Susan Glaspell (died 1948) are the latest, and are public domain in countries
with a term of life plus 70 years. Only the text of the plays is used; Project Gutenberg's own header, licence and
trademark are not reproduced, as its licence asks of copies that drop its name.

## How the excerpts are made

`sources.json` lists each excerpt: the ebook number, the line range in that ebook's plain text, the setting used for
scene headings, and `continuation` for editions where a speech goes on after a stage direction (verse and the French
text). To regenerate, or to add a play:

```bash
node scripts/play-excerpts.mjs
```

The script downloads any ebook it does not have into the system temp folder (`--cache <dir>` to choose) and rewrites
the `.fountain` files here. The conversion is mechanical:

- A play's act is one long scene, and a suggested choice goes at the end of a passage, so each excerpt is cut into
  short scenes: at the play's own scene headings, where someone enters or leaves, and otherwise every six speeches.
  The numbered headings ("INT. MORNING ROOM 3 - DAY") are the converter's, not the playwright's.
- Stage directions inside a speech become action lines of their own, placed after the speech. That makes
  "takes the letter" a line a suggester can cite, at the cost of order within a speech.
- Nothing is rewritten. Emphasis marks, footnote numbers and brackets are dropped.

If a line range changes, the scenes move, so re-check that play's annotation file (`../play-<id>.json`) against
`npm run eval:adapt -- --dump`.
