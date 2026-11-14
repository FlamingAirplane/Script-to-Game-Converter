# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: on GitHub, open the repository's
**Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what
someone could do with it. You'll get a reply within a week.

## What's in scope

- The web app at https://flamingairplane.github.io/Script-to-Game-Converter/ and the offline single-file edition.
- The files it exports: the playable web page, and the Unity and Unreal packages.
- The command-line tool, including the model files its `--suggest model` option downloads from Hugging Face.

## How the app handles your work

- Scripts are converted in the browser. They aren't sent anywhere unless the user chooses to move a project
  through their own private GitHub Gist, using their own GitHub token (kept in that browser only).
- The app asks GitHub's API for the latest release, and fetches the site's design from a public Gist. Neither
  request carries any of the user's writing.
- The command-line tool's `--suggest model` downloads a small language model from Hugging Face once and runs it on
  the user's machine; the script goes to that process and nowhere else. The model's output is treated as data: it
  names a line and a kind of choice, code builds the choice, and it stays pending until a person approves it.
- The exported playable page embeds the story as escaped data and writes text with `textContent`, so markup in a
  script is shown, not run.
- The design editor (`#admin`) is locked with a password stretched with PBKDF2, but its salt and hash ship in the
  public page. It's a lock against casual changes, not a vault: it only changes the look in the editor's own browser
  until the owner publishes a design with their GitHub token.

## Supported versions

Only the latest release, and the live site, get security fixes.
