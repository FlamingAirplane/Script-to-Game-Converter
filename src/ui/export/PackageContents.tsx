import { INK_COMPILER } from '../../core/version';
import { ADAPTERS, type EngineTarget } from '../../core/export';

const INKJS_VERSION = INK_COMPILER.version;

/** What a developer gets in the .zip, what they still do, and which versions it targets, in plain words. */
export function PackageContents({ engine, layout }: { engine: EngineTarget; layout: 'package' | 'project' }) {
  const a = ADAPTERS[engine];
  const unity = engine === 'unity';
  return (
    <details className="card package-contents" open>
      <summary>
        <h2>What your developer gets</h2>
      </summary>
      <div className="contents-grid">
        <div>
          <h3>In the .zip</h3>
          <ul className="small">
            <li>
              <strong>Your story in Ink</strong>, the scripting language for game stories (<code>.ink</code>), checked and compiled, ready to run.
            </li>
            {unity ? (
              <>
                <li>
                  {layout === 'package' ? (
                    <>
                      <strong>A Unity package</strong> they add to the game they already have: nothing in their project is replaced.
                    </>
                  ) : (
                    <>
                      <strong>A complete Unity project</strong> that opens to a demo scene, with the same package inside.
                    </>
                  )}
                </li>
                <li>
                  <strong>Ready-made code</strong> that plays the story: lines, choices, Continue breaks, exits to the game, saves, and items (C#).
                </li>
                <li>
                  <strong>A story panel</strong> styled with the Story UI settings below, which they can change in Unity.
                </li>
              </>
            ) : (
              <>
                <li>
                  <strong>An Unreal project</strong> with no code of its own: all the C++ is in one NarrativeBridge plugin (the same for every story), next to a
                  script that fetches the Inkpot plugin it uses.
                </li>
                <li>
                  <strong>Ready-made code</strong> that plays the story: lines, choices, Continue breaks, exits to the game, saves, items and translations (C++,
                  usable from Blueprints).
                </li>
                <li>
                  <strong>A story panel</strong> styled with the Story UI settings below, and tests that replay every ending.
                </li>
              </>
            )}
            <li>Your recordings, scene pictures and portraits, your original script, and a report of every check that passed.</li>
          </ul>
        </div>
        <div>
          <h3>What they still do</h3>
          <ul className="small">
            {unity ? (
              <>
                <li>Add the package (or open the project) in Unity. It offers to install Ink Unity Integration if the game doesn’t have it.</li>
                <li>
                  Put the story where it belongs in the game (a menu adds it to a scene), and connect it to their gameplay: the README in the package explains
                  how.
                </li>
                <li>Swap in the game’s own art, fonts and sounds if they want.</li>
              </>
            ) : (
              <>
                <li>
                  Run the setup script (it fetches Inkpot), then open the project in Unreal and let it build the plugin (a toolchain is needed once, unless you
                  export with a prebuilt plugin from the command line).
                </li>
                <li>
                  Already have a game? Copy the plugin into it, then use Tools → Import Pen to Ink Story to bring the story in. Importing again replaces it in
                  place, so Blueprints keep working.
                </li>
                <li>Put the story where it belongs in the game (a menu adds it to a level), and connect it to their gameplay: the README explains how.</li>
              </>
            )}
          </ul>
        </div>
        <div>
          <h3>Versions</h3>
          <ul className="small">
            {unity ? (
              <>
                <li>Unity 6 (recommended) or 2022.3 LTS and later</li>
                <li>
                  {a.integration.name} {a.integration.defaultRef}
                </li>
              </>
            ) : (
              <>
                <li>
                  Unreal Engine {a.defaultEngineVersion} (what it’s built and tested with) or 5.8; on 5.9 the Inkpot plugin needs a one-line fix, given in the
                  export’s README
                </li>
                <li>
                  {a.integration.name} {a.integration.defaultRef}, which the setup script fetches (changeable under Advanced)
                </li>
              </>
            )}
            <li>Ink compiled with inkjs {INKJS_VERSION}</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
