# Stand-in Unreal headers

Just enough of Unreal Engine's `CoreMinimal.h` (`TCHAR`, `TEXT`, `int32`…) for `npm run test:unreal` to check that the C++
the Unreal export generates for each story is valid C++ (`clang++ -fsyntax-only`): `NarrativeBridgeStoryInfo.h` (the
story's passages, cues, portraits and the C++ conditions of its locked choices) and `NarrativeBridgeRoutes.h` (its
playthrough routes). That's the C++ that changes from story to story, so a story whose text or conditions turn into bad
C++ fails CI.

The rest of the export's C++ (the story component, story panel, cue player and editor module) is the same for every
story and uses much more of Unreal and Inkpot than stand-ins could honestly imitate. `npm run test:unreal:build` builds
all of it with a real Unreal Engine and Inkpot, and with `--test` runs its automation tests; run it after changing those
templates.
