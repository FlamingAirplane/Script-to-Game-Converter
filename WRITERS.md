# Narrative Bridge for writers

Turn your script into a playable, interactive story, with nothing to install.

This page is the short version. The [full user guide](https://github.com/FlamingAirplane/Script-to-Game-Converter/blob/main/docs/USER_GUIDE.md) explains every screen, with pictures.

## Getting started

1. Get the file **`Narrative-Bridge.html`** from whoever sent you this, and save it somewhere easy, such as your Documents folder.
2. **Double-click it.** It opens in your web browser (Safari, Chrome, Edge or Firefox).
3. Follow the four steps on the first screen.

That's it. It works without an internet connection, and your scripts are never uploaded anywhere.

## What to bring

- A **Final Draft** script (`.fdx`), or
- A **Word** document (`.docx`). Screenplays that use Word's screenplay styles keep their scene headings, characters and
  dialogue; other documents become one passage per heading, or
- A **PDF** (`.pdf`). A screenplay in standard layout keeps its scene headings, characters, dialogue and transitions
  (page numbers and MORE / CONT'D are tidied away); a novel or story becomes one passage per chapter heading, or
- A **Fountain** screenplay (`.fountain`) or a **plain-text** export (`.txt`), or
- A **Markdown** file (`.md`), or just paste your text in.

Scanned PDFs (pictures of pages) and old `.doc` files can't be read. Export the script from your writing app, or save as
`.docx`, instead. If you have both, an `.fdx` or `.docx` is more exact than a PDF. Bold, italics and fonts aren't kept;
all of your words are.

## Hearing your dialogue

- **Voices:** in *Review → Story settings*, give each character a voice, speed and pitch, then press ▷ to hear it. In
  *Playtest*, switch **Voices on** to have every line read aloud as you play.
- **Recordings:** next to any line of dialogue, press **●** to record it with your microphone, or **♪** to attach an
  audio file (WAV, MP3, OGG; other formats are converted). Press ▶ to play it back. A line with a recording uses the
  recording instead of the voice.
- Recordings go along with every export: the playable story and the Unity and Unreal
  packages. **Save project** keeps them inside the project file too.

## Keeping your work

Your project is remembered in the browser you used. To keep a copy you can reopen on another computer or send to someone,
click **Save project** (top right). This downloads a `.nbproj.json` file. Use **Open project** to load it again.

If you clear your browser history or use a private window, the remembered copy is lost, so save a project file you want to keep.
The top of the page says *kept in this browser* while autosave works, and warns you if the browser runs out of room.

**Drafts.** Before a big rewrite, open **Story settings** (top of the Review list), name a draft and click **Keep a draft**.
**Restore** brings it back, and the undo button takes you back again if you change your mind. Converting a new script
keeps the old story as a draft automatically; find it on the Import page under *Or pick up earlier work*.

**At a glance** (also in Story settings) shows the word count, reading time, choices, endings, and how many lines each
character speaks, which helps when you plan a voice recording session.

**Using the website offline.** After you have opened the website once, it also opens without an internet connection.
Your browser may offer to install it as an app (in Chrome or Edge, the install icon in the address bar; on iPhone or iPad,
Share → *Add to Home Screen*).

## Sharing your story

In the **Export** tab, under *Share without a game engine*:

- **Download playable story** gives you one web page. Anyone can open it on a computer or phone to read and play your
  story, with no installs. Email it, or put it on any website. If you fix something and send a new copy, readers keep
  their place: the page finds where they were in the new version (or the nearest point, if you cut that choice).
- **Download for Twine** gives you a file to open in [Twine](https://twinery.org) (Library → Import), if you'd like to
  keep editing the story there.

## Handing off to a developer

In the **Export** tab, choose Unity or Unreal, click **Build package**, then **Download .zip**. Send that one zip file to whoever is
building the game. It includes your story, your original script and instructions for them.

## Shortcuts

Press **?** anywhere to see every keyboard shortcut. The handy ones: ⌘S (Ctrl+S on Windows) saves your project,
⌘F finds text, and in Playtest the number keys pick a choice and Backspace undoes it.

## Troubleshooting

- **The file opens as text or code instead of the app.** Right-click it → *Open With* → your web browser.
- **Nothing appears.** Try a different browser, and make sure the whole file downloaded (it's about 3 MB).
- **Reporting a problem:** press ⌘L (Ctrl+L on Windows) to open the **Logbook**, click **download**, and attach
  the file to your report. It records what the app did, never your story's text.
- **Something in Diagnostics is red.** Click it. It takes you to the scene that needs fixing and explains what to do. Red
  items stop the export; yellow and purple ones are suggestions.
