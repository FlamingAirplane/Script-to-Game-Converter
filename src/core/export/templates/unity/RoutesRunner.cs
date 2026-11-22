using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Replays the story's playthrough routes (StoryRoutes) on a NarrativeController: each must offer the same
    /// choices, reach the same ending and finish on the same line as when it was exported. Run them with
    /// Tools → Pen to Ink → __MENU_TITLE__ → Run Playthrough Tests, the Test Runner (the package's tests), or
    /// headless: -executeMethod __NAMESPACE__.EditorTools.PlaythroughRunner.RunBatch
    /// </summary>
    public static class PlaythroughRunner
    {
        /// <summary>Replays one route; null when it plays as written, else what was different.</summary>
        public static string Run(StoryRoutes.Route route)
        {
            var go = new GameObject("NarrativeBridge playthrough");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                c.autosave = false;
                string error = null;
                c.RuntimeError += m => { if (error == null) error = m; };
                c.StartStory();
                if (c.Story == null) return "The story did not start" + (error != null ? ": " + error : ".");
                for (int i = 0; i < route.Choices.Length; i++)
                {
                    var want = route.Choices[i];
                    var index = c.Story.currentChoices.FindIndex(x => x.text == want);
                    if (index < 0) return "Step " + (i + 1) + " (in " + (c.CurrentPassage ?? "?") + "): expected the choice \"" + want + "\" but the story offers " + Offered(c) + ".";
                    c.Choose(index);
                    if (error != null) return "Step " + (i + 1) + ": " + error;
                }
                if (!c.HasEnded) return "Expected the story to end after " + route.Choices.Length + " choice(s), but it offers " + Offered(c) + ".";
                if (!string.IsNullOrEmpty(route.Ending) && c.Story.state.VisitCountAtPathString(route.Ending) <= 0) return "Expected to end in " + route.Ending + ", but the story never got there.";
                var last = LastLine(c);
                if (last != route.LastLine) return "Expected the last line \"" + route.LastLine + "\" but it was \"" + last + "\".";
                return error;
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        static string Offered(NarrativeController c)
        {
            if (c.Story.currentChoices.Count == 0) return "no choices";
            return "[" + string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text)) + "]";
        }

        static string LastLine(NarrativeController c)
        {
            for (int i = c.Transcript.Count - 1; i >= 0; i--)
            {
                var l = c.Transcript[i];
                if (!l.IsChoice) return (l.Speaker != null ? l.Speaker + ": " : "") + l.Text;
            }
            return "";
        }

        /// <summary>Replays every route; the log lists each one and what went wrong.</summary>
        public static bool RunAll(out string log)
        {
            var lines = new List<string>();
            var failed = 0;
            foreach (var route in StoryRoutes.All)
            {
                var problem = Run(route);
                if (problem != null) failed++;
                lines.Add((problem == null ? "  passed  " : "  FAILED  ") + route.Name + (problem == null ? "" : ": " + problem));
            }
            log = "[NarrativeBridge] Playthrough tests: " + (StoryRoutes.All.Length - failed) + " of " + StoryRoutes.All.Length + " routes play as written." + "\n" + string.Join("\n", lines);
            return failed == 0;
        }

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Run Playthrough Tests")]
        static void RunMenu()
        {
            var ok = RunAll(out var log);
            if (ok) Debug.Log(log); else Debug.LogError(log);
        }

        /// <summary>Headless: Unity -batchmode -projectPath . -executeMethod __NAMESPACE__.EditorTools.PlaythroughRunner.RunBatch (exit code 0 = all passed).</summary>
        public static void RunBatch()
        {
            var ok = RunAll(out var log);
            Debug.Log(log);
            EditorApplication.Exit(ok ? 0 : 1);
        }
    }
}
