using System.Collections.Generic;
using System.IO;
using Ink.Runtime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Editor tools for "__MENU_TITLE__": add the story to a scene, a demo scene, the theme, and the smoke test.
    /// A package is read-only, so the demo scene and the editable theme are made in your project's Assets.
    /// Nothing here runs by itself: your scenes and build settings are only changed when you ask.
    /// </summary>
    public static class NarrativeBridgeEditor
    {
        const string Menu = "Tools/Narrative Bridge/__MENU_TITLE__/";
        const string AssetFolder = "__ASSET_FOLDER__";
        const string ScenePath = AssetFolder + "/NarrativeDemo.unity";
        const string ThemePath = AssetFolder + "/NarrativeTheme.asset";

        /// <summary>Where the package is on disk (embedded, from disk or from a tarball alike).</summary>
        static string PackageFolder()
        {
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(NarrativeController).Assembly);
            return info != null ? info.resolvedPath : null;
        }

        [MenuItem("GameObject/Narrative Bridge/__MENU_TITLE__", false, 10)]
        static void CreateStoryObjectMenu(MenuCommand command)
        {
            var go = CreateStoryObject();
            GameObjectUtility.SetParentAndAlign(go, command.context as GameObject);
            Undo.RegisterCreatedObjectUndo(go, "Create " + go.name);
            Selection.activeObject = go;
        }

        /// <summary>A GameObject with the story's controller and its story panel, in the open scene.</summary>
        public static GameObject CreateStoryObject()
        {
            var go = new GameObject("__MENU_TITLE__ Story");
            var controller = go.AddComponent<NarrativeController>();
            controller.drawDemoUI = false; // the themed story panel replaces the bare-bones IMGUI demo
            var view = go.AddComponent<NarrativeView>();
            view.controller = controller;
            view.theme = LoadOrCreateTheme();
            if (StoryInfo.Cues.Length > 0) AddCuePlayer(go);
            return go;
        }

        /// <summary>Adds (or fills in) a NarrativeCuePlayer listing every cue in the story, with a likely action for each.</summary>
        public static NarrativeCuePlayer AddCuePlayer(GameObject go)
        {
            var player = go.GetComponent<NarrativeCuePlayer>();
            if (player == null) player = Undo.AddComponent<NarrativeCuePlayer>(go);
            else Undo.RecordObject(player, "Fill in cues");
            player.controller = go.GetComponent<NarrativeController>();
            foreach (var name in StoryInfo.Cues)
                if (!player.cues.Exists(c => c != null && c.name == name))
                {
                    var action = NarrativeCuePlayer.Guess(name);
                    // A cue of the writer's own naming with a sound attached plays it.
                    if (action == NarrativeCuePlayer.CueAction.EventOnly && NarrativeCuePlayer.HasStorySounds(name)) action = NarrativeCuePlayer.CueAction.PlaySound;
                    player.cues.Add(new NarrativeCuePlayer.Cue { name = name, action = action });
                }
            EditorUtility.SetDirty(player);
            return player;
        }

        [MenuItem(Menu + "Add Cue Player to Selected Story")]
        static void AddCuePlayerMenu()
        {
            var controller = Selection.activeGameObject != null ? Selection.activeGameObject.GetComponentInParent<NarrativeController>() : UnityEngine.Object.FindAnyObjectByType<NarrativeController>();
            if (controller == null) { Debug.LogWarning("[NarrativeBridge] Select the story's GameObject (the one with the NarrativeController) first."); return; }
            Selection.activeObject = AddCuePlayer(controller.gameObject);
            Debug.Log("[NarrativeBridge] Cue Player added with the story's cues: " + (StoryInfo.Cues.Length > 0 ? string.Join(", ", StoryInfo.CueTags) : "none yet") + ". Give each one its clips.");
        }

        [MenuItem(Menu + "Create Demo Scene")]
        public static void CreateDemoScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            NewDemoScene();
            Debug.Log("[NarrativeBridge] Demo scene created at " + ScenePath + ". Press Play to run the story.");
        }

        /// <summary>For a new project only (Narrative Bridge's complete-project export calls it on first open).</summary>
        public static void CreateDemoSceneIfMissing()
        {
            if (File.Exists(ScenePath)) return;
            NewDemoScene();
            if (EditorBuildSettings.scenes.Length == 0) EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Debug.Log("[NarrativeBridge] Demo scene created at " + ScenePath + ". Press Play to run the story.");
        }

        static void NewDemoScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            CreateStoryObject();
            EnsureFolder(AssetFolder);
            EditorSceneManager.SaveScene(scene, ScenePath);
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var slash = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, slash));
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }

        /// <summary>The project's theme asset, made from the exported look the first time.</summary>
        static NarrativeTheme LoadOrCreateTheme()
        {
            var theme = AssetDatabase.LoadAssetAtPath<NarrativeTheme>(ThemePath);
            if (theme != null) return theme;
            EnsureFolder(AssetFolder);
            theme = NarrativeTheme.LoadExported();
            AssetDatabase.CreateAsset(theme, ThemePath);
            AssetDatabase.SaveAssets();
            return theme;
        }

        [MenuItem(Menu + "Reset Theme to Exported Defaults")]
        public static void ResetTheme()
        {
            var theme = LoadOrCreateTheme();
            var exported = Resources.Load<TextAsset>(NarrativeTheme.ExportedResource);
            if (exported == null) { Debug.LogWarning("[NarrativeBridge] Resources/" + NarrativeTheme.ExportedResource + ".json is missing."); return; }
            Undo.RecordObject(theme, "Reset Narrative Bridge theme");
            theme.ApplyExported(exported.text);
            EditorUtility.SetDirty(theme);
            AssetDatabase.SaveAssets();
            Selection.activeObject = theme;
            Debug.Log("[NarrativeBridge] Theme reset to the look exported from Narrative Bridge.");
        }

        [MenuItem(Menu + "Run Story Smoke Test")]
        public static void RunSmokeTestMenu()
        {
            var ok = SmokeTest(false, out var log);
            if (ok) Debug.Log(log); else Debug.LogError(log);
        }

        /// <summary>
        /// Headless engine check: Unity -batchmode -projectPath . -executeMethod __NAMESPACE__.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch
        /// Requires the ink compiler inside Unity to compile the story's source (no fallback), then plays it. Exit code 0 = pass.
        /// </summary>
        public static void RunSmokeTestBatch()
        {
            var ok = SmokeTest(true, out var log);
            Debug.Log(log);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        /// Compiles the package's ink source with Ink Unity Integration's compiler, so the check also covers
        /// the engine side building the story. Returns the compiled JSON, or null (with the reason in errors).
        static string CompileInkSource(List<string> errors)
        {
            var root = PackageFolder();
            // Ink.Runtime has a Path too, so System.IO's is named in full.
            var path = root != null ? System.IO.Path.Combine(root, "Ink~", "MainStory.ink") : null;
            if (path == null || !File.Exists(path)) { errors.Add("The story's ink source (Ink~/MainStory.ink) is not in the package."); return null; }
            var problems = new List<string>();
            var compiler = new Ink.Compiler(File.ReadAllText(path), new Ink.Compiler.Options
            {
                sourceFilename = "MainStory.ink",
                errorHandler = (message, type) => { if (type == Ink.ErrorType.Error) problems.Add(message); },
            });
            Story compiled = null;
            try { compiled = compiler.Compile(); } catch (System.Exception e) { problems.Add(e.Message); }
            if (compiled == null || problems.Count > 0) { errors.Add("The ink compiler in Unity could not compile MainStory.ink: " + string.Join("; ", problems)); return null; }
            return compiled.ToJson();
        }

        static bool SmokeTest(bool requireEngineCompile, out string log)
        {
            var errors = new List<string>();
            var engineJson = CompileInkSource(errors);
            if (engineJson == null && requireEngineCompile)
            {
                log = "[NarrativeBridge] Smoke test failed: " + string.Join("; ", errors);
                return false;
            }
            // The game runs the precompiled story that ships in the package: it must load in this ink runtime.
            var shipped = Resources.Load<TextAsset>(StoryInfo.CompiledResource);
            if (shipped == null) errors.Add("The compiled story (Resources/" + StoryInfo.CompiledResource + ".json) did not import.");
            else
            {
                try { new Story(shipped.text); }
                catch (System.Exception e) { errors.Add("The compiled story does not load: " + e.Message); }
            }
            string json = engineJson ?? (shipped != null ? shipped.text : null);
            var source = engineJson != null ? "ink compiler in Unity" : "shipped JSON";
            if (json == null) { log = "[NarrativeBridge] Smoke test failed: compiled story not found. " + string.Join("; ", errors); return false; }
            var clipsHeard = new HashSet<string>();
            var picturesSeen = new HashSet<string>();
            int completed = 0;
            var rng = new System.Random(1234);
            const int runs = 50;
            for (int r = 0; r < runs; r++)
            {
                var story = new Story(json);
                story.onError += (m, t) => { if (t == Ink.ErrorType.Error) errors.Add(m); };
                int steps = 0;
                while (steps++ < 400)
                {
                    while (story.canContinue)
                    {
                        story.Continue();
                        foreach (var t in story.currentTags)
                        {
                            if (t.StartsWith("audio:")) clipsHeard.Add(t.Substring(6).Trim());
                            else if (t.StartsWith("image:")) picturesSeen.Add(t.Substring(6).Trim());
                        }
                    }
                    if (story.currentChoices.Count == 0) { completed++; break; }
                    story.ChooseChoiceIndex(rng.Next(story.currentChoices.Count));
                }
            }
            // Every voice clip a line refers to must have imported as an AudioClip.
            foreach (var file in clipsHeard)
            {
                if (NarrativeController.LoadVoiceClip(file) == null)
                    errors.Add("Voice clip did not import" + (StoryInfo.UsesAddressables ? " (or isn't in Addressables)" : "") + ": " + file);
            }
            // And every scene picture and character portrait must decode.
            foreach (var file in picturesSeen)
                if (NarrativeController.LoadPicture(file) == null) errors.Add("Scene picture could not be loaded: " + file);
            foreach (var speaker in StoryInfo.PortraitSpeakers)
                if (NarrativeController.LoadPortrait(speaker) == null) errors.Add("Portrait could not be loaded: " + speaker);
            var addressables = AddressablesCheck(clipsHeard, picturesSeen, errors);
            var carry = SaveCarryOverCheck(errors);
            var startAt = StartAtCheck(errors);
            var exit = ExitCheck(errors);
            var ui = StoryViewCheck(errors);
            var gates = LockedChoiceCheck(json, errors);
            var cueResult = CueCheck(errors);
            var slots = SaveSlotCheck(errors);
            var translation = TranslationCheck(errors);
            var routeResult = "no playthrough routes";
            if (StoryRoutes.All.Length > 0)
            {
                var routesOk = PlaythroughRunner.RunAll(out var routeLog);
                if (!routesOk) errors.Add(routeLog);
                routeResult = routesOk ? "playthrough routes passed (" + StoryRoutes.All.Length + ")" : "playthrough routes failed";
            }
            log = "[NarrativeBridge] Smoke test (" + source + "): " + clipsHeard.Count + " voice clip(s), " + picturesSeen.Count + " picture(s) and " + StoryInfo.PortraitSpeakers.Length + " portrait(s) checked" + addressables + ", " + completed + "/" + runs + " playthroughs reached an ending, "  + carry + ", " + startAt + ", " + exit + ", " + ui + ", " + gates + ", " + cueResult + ", " + slots + ", " + translation + ", " + routeResult + ", " + errors.Count + " runtime errors." +
                  (errors.Count > 0 ? "\n" + string.Join("\n", errors) : "");
            return errors.Count == 0 && completed > 0;
        }

        /// Makes up a language from the sheet ("[xx] " before every source text), plays the story in it, and checks every
        /// line, choice and name the story shows was found in the sheet: the keys Narrative Bridge wrote match the ones
        /// the controller computes. The player's language and the package's sheet are put back afterwards.
        static string TranslationCheck(List<string> errors)
        {
            var rows = NarrativeLocalization.ReadSheet();
            if (rows.Count < 2) { errors.Add("Translations: the translation sheet (Resources/" + StoryInfo.TranslationsResource + ".csv) is missing or empty."); return "translations failed"; }
            var source = System.Array.IndexOf(rows[0], "source");
            var csv = new System.Text.StringBuilder("key,kind,passage,source,xx\n");
            for (int r = 1; r < rows.Count; r++) csv.Append(rows[r][0]).Append(",,,,\"[xx] ").Append(rows[r][source].Replace("\"", "\"\"")).Append("\"\n");
            var hadLanguage = PlayerPrefs.HasKey("NarrativeBridge.Language");
            var before = NarrativeLocalization.Language;
            var go = new GameObject("NarrativeBridge translation check");
            try
            {
                NarrativeLocalization.UseSheet(new TextAsset(csv.ToString()));
                NarrativeLocalization.Language = "xx";
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.StartStory();
                var missing = new List<string>();
                var shown = 0;
                for (int step = 0; step < 300 && c.Story != null; step++)
                {
                    // (At an exit to the game the panel steps aside: its lone choice is never shown.)
                    if (!c.IsAtExit) foreach (var choice in c.Story.currentChoices)
                    {
                        var t = NarrativeController.ChoiceText(choice);
                        if (!t.StartsWith("[xx] ")) missing.Add("choice \"" + choice.text + "\"");
                    }
                    if (c.HasEnded || c.Story.currentChoices.Count == 0) break;
                    c.Choose(0);
                }
                foreach (var l in c.Transcript)
                {
                    shown++;
                    if (!l.Text.StartsWith("[xx] ")) missing.Add("line \"" + l.SourceText + "\"");
                    if (l.Speaker != null && !l.Speaker.StartsWith("[xx] ")) missing.Add("speaker " + l.SourceSpeaker);
                }
                if (missing.Count > 0) { errors.Add("Translations: not found in the sheet: " + string.Join("; ", missing.GetRange(0, System.Math.Min(5, missing.Count)))); return "translations failed"; }
                // Back to the story as written: the transcript follows.
                NarrativeLocalization.Language = "";
                if (!Application.isPlaying) c.Relocalize(); // a playing controller does this itself (OnEnable subscribes it)
                foreach (var l in c.Transcript) if (l.Text.StartsWith("[xx] ")) { errors.Add("Translations: switching back to the story's own language left a translated line."); return "translations failed"; }
                return "translations passed (" + (rows.Count - 1) + " in the sheet, " + shown + " lines checked)";
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
                NarrativeLocalization.UseSheet(null);
                NarrativeLocalization.Language = before;
                if (!hadLanguage) PlayerPrefs.DeleteKey("NarrativeBridge.Language");
            }
        }

        /// Save slots kept in memory for the check (the game's own files are never touched).
        class MemoryStorage : ISaveStorage
        {
            public readonly Dictionary<string, string> Saves = new Dictionary<string, string>();
            public void Write(string key, string data) => Saves[key] = data;
            public string Read(string key) => Saves.TryGetValue(key, out var d) ? d : null;
            public void Delete(string key) => Saves.Remove(key);
        }

        /// Saves part-way into a slot, plays on, loads the slot back (same choices as when saved), checks what the
        /// slot says about itself, then the panel's Load menu lists the slots, and a slot can be deleted.
        static string SaveSlotCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge save slot check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.saveSlots = 3;
                c.Storage = new MemoryStorage();
                c.StartStory();
                if (c.Story == null) { errors.Add("Save slots: the story did not start."); return "save slots failed"; }
                for (int i = 0; i < 2 && c.Story.currentChoices.Count > 0; i++) c.Choose(0);
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                var passage = c.CurrentPassage;
                c.SaveToSlot(2);
                for (int i = 0; i < 3 && c.Story.currentChoices.Count > 0; i++) c.Choose(c.Story.currentChoices.Count - 1);
                if (!c.LoadFromSlot(2)) { errors.Add("Save slots: slot 2 did not load: " + c.Status); return "save slots failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                if (got != expected) { errors.Add("Save slots: expected choices [" + expected + "] after loading but got [" + got + "]"); return "save slots failed"; }
                var info = c.GetSlot(2);
                if (!info.Exists || info.Passage != passage || string.IsNullOrEmpty(info.PassageTitle) || info.SavedAt == default(System.DateTime)) { errors.Add("Save slots: slot 2 doesn't say where and when it was saved."); return "save slots failed"; }
                if (c.GetSlot(1).Exists || c.LoadFromSlot(1)) { errors.Add("Save slots: an empty slot loaded."); return "save slots failed"; }
                var view = go.AddComponent<NarrativeView>();
                view.controller = c;
                view.theme = NarrativeTheme.LoadExported();
                view.Build();
                view.OpenSaveSlots(false);
                // Load menu: the autosave and 3 slots, then Close; only slot 2 can be loaded.
                var loadable = 0;
                foreach (var b in view.SettingsButtons) if (b.interactable) loadable++;
                if (!view.SlotsOpen || view.SettingsButtons.Count != 5 || loadable != 2) { errors.Add("Save slots: the Load menu shows " + view.SettingsButtons.Count + " buttons (" + loadable + " usable) instead of 5 (2 usable)."); return "save slots failed"; }
                view.SettingsButtons[2].onClick.Invoke(); // slot 2
                if (view.SlotsOpen || string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) != expected) { errors.Add("Save slots: loading from the menu didn't load slot 2."); return "save slots failed"; }
                c.DeleteSlot(2);
                if (c.GetSlot(2).Exists) { errors.Add("Save slots: slot 2 was not deleted."); return "save slots failed"; }
                // The default storage: files in a folder (a temporary one here).
                var folder = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "NarrativeBridgeSlotCheck-" + System.Guid.NewGuid().ToString("N"));
                try
                {
                    var files = new FileSaveStorage(folder);
                    files.Write("slot-1", c.SaveState());
                    files.Write("slot-1", c.SaveState()); // over an existing save
                    if (files.Read("slot-1") == null || files.Read("slot-9") != null) { errors.Add("Save slots: file storage did not read back what it wrote."); return "save slots failed"; }
                    files.Delete("slot-1");
                    if (files.Read("slot-1") != null) { errors.Add("Save slots: file storage did not delete."); return "save slots failed"; }
                }
                finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
                return "save slots passed (files and menu)";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Plays the story with a Cue Player set up as Add Cue Player does (with no clips yet): every cue the story
        /// reaches is one of StoryInfo.Cues, and none of them fails.
        static string CueCheck(List<string> errors)
        {
            if (StoryInfo.Cues.Length == 0) return "no cues";
            var go = new GameObject("NarrativeBridge cue check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.startOnAwake = false;
                var player = AddCuePlayer(go);
                var heard = new HashSet<string>();
                player.CuePlayed += (name, value) =>
                {
                    heard.Add(name);
                    if (System.Array.IndexOf(StoryInfo.Cues, name) < 0) errors.Add("Cue: the story reached a cue that isn't in StoryInfo.Cues: " + name);
                };
                player.enabled = false; player.enabled = true; // subscribe now (OnEnable)
                var rng = new System.Random(7);
                for (int run = 0; run < 20; run++)
                {
                    c.StartStory();
                    for (int i = 0; i < 300 && c.Story != null && !c.HasEnded; i++)
                    {
                        if (c.IsAtExit) c.Resume();
                        else if (c.IsWaitingForContinue) c.Continue();
                        else if (c.Story.currentChoices.Count > 0) c.Choose(rng.Next(c.Story.currentChoices.Count));
                        else break;
                    }
                }
                foreach (var file in StoryInfo.CueSoundFiles)
                    if (NarrativeController.LoadVoiceClip(file) == null) errors.Add("Cue sound did not import" + (StoryInfo.UsesAddressables ? " (or isn't in Addressables)" : "") + ": " + file);
                foreach (var tag in StoryInfo.CueTags)
                {
                    var colon = tag.IndexOf(':');
                    player.Play(colon < 0 ? tag : tag.Substring(0, colon), colon < 0 ? "" : tag.Substring(colon + 1));
                }
                // A music cue with the writer's sound plays that sound (no clips of the game's own here).
                for (int i = 0; i < StoryInfo.CueSoundTags.Length; i++)
                {
                    var tag = StoryInfo.CueSoundTags[i];
                    var colon = tag.IndexOf(':');
                    var name = colon < 0 ? tag : tag.Substring(0, colon);
                    if (NarrativeCuePlayer.Guess(name) != NarrativeCuePlayer.CueAction.PlayMusic) continue;
                    player.Play(name, colon < 0 ? "" : tag.Substring(colon + 1));
                    var file = StoryInfo.CueSoundFiles[i];
                    var dot = file.LastIndexOf('.');
                    if (player.CurrentMusic == null || player.CurrentMusic.name != (dot > 0 ? file.Substring(0, dot) : file))
                        errors.Add("Cue: " + tag + " didn't play the sound the writer attached (" + file + ").");
                }
                return "cues passed (" + heard.Count + " of " + StoryInfo.Cues.Length + " reached" + (StoryInfo.CueSoundFiles.Length > 0 ? ", " + StoryInfo.CueSoundFiles.Length + " sound(s)" : "") + ")";
            }
            catch (System.Exception e) { errors.Add("Cue: " + e.Message); return "cues failed"; }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// With Addressables: every voice clip, picture and portrait is in the story's group, at the address the
        /// controller asks for (the group is set up first if it's missing).
        static string AddressablesCheck(HashSet<string> clipsHeard, HashSet<string> picturesSeen, List<string> errors)
        {
            if (!StoryInfo.UsesAddressables) return "";
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
            if (settings == null || settings.FindGroup(AddressablesSetup.GroupName) == null) AddressablesSetup.SetUp();
            settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
            var group = settings != null ? settings.FindGroup(AddressablesSetup.GroupName) : null;
            if (group == null) { errors.Add("Addressables: the group " + AddressablesSetup.GroupName + " could not be made."); return " (Addressables failed)"; }
            var addresses = new HashSet<string>();
            foreach (var e in group.entries) addresses.Add(e.address);
            var wanted = new List<string>();
            foreach (var file in clipsHeard) { var dot = file.LastIndexOf('.'); wanted.Add(StoryInfo.AddressPrefix + "Audio/" + (dot > 0 ? file.Substring(0, dot) : file)); }
            foreach (var file in picturesSeen) wanted.Add(StoryInfo.AddressPrefix + "Images/" + file);
            foreach (var file in StoryInfo.CueSoundFiles) { var dot = file.LastIndexOf('.'); wanted.Add(StoryInfo.AddressPrefix + "Audio/" + (dot > 0 ? file.Substring(0, dot) : file)); }
            foreach (var f in StoryInfo.PortraitFiles) wanted.Add(StoryInfo.AddressPrefix + "Images/" + f);
            foreach (var a in wanted) if (!addresses.Contains(a)) errors.Add("Addressables: nothing has the address " + a + ".");
            return " (with Addressables, " + addresses.Count + " in the group)";
#else
            errors.Add("This story loads its voice clips and pictures with Addressables, but the Addressables package isn't installed.");
            return " (Addressables missing)";
#endif
        }

        /// Every locked-choice condition names a real passage and real story variables.
        static string LockedChoiceCheck(string json, List<string> errors)
        {
            if (StoryInfo.GatedChoices.Length == 0) return "no locked choices";
            var story = new Story(json);
            var before = errors.Count;
            foreach (var g in StoryInfo.GatedChoices)
            {
                if (System.Array.IndexOf(StoryInfo.Passages, g.Passage) < 0) errors.Add("Locked choice \"" + g.Text + "\" is in an unknown passage " + g.Passage + ".");
                g.Missing(name =>
                {
                    if (!story.variablesState.GlobalVariableExistsWithName(name)) { errors.Add("Locked choice \"" + g.Text + "\" reads an unknown variable " + name + "."); return null; }
                    return story.variablesState[name];
                });
            }
            return errors.Count == before ? "locked choices passed (" + StoryInfo.GatedChoices.Length + ")" : "locked choices failed";
        }

        /// Saves part-way through, then loads that save as if it came from an earlier story version:
        /// the controller must replay the choices and land on the same choices as an exact load.
        static string SaveCarryOverCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge smoke test");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.StartStory();
                if (c.Story == null) { errors.Add("Save carry-over: the controller could not start the story."); return "save carry-over not run"; }
                for (int i = 0; i < 3 && c.Story.currentChoices.Count > 0; i++) c.Choose(0);
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                var save = c.SaveState();
                var older = save.Replace("\"storyVersion\":\"" + StoryInfo.StoryVersion + "\"", "\"storyVersion\":\"earlier\"");
                c.StartStory();
                if (!c.TryLoadState(older, out var err)) { errors.Add("Save carry-over: " + err); return "save carry-over failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                if (got != expected || c.LoadNote == null) { errors.Add("Save carry-over: expected choices [" + expected + "] but got [" + got + "]"); return "save carry-over failed"; }
                return "save carry-over passed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Starts the story at every passage, as a game does for a conversation, without runtime errors.
        // Just the letters and digits of a line, lower case, without rich text tags (to compare lines however they're styled).
        static string Letters(string s)
        {
            if (s == null) return "";
            s = System.Text.RegularExpressions.Regex.Replace(s, "<[^>]+>", "");
            var sb = new System.Text.StringBuilder();
            foreach (var ch in s) if (char.IsLetterOrDigit(ch)) sb.Append(char.ToLowerInvariant(ch));
            return sb.ToString();
        }

        static string StartAtCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge start-at check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                var before = errors.Count;
                c.RuntimeError += m => errors.Add("StartAt: " + m);
                foreach (var p in StoryInfo.Passages)
                {
                    c.StartAt(p);
                    if (c.Story == null || c.StartPassage != p) { errors.Add("StartAt(" + p + ") did not start the story there."); break; }
                }
                // Every line of dialogue too: the first thing shown is that line, in its passage.
                for (int i = 0; i < StoryInfo.Lines.Length; i++)
                {
                    var l = StoryInfo.Lines[i];
                    c.StartAt(l);
                    var said = StoryInfo.LineTexts[i];
                    var colon = said.IndexOf(": ", System.StringComparison.Ordinal);
                    var words = Letters(colon < 0 ? said : said.Substring(colon + 2));
                    var first = c.Transcript.Count > 0 ? Letters(c.Transcript[0].SourceText ?? c.Transcript[0].Text) : null;
                    if (words.Length > 12) words = words.Substring(0, 12);
                    if (c.Story == null || c.StartPassage != l || first == null || !first.Contains(words))
                    { errors.Add("StartAt(" + l + ") did not start the story at that line."); break; }
                }
                return errors.Count == before ? "start-at passed (" + StoryInfo.Passages.Length + " passages, " + StoryInfo.Lines.Length + " lines)" : "start-at failed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Plays to an exit to the game, resumes at another passage (as a game does after a fight it lost),
        /// and checks a save made after that jump carries over to a revised story.
        static string ExitCheck(List<string> errors)
        {
            if (StoryInfo.Exits.Length == 0) return "no exits to the game";
            var go = new GameObject("NarrativeBridge exit check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                string reached = null;
                c.ExitReached += e => reached = e;
                c.StartStory();
                for (int i = 0; i < 300 && reached == null && c.Story != null && !c.HasEnded; i++)
                {
                    if (c.IsWaitingForContinue) c.Continue();
                    else if (c.Story.currentChoices.Count > 0) c.Choose(0);
                }
                if (reached == null) return "exits not reached by the first choices";
                if (System.Array.IndexOf(StoryInfo.Exits, reached) < 0) { errors.Add("Exit: " + reached + " is not in StoryInfo.Exits."); return "exits failed"; }
                c.ResumeAt(StoryInfo.Passages[StoryInfo.Passages.Length - 1]);
                if (c.IsAtExit && c.CurrentExit == reached) { errors.Add("Exit: ResumeAt did not leave the exit."); return "exits failed"; }
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "/" + c.HasEnded;
                var save = c.SaveState().Replace("\"storyVersion\":\"" + StoryInfo.StoryVersion + "\"", "\"storyVersion\":\"earlier\"");
                c.StartStory();
                if (!c.TryLoadState(save, out var err)) { errors.Add("Exit: " + err); return "exits failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "/" + c.HasEnded;
                if (got != expected) { errors.Add("Exit: after ResumeAt, a carried-over save expected [" + expected + "] but got [" + got + "]"); return "exits failed"; }
                return "exits passed (" + reached + ", resumed elsewhere, save carried over)";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Builds the story panel from the exported theme and plays a few steps through its buttons:
        /// one button per choice (one for a Continue break), clicks advance the story, the ending shows.
        static string StoryViewCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge view check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                var view = go.AddComponent<NarrativeView>();
                view.controller = c;
                view.theme = NarrativeTheme.LoadExported();
                view.Build();
                c.StartStory();
                if (c.Story == null || view.Canvas == null) { errors.Add("Story UI: the panel was not built."); return "story UI failed"; }
                var textKind = "Text";
#if NARRATIVE_BRIDGE_TMP
                // Unity's current text system when the game has it.
                if (view.Canvas.GetComponentsInChildren<TMPro.TextMeshProUGUI>(true).Length == 0) { errors.Add("Story UI: TextMeshPro is available but the panel doesn't use it."); return "story UI failed"; }
                textKind = "TextMeshPro";
#endif
                var steps = 0;
                var pictures = 0;
                var portraits = 0;
                var exits = 0;
                var locked = 0;
                var settings = SettingsCheck(view, errors);
                if (settings == null) return "story UI failed";
                // Emphasis from the script: typed a letter at a time with its tags closed; any other markup shows as written.
                var typedCheck = NarrativeView.Typed("a <i>bold</i> move", 4);
                if (typedCheck != "a <i>bo</i>" || NarrativeView.Plain("<b>x</b><i>y</i>") != "xy") { errors.Add("Story UI: emphasis is typed wrongly (" + typedCheck + ")."); return "story UI failed"; }
                var escaped = NarrativeView.Markup("<i>a</i> <color=red>b");
                if (!escaped.StartsWith("<i>a</i> ") || escaped.Contains("<color=red>")) { errors.Add("Story UI: markup in the story's text is read as tags (" + escaped + ")."); return "story UI failed"; }
                while (!c.HasEnded && steps++ < 200)
                {
                    // The scene the reader is in shows its picture (when the theme shows pictures).
                    var file = c.CurrentPicture;
                    if (file != null && view.theme.showPictures)
                    {
                        if (view.Picture == null) { errors.Add("Story UI: the scene picture " + file + " is not shown."); return "story UI failed"; }
                        pictures++;
                    }
                    // The last line spoken by a character with a portrait shows it (when the theme shows portraits).
                    string speaker = null;
                    for (int i = c.Transcript.Count - 1; i >= 0; i--) if (!c.Transcript[i].IsChoice) { speaker = c.Transcript[i].SpeakerId; break; }
                    if (speaker != null && view.theme.showPortraits && NarrativeController.PortraitFile(speaker) != null)
                    {
                        if (view.Portrait == null) { errors.Add("Story UI: the portrait of " + speaker + " is not shown."); return "story UI failed"; }
                        portraits++;
                    }
                    // An exit to the game: the panel steps aside until the game resumes the story.
                    if (c.IsAtExit)
                    {
                        if (view.hideDuringExits && view.Visible) { errors.Add("Story UI: the panel still shows at the exit " + c.CurrentExit + "."); return "story UI failed"; }
                        exits++;
                        c.Resume();
                        if (!view.Visible && !c.IsAtExit) { errors.Add("Story UI: the panel did not come back after resuming."); return "story UI failed"; }
                        continue;
                    }
                    var expected = c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count;
                    if (view.Buttons.Count != expected) { errors.Add("Story UI: expected " + expected + " button(s) but the panel shows " + view.Buttons.Count + "."); return "story UI failed"; }
                    // Locked choices show greyed out, and can't be clicked.
                    var lockedNow = view.theme.showLockedChoices ? c.LockedChoices.Count : 0;
                    if (view.LockedButtons.Count != lockedNow) { errors.Add("Story UI: expected " + lockedNow + " locked choice(s) but the panel shows " + view.LockedButtons.Count + "."); return "story UI failed"; }
                    foreach (var b in view.LockedButtons) if (b.interactable) { errors.Add("Story UI: a locked choice can be clicked."); return "story UI failed"; }
                    locked += lockedNow;
                    var before = c.Transcript.Count + "/" + c.Story.state.currentTurnIndex;
                    view.Buttons[0].onClick.Invoke();
                    if (before == c.Transcript.Count + "/" + c.Story.state.currentTurnIndex) { errors.Add("Story UI: clicking a button did not advance the story."); return "story UI failed"; }
                }
                if (!c.HasEnded) return "story UI passed (" + steps + " steps, no ending within the check)";
                if (view.Buttons.Count != 0) { errors.Add("Story UI: buttons are still shown after the ending."); return "story UI failed"; }
                return "story UI passed (" + textKind + ")" + (pictures > 0 ? " with pictures" : "") + (portraits > 0 ? (pictures > 0 ? " and portraits" : " with portraits") : "") + (exits > 0 ? ", " + exits + " exit(s) to the game and back" : "") + (locked > 0 ? ", " + locked + " locked choice(s) shown" : "") + ", " + settings;
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Opens the player's Settings menu, changes the text size, and checks the panel follows; the
        /// player's own settings are put back afterwards.
        static string SettingsCheck(NarrativeView view, List<string> errors)
        {
            if (!view.theme.showSettings || !view.theme.showToolbar) return "settings menu off";
            var scale = NarrativeSettings.TextScale;
            var contrast = NarrativeSettings.HighContrast;
            try
            {
                view.OpenSettings();
                var rows = NarrativeLocalization.Languages.Count > 0 ? 8 : 7; // a Language row when there are translations
                if (!view.SettingsOpen || view.SettingsButtons.Count != rows) { errors.Add("Settings: expected " + rows + " buttons in the menu but it has " + view.SettingsButtons.Count + "."); return null; }
                NarrativeSettings.TextScale = 1f;
                view.SettingsButtons[0].onClick.Invoke(); // text size, one step up
                view.SettingsButtons[3].onClick.Invoke(); // high contrast
                view.Build(); // a playing panel rebuilds itself; in the editor it's done here
                if (Mathf.Abs(NarrativeSettings.TextScale - 1.15f) > 0.01f || NarrativeSettings.HighContrast == contrast) { errors.Add("Settings: the menu's buttons didn't change the settings."); return null; }
                if (!view.SettingsOpen || view.SettingsButtons.Count != rows) { errors.Add("Settings: the menu closed when a setting changed."); return null; }
                view.SettingsButtons[rows - 1].onClick.Invoke(); // close
                if (view.SettingsOpen) { errors.Add("Settings: Close didn't close the menu."); return null; }
                return "settings menu passed";
            }
            finally
            {
                NarrativeSettings.TextScale = scale;
                NarrativeSettings.HighContrast = contrast;
                view.Build();
                view.Redraw();
            }
        }
    }
}
