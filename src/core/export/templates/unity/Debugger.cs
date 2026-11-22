using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// Tools → Pen to Ink → __MENU_TITLE__ → Story Debugger. While the game plays it follows the story: the
    /// passage the reader is in, the choices (click to choose), the locked ones, every story variable and item (edit
    /// them), a jump to any passage, and saves to and from the clipboard.
    /// </summary>
    public class StoryDebuggerWindow : EditorWindow
    {
        NarrativeController target;
        Vector2 scroll;
        int jumpIndex;
        string[] jumpTargets, jumpLabels;
        bool showVariables = true, showItems = true, showTranscript = true;

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Story Debugger")]
        public static void Open() => GetWindow<StoryDebuggerWindow>(false, "Story Debugger", true);

        void OnEnable() => EditorApplication.playModeStateChanged += OnPlayModeChanged;
        void OnDisable() => EditorApplication.playModeStateChanged -= OnPlayModeChanged;
        void OnPlayModeChanged(PlayModeStateChange change) { target = null; Repaint(); }
        void OnInspectorUpdate() { if (Application.isPlaying) Repaint(); }

        void OnGUI()
        {
            EditorGUILayout.LabelField(StoryInfo.Title, EditorStyles.boldLabel);
            if (!Application.isPlaying)
            {
                EditorGUILayout.HelpBox("Press Play to follow the story here: the passage, the choices (click one to choose it), the locked ones, and the story's variables and items, which you can change.", MessageType.Info);
                return;
            }
            var all = UnityEngine.Object.FindObjectsByType<NarrativeController>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            if (all.Length == 0)
            {
                EditorGUILayout.HelpBox("No NarrativeController for this story is in the open scenes.", MessageType.Warning);
                return;
            }
            if (target == null || Array.IndexOf(all, target) < 0) target = all[0];
            if (all.Length > 1)
            {
                var names = Array.ConvertAll(all, x => x.gameObject.name);
                target = all[EditorGUILayout.Popup("Controller", Array.IndexOf(all, target), names)];
            }
            var c = target;
            scroll = EditorGUILayout.BeginScrollView(scroll);
            try { Draw(c); }
            finally { EditorGUILayout.EndScrollView(); }
        }

        void Draw(NarrativeController c)
        {
            if (c.Story == null)
            {
                EditorGUILayout.HelpBox("The story hasn't started.", MessageType.Info);
                if (GUILayout.Button("Start the story")) c.StartStory();
                DrawJump(c);
                return;
            }
            EditorGUILayout.LabelField("Passage", c.CurrentPassage ?? "(none yet)");
            EditorGUILayout.LabelField("Waiting for", c.HasEnded ? "nothing: the story has ended" : c.IsAtExit ? "the game (exit: " + c.CurrentExit + ")" : c.IsWaitingForContinue ? "Continue" : c.Story.currentChoices.Count + " choice(s)");
            if (!string.IsNullOrEmpty(c.Status)) EditorGUILayout.LabelField("Status", c.Status);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Choices", EditorStyles.boldLabel);
            if (c.IsAtExit)
            {
                if (GUILayout.Button("Resume the story (as the game would)")) c.Resume();
            }
            else if (c.IsWaitingForContinue)
            {
                if (GUILayout.Button("Continue")) c.Continue();
            }
            else
            {
                var choices = c.Story.currentChoices;
                for (int i = 0; i < choices.Count; i++)
                    if (GUILayout.Button((i + 1) + ". " + choices[i].text, EditorStyles.miniButton)) { c.Choose(i); GUIUtility.ExitGUI(); }
                using (new EditorGUI.DisabledScope(true))
                    foreach (var l in c.LockedChoices) GUILayout.Button("Locked: " + l.Text + "  (needs " + l.Needs + ")", EditorStyles.miniButton);
                if (c.HasEnded) EditorGUILayout.LabelField("The story has ended.");
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Restart")) c.StartStory();
                if (GUILayout.Button("Copy save")) { EditorGUIUtility.systemCopyBuffer = c.SaveState(); ShowNotification(new GUIContent("Save copied")); }
                if (GUILayout.Button("Load save from clipboard"))
                    ShowNotification(new GUIContent(c.TryLoadState(EditorGUIUtility.systemCopyBuffer, out var err) ? (c.LoadNote ?? "Loaded") : err));
            }
            DrawJump(c);

            EditorGUILayout.Space();
            showVariables = EditorGUILayout.Foldout(showVariables, "Variables (" + StoryInfo.Variables.Length + ")", true);
            if (showVariables) foreach (var name in StoryInfo.Variables) DrawVariable(c, name, name);
            showItems = EditorGUILayout.Foldout(showItems, "Items (" + StoryInfo.ItemVariables.Length + ")", true);
            if (showItems)
            {
                if (c.inventoryAuthority != null && StoryInfo.ItemVariables.Length > 0)
                    EditorGUILayout.HelpBox("Your game's inventory decides the items: changes here are passed to it.", MessageType.None);
                foreach (var name in StoryInfo.ItemVariables) DrawVariable(c, name, name.Substring(4));
            }

            EditorGUILayout.Space();
            showTranscript = EditorGUILayout.Foldout(showTranscript, "Latest lines", true);
            if (showTranscript)
            {
                var t = c.Transcript;
                for (int i = Mathf.Max(0, t.Count - 12); i < t.Count; i++)
                    EditorGUILayout.LabelField(t[i].IsChoice ? "> " + t[i].Text : (t[i].Speaker != null ? t[i].Speaker + ": " : "") + t[i].Text, EditorStyles.wordWrappedMiniLabel);
            }
        }

        void DrawJump(NarrativeController c)
        {
            if (StoryInfo.Passages.Length == 0) return;
            // Passages, then every line of dialogue ("garden/MARA: Did you bring…"), so a conversation can be picked up partway.
            if (jumpTargets == null)
            {
                var targets = new List<string>(StoryInfo.Passages);
                var labels = new List<string>(StoryInfo.Passages);
                for (int i = 0; i < StoryInfo.Lines.Length; i++)
                {
                    targets.Add(StoryInfo.Lines[i]);
                    labels.Add("Lines/" + NarrativeController.PassageOf(StoryInfo.Lines[i]) + "/" + StoryInfo.LineTexts[i].Replace("/", "\u2215"));
                }
                jumpTargets = targets.ToArray();
                jumpLabels = labels.ToArray();
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                jumpIndex = EditorGUILayout.Popup("Jump to", Mathf.Clamp(jumpIndex, 0, jumpTargets.Length - 1), jumpLabels);
                if (GUILayout.Button("Go", GUILayout.Width(40)))
                {
                    if (c.Story == null) c.StartAt(jumpTargets[jumpIndex]);
                    else c.ResumeAt(jumpTargets[jumpIndex]);
                }
            }
        }

        static void DrawVariable(NarrativeController c, string name, string label)
        {
            object value;
            try { value = c.Story.variablesState[name]; } catch { return; }
            object changed = value;
            if (value is bool b) changed = EditorGUILayout.Toggle(label, b);
            else if (value is int i) changed = EditorGUILayout.IntField(label, i);
            else if (value is float f) changed = EditorGUILayout.FloatField(label, f);
            else if (value is string s) changed = EditorGUILayout.TextField(label, s);
            else EditorGUILayout.LabelField(label, value == null ? "(none)" : value.ToString());
            if (!Equals(changed, value)) c.Story.variablesState[name] = changed;
        }
    }
}
