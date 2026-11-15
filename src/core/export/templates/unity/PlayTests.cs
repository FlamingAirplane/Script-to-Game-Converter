using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace __NAMESPACE__.PlayTests
{
    /// <summary>
    /// Play Mode tests (Test Runner → Play Mode): the story running as it does in the game. The panel plays it to an
    /// ending through its buttons with an autosave on the way, the Settings menu redraws a live panel, the writer's cue
    /// music loads (from Resources or Addressables) and plays, and switching language translates what's on screen.
    /// </summary>
    public class StoryPlayModeTests
    {
        class MemoryStorage : ISaveStorage
        {
            public readonly Dictionary<string, string> Saves = new Dictionary<string, string>();
            public void Write(string key, string data) => Saves[key] = data;
            public string Read(string key) => Saves.TryGetValue(key, out var d) ? d : null;
            public void Delete(string key) => Saves.Remove(key);
        }

        GameObject go;

        [TearDown]
        public void TearDown()
        {
            if (go != null) Object.Destroy(go);
        }

        NarrativeView Story(out NarrativeController controller, MemoryStorage storage)
        {
            go = new GameObject("Play mode test story");
            go.SetActive(false); // set it up before Awake runs
            controller = go.AddComponent<NarrativeController>();
            controller.startOnAwake = false;
            controller.drawDemoUI = false;
            controller.Storage = storage;
            var view = go.AddComponent<NarrativeView>();
            view.controller = controller;
            var theme = NarrativeTheme.LoadExported();
            theme.charactersPerSecond = 0f; // no typewriter: the buttons are there at once
            theme.lineFade = 0f;
            theme.autoAdvance = false;
            theme.transcript = NarrativeTheme.TranscriptMode.History;
            view.theme = theme;
            go.SetActive(true);
            return view;
        }

        [UnityTest]
        public IEnumerator ThePanelPlaysTheStoryToAnEnding()
        {
            var storage = new MemoryStorage();
            var view = Story(out var c, storage);
            yield return null; // Start builds the panel
            c.StartStory();
            yield return null;
            for (int step = 0; step < 300 && !c.HasEnded; step++)
            {
                if (c.IsAtExit) c.Resume();
                else
                {
                    Assert.Greater(view.Buttons.Count, 0, "The panel shows no buttons in " + c.CurrentPassage + ".");
                    view.Buttons[0].onClick.Invoke();
                }
                yield return null;
            }
            Assert.IsTrue(c.HasEnded, "The story didn't reach an ending through the panel's buttons.");
            Assert.IsTrue(c.autosave == false || storage.Saves.ContainsKey("autosave"), "No autosave was kept while playing.");
        }

        [UnityTest]
        public IEnumerator TheSettingsMenuRedrawsALivePanel()
        {
            var view = Story(out var c, new MemoryStorage());
            if (!view.theme.showSettings || !view.theme.showToolbar) { Assert.Ignore("The theme has no Settings button."); yield break; }
            yield return null;
            c.StartStory();
            var scale = NarrativeSettings.TextScale;
            try
            {
                NarrativeSettings.TextScale = 1f;
                view.OpenSettings();
                yield return null;
                view.SettingsButtons[0].onClick.Invoke(); // text size, one step up: the panel rebuilds itself
                yield return null;
                Assert.AreEqual(1.15f, NarrativeSettings.TextScale, 0.01f);
                Assert.IsTrue(view.SettingsOpen, "The menu closed when the panel redrew.");
                var expected = c.HasEnded || c.IsAtExit ? 0 : c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count;
                Assert.AreEqual(expected, view.Buttons.Count, "The story's buttons didn't come back after the redraw.");
            }
            finally { NarrativeSettings.TextScale = scale; }
        }

        [UnityTest]
        public IEnumerator TheWritersCueMusicPlays()
        {
            string tag = null, file = null;
            for (int i = 0; i < StoryInfo.CueSoundTags.Length; i++)
            {
                var t = StoryInfo.CueSoundTags[i];
                var colon = t.IndexOf(':');
                if (NarrativeCuePlayer.Guess(colon < 0 ? t : t.Substring(0, colon)) == NarrativeCuePlayer.CueAction.PlayMusic) { tag = t; file = StoryInfo.CueSoundFiles[i]; break; }
            }
            if (tag == null) { Assert.Ignore("No music cue has a sound attached."); yield break; }
            Story(out var c, new MemoryStorage());
            var player = go.AddComponent<NarrativeCuePlayer>();
            player.controller = c;
            player.cues.Add(new NarrativeCuePlayer.Cue { name = tag.Substring(0, tag.IndexOf(':')), action = NarrativeCuePlayer.CueAction.PlayMusic });
            player.musicFade = 0.2f;
            player.Play(tag.Substring(0, tag.IndexOf(':')), tag.Substring(tag.IndexOf(':') + 1));
            // From Resources at once; with Addressables when it has loaded.
            for (float t = 0f; t < 5f && player.CurrentMusic == null; t += Time.unscaledDeltaTime) yield return null;
            Assert.IsNotNull(player.CurrentMusic, "The music the writer attached (" + file + ") didn't load.");
            yield return new WaitForSecondsRealtime(0.3f);
            Assert.IsTrue(player.musicSource != null && player.musicSource.clip == player.CurrentMusic, "The music isn't on the music source.");
        }

        [UnityTest]
        public IEnumerator SwitchingLanguageTranslatesTheStory()
        {
            if (NarrativeLocalization.Languages.Count == 0) { Assert.Ignore("The translation sheet has no languages yet."); yield break; }
            var before = NarrativeLocalization.Language;
            var view = Story(out var c, new MemoryStorage());
            yield return null;
            c.StartStory();
            try
            {
                NarrativeLocalization.Language = NarrativeLocalization.Languages[0];
                yield return null;
                foreach (var l in c.Transcript)
                    Assert.AreEqual(NarrativeLocalization.Translate(l.SourceText), l.Text, "A line wasn't put into " + NarrativeLocalization.Language + ".");
                Assert.AreEqual(c.HasEnded || c.IsAtExit ? 0 : c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count, view.Buttons.Count, "The panel's buttons didn't come back after switching language.");
            }
            finally { NarrativeLocalization.Language = before; }
        }
    }
}
