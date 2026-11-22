using System;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;
using UnityEngine.Events;
#if NARRATIVE_BRIDGE_ADDRESSABLES
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
#endif

namespace __NAMESPACE__
{
    /// <summary>
    /// Runs the story with the ink runtime from Ink Unity Integration: advances text, presents choices and
    /// Continue breaks, exposes approved variables, synchronises inventory with your game and saves/restores
    /// state with story-version checks. NarrativeView draws it as a themed uGUI story panel; your own UI and
    /// game systems can use the C# events or the Inspector events below instead.
    /// Includes an optional bare-bones IMGUI demo (drawDemoUI).
    /// </summary>
    [AddComponentMenu("Pen to Ink/__MENU_TITLE__/Narrative Controller")]
    public class NarrativeController : MonoBehaviour
    {
#if NARRATIVE_BRIDGE_INK_FILE
        [Tooltip("Optional: an InkFile imported by Ink Unity Integration, to run your own edited copy of the story.")]
        public Ink.UnityIntegration.InkFile inkFile;
#endif

        [Tooltip("Optional compiled ink JSON. Leave empty to use the story in this package.")]
        public TextAsset storyJson;

        [Tooltip("Optional component implementing IInventoryAuthority. When set, your game owns item possession.")]
        public MonoBehaviour inventoryAuthority;

        [Tooltip("Start when this object wakes. Turn off to start it yourself with StartStory() or StartAt(passage).")]
        public bool startOnAwake = true;

        [Tooltip("Draw the bare-bones IMGUI demo. Off when a NarrativeView or your own UI draws the story.")]
        public bool drawDemoUI = true;

        [Tooltip("Play the recorded dialogue clips (#audio tags) that come with the story.")]
        public bool playVoiceClips = true;

        [Tooltip("Optional AudioSource for voice clips, e.g. one routed through your game's mixer. One is added when empty.")]
        public AudioSource voiceSource;

        [Tooltip("Volume of the voice clips (the story panel sets it from its theme).")]
        [Range(0f, 1f)] public float voiceVolume = 1f;

        [Tooltip("Optional translation sheet (a CSV like the package's Translations.csv, with a column per language). Empty: the package's. See NarrativeLocalization.")]
        public TextAsset translations;

        [Header("Saves")]
        [Tooltip("Save slots the story panel's Save and Load offer. 0 keeps the single quick save (SaveToPrefs).")]
        [Range(0, 9)] public int saveSlots = 3;
        [Tooltip("Keep an autosave (slot 0) each time the reader reaches a new passage, while the game plays.")]
        public bool autosave = true;
        [Tooltip("Optional component implementing ISaveStorage, for your game's own saves. Files in Application.persistentDataPath when empty.")]
        public MonoBehaviour saveStorage;

        [Serializable] public class LineEvent : UnityEvent<string, string> { }
        [Serializable] public class TextEvent : UnityEvent<string> { }
        [Serializable] public class VariableEvent : UnityEvent<string, string> { }

        [Header("Events (wire these up in the Inspector)")]
        [Tooltip("A line of the story: the speaker (empty for narration) and the text.")]
        public LineEvent onLine = new LineEvent();
        [Tooltip("Choices are waiting: call Choose(index).")]
        public UnityEvent onChoices = new UnityEvent();
        [Tooltip("A Continue break is waiting: call Continue().")]
        public UnityEvent onContinue = new UnityEvent();
        public UnityEvent onEnded = new UnityEvent();
        [Tooltip("A tag the story uses that Pen to Ink doesn't, e.g. #shake or #music:calm.")]
        public TextEvent onTag = new TextEvent();
        [Tooltip("A story variable or item changed: its name and new value.")]
        public VariableEvent onVariableChanged = new VariableEvent();
        [Tooltip("The dialogue reached an exit to the game: its name. Play your gameplay, then call Resume() or ResumeAt(passage).")]
        public TextEvent onExit = new TextEvent();
        [Tooltip("The game resumed the dialogue after an exit.")]
        public UnityEvent onResume = new UnityEvent();

        public struct Line
        {
            /// <summary>The speaker's name as written in the story, or null for narration.</summary>
            public string Speaker;
            /// <summary>The speaker's character id (the #speaker tag), e.g. for LoadPortrait; null for narration.</summary>
            public string SpeakerId;
            public string Text;
            public List<string> Tags;
            /// <summary>The scene heading this line opens (from #scene), or null.</summary>
            public string Scene;
            /// <summary>A stage direction for the speaker (from #paren), or null.</summary>
            public string Paren;
            /// <summary>The scene picture this line opens (file name from #image), or null. See LoadPicture.</summary>
            public string Image;
            /// <summary>A choice the player made (shown in the transcript), not story text.</summary>
            public bool IsChoice;
            public bool IsTransition;
            /// <summary>A cutscene line (from #cutscene): shown one at a time, going on by itself.</summary>
            public bool IsCutscene;
            /// <summary>The text, speaker, scene and stage direction as written (Text and the rest are in NarrativeLocalization.Language).</summary>
            public string SourceText, SourceSpeaker, SourceScene, SourceParen;
        }

        /// <summary>The text of a Continue break's only choice (see the Ink conventions).</summary>
        public const string ContinueText = "Continue";

        /// <summary>An exit to the game is a lone choice with this text before the exit's name (see the Ink conventions).</summary>
        public const string ExitPrefix = "Back to the game: ";

        public event Action<Line> LineShown;
        /// <summary>Real choices to make. A Continue break raises ContinueShown instead.</summary>
        public event Action<IReadOnlyList<Choice>> ChoicesShown;
        /// <summary>A Continue break: the reader continues (Continue()) to see what follows.</summary>
        public event Action ContinueShown;
        public event Action StoryEnded;
        public event Action<string> RuntimeError;
        /// <summary>The transcript was cleared (start, restart or load): redraw from scratch.</summary>
        public event Action Restarted;
        public event Action<string> StatusChanged;
        /// <summary>A tag on a line that isn't one of Pen to Ink's own (speaker, scene, paren, image, audio, transition).</summary>
        public event Action<string> TagFound;
        /// <summary>A story variable or item variable changed (name, new value). Raised for all of them after a load.</summary>
        public event Action<string, object> VariableChanged;
        /// <summary>
        /// The dialogue reached an exit to the game (its name, one of StoryInfo.Exits): it waits while your game
        /// plays, until you call Resume() to go on from here, or ResumeAt(passage) to go on somewhere else.
        /// Set story variables or items first (SetVariable, your inventory) to tell the story what happened.
        /// </summary>
        public event Action<string> ExitReached;
        /// <summary>The game resumed the dialogue after an exit.</summary>
        public event Action Resumed;

        public Story Story { get; private set; }
        public bool HasEnded { get; private set; }
        public IReadOnlyList<Line> Transcript => transcript;
        public string Status => status;
        /// <summary>The passage or line the story was started at (StartAt), or null when it started from the beginning.</summary>
        public string StartPassage { get; private set; }

        /// <summary>The story is at a Continue break: its only choice is Continue.</summary>
        public bool IsWaitingForContinue => Story != null && Story.currentChoices.Count == 1 && Story.currentChoices[0].text == ContinueText;

        /// <summary>The exit to the game the dialogue is waiting at, or null.</summary>
        public string CurrentExit => Story != null && Story.currentChoices.Count == 1 && Story.currentChoices[0].text.StartsWith(ExitPrefix, StringComparison.Ordinal) ? Story.currentChoices[0].text.Substring(ExitPrefix.Length) : null;

        /// <summary>The dialogue has handed over to the game and waits for Resume() or ResumeAt(passage).</summary>
        public bool IsAtExit => CurrentExit != null;

        /// <summary>The passage (ink knot, one of StoryInfo.Passages) the reader is in, or null before the story starts.</summary>
        public string CurrentPassage
        {
            get
            {
                if (Story != null && Story.currentChoices.Count > 0)
                {
                    var knot = KnotOf(Story.currentChoices[0].sourcePath);
                    if (knot != null) return knot;
                }
                return lastPassage;
            }
        }

        /// <summary>A choice the reader can't take yet: its text, and what it needs in plain words.</summary>
        public struct LockedChoice
        {
            public string Text;
            public string Needs;
        }

        /// <summary>
        /// The choices of the current passage that need an item or a value the reader doesn't have (see
        /// StoryInfo.GatedChoices). Ink leaves them out of Story.currentChoices; show them greyed out if you like.
        /// Empty at a Continue break, an exit or the ending.
        /// </summary>
        public IReadOnlyList<LockedChoice> LockedChoices
        {
            get
            {
                locked.Clear();
                if (Story == null || HasEnded || IsAtExit || IsWaitingForContinue || Story.currentChoices.Count == 0) return locked;
                var passage = CurrentPassage;
                // While a forced choice is on offer, it's the only way on: nothing is shown as locked.
                if (Story.currentChoices.Exists(c => System.Array.IndexOf(StoryInfo.ForcedChoices, passage + "\n" + c.text) >= 0)) return locked;
                foreach (var g in StoryInfo.GatedChoices)
                {
                    if (g.Passage != passage || Story.currentChoices.Exists(c => c.text == g.Text)) continue;
                    var missing = g.Missing(ReadVariable);
                    if (missing.Length == 0) continue;
                    for (int i = 0; i < missing.Length; i++) missing[i] = NarrativeLocalization.Translate(missing[i]);
                    locked.Add(new LockedChoice { Text = NarrativeLocalization.Translate(g.Text), Needs = string.Join(", ", missing) });
                }
                return locked;
            }
        }

        readonly List<LockedChoice> locked = new List<LockedChoice>();
        string lastPassage;

        /// <summary>A story variable's value by name, or null (for conditions; GetVariable checks the name).</summary>
        object ReadVariable(string name)
        {
            if (Story == null || !Story.variablesState.GlobalVariableExistsWithName(name)) return null;
            return Story.variablesState[name];
        }

        static string KnotOf(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            var dot = path.IndexOf('.');
            var knot = dot < 0 ? path : path.Substring(0, dot);
            return Array.IndexOf(StoryInfo.Passages, knot) >= 0 ? knot : null;
        }

        void NotePassage()
        {
            var knot = KnotOf(Story.state.currentPathString);
            if (knot != null) lastPassage = knot;
        }

        const string SaveKey = "NarrativeBridge.Save." + StoryInfo.ProjectId;
        const string ChosenKey = "NarrativeBridge.Chosen." + StoryInfo.ProjectId;
        HashSet<string> chosenBefore;

        /// <summary>The id the story gave a choice (its #id tag inside the brackets), or null for a story written before ids.</summary>
        static string ChoiceId(Choice choice)
        {
            if (choice?.tags == null) return null;
            foreach (var t in choice.tags)
                if (t.StartsWith("id:", StringComparison.Ordinal)) return t.Substring(3).Trim();
            return null;
        }

        /// <summary>How a choice was remembered before ids: its passage and its text as written ("harbour|Take the boat").</summary>
        static string LegacyChosenKey(Choice choice)
        {
            var path = choice.sourcePath ?? "";
            var dot = path.IndexOf('.');
            return (dot < 0 ? path : path.Substring(0, dot)) + "|" + choice.text.Trim();
        }

        /// <summary>How a choice is remembered now: by its id, which survives rewording; by passage and text when it has none.</summary>
        static string ChosenKeyOf(Choice choice)
        {
            var id = ChoiceId(choice);
            return id != null ? "id:" + id : LegacyChosenKey(choice);
        }

        /// <summary>Marks a choice's id inside a saved choice path entry: "\u0001id\u0001text". An entry without it is just the text (a save from before ids).</summary>
        const char IdMark = '\u0001';

        /// <summary>A save's choice path entry for a choice: its id and its text, so a later version of the story can find it by either.</summary>
        static string PathEntryOf(Choice choice)
        {
            var id = ChoiceId(choice);
            return id == null ? choice.text : IdMark + id + IdMark + choice.text;
        }

        /// <summary>Splits a choice path entry into its id (null for an older save) and its text.</summary>
        static void SplitPathEntry(string entry, out string id, out string text)
        {
            id = null;
            text = entry;
            if (entry.Length > 1 && entry[0] == IdMark)
            {
                var end = entry.IndexOf(IdMark, 1);
                if (end > 0) { id = entry.Substring(1, end - 1); text = entry.Substring(end + 1); }
            }
        }

        HashSet<string> ChosenBefore
        {
            get
            {
                if (chosenBefore == null)
                {
                    chosenBefore = new HashSet<string>();
                    foreach (var k in PlayerPrefs.GetString(ChosenKey, "").Split('\n'))
                        if (k.Length > 0) chosenBefore.Add(k);
                }
                return chosenBefore;
            }
        }

        /// <summary>
        /// True if the player has taken this choice before, in this read or an earlier one (kept in PlayerPrefs, through
        /// Restart). The demo UI greys these out but keeps them clickable. A choice is known by the id the story gave it, so rewording
        /// it keeps the mark; one made before ids (or in a story without them) by its passage and its text.
        /// </summary>
        public bool WasChosen(Choice choice)
        {
            if (choice == null) return false;
            var key = ChosenKeyOf(choice);
            if (ChosenBefore.Contains(key)) return true;
            if (!ChosenBefore.Contains(LegacyChosenKey(choice))) return false;
            // Remembered by its words, before the story had ids: from now on by its id too, so rewording it keeps the mark.
            if (ChosenBefore.Add(key)) PlayerPrefs.SetString(ChosenKey, string.Join("\n", ChosenBefore));
            return true;
        }

        /// <summary>Forgets which choices were taken before, so every choice looks new again.</summary>
        public void ForgetChosen()
        {
            ChosenBefore.Clear();
            PlayerPrefs.DeleteKey(ChosenKey);
        }

        void RememberChosen(Choice choice)
        {
            if (!ChosenBefore.Add(ChosenKeyOf(choice))) return;
            PlayerPrefs.SetString(ChosenKey, string.Join("\n", ChosenBefore));
        }
        readonly List<Line> transcript = new List<Line>();
        IInventoryAuthority authority;
        AudioSource voice;
        // Voice clips to play in order; one may still be loading (Addressables).
        class VoiceItem
        {
            public AudioClip Clip;
            public bool Loading;
        }
        readonly Queue<VoiceItem> voiceQueue = new Queue<VoiceItem>();
        bool syncing, silent;
        string status = "";
        Vector2 scroll;

        // The text of every choice made since the start, so a save can carry over to a revised story.
        readonly List<string> choicePath = new List<string>();

        /// <summary>Set by TryLoadState when it carried a save over from another story version; null otherwise.</summary>
        public string LoadNote { get; private set; }

        [Serializable]
        class SaveData
        {
            public string storyVersion;
            public string inkState;
            public List<string> choicePath;
            public string startPassage;
            // For save slots: when, where, and the last line read.
            public string savedAt;
            public string passage;
            public string excerpt;
        }

        void Awake()
        {
            authority = inventoryAuthority as IInventoryAuthority;
            if (inventoryAuthority != null && authority == null)
                Debug.LogError("[NarrativeBridge] inventoryAuthority does not implement IInventoryAuthority.", this);
            voice = voiceSource != null ? voiceSource : GetComponent<AudioSource>();
            if (voice == null) voice = gameObject.AddComponent<AudioSource>();
            voice.playOnAwake = false;
            if (translations != null) NarrativeLocalization.UseSheet(translations);
            if (startOnAwake) StartStory();
        }

        void OnEnable() => NarrativeLocalization.Changed += Relocalize;
        void OnDisable() => NarrativeLocalization.Changed -= Relocalize;

        /// <summary>Puts the transcript into the current language again (after NarrativeLocalization.Language changes).</summary>
        public void Relocalize()
        {
            for (int i = 0; i < transcript.Count; i++) transcript[i] = Localize(transcript[i]);
        }

        static Line Localize(Line l)
        {
            l.Text = NarrativeLocalization.Translate(l.SourceText ?? l.Text);
            if (l.SourceSpeaker != null) l.Speaker = NarrativeLocalization.Translate(l.SourceSpeaker);
            if (l.SourceScene != null) l.Scene = NarrativeLocalization.Translate(l.SourceScene);
            if (l.SourceParen != null) l.Paren = NarrativeLocalization.Translate(l.SourceParen);
            return l;
        }

        /// <summary>A choice's text in the current language (choose it by index with Choose).</summary>
        public static string ChoiceText(Choice choice) => NarrativeLocalization.Translate(choice.text);

        /// <summary>Starts (or restarts) the story from the beginning.</summary>
        public void StartStory() => Begin(null);

        /// <summary>
        /// Starts (or restarts) the story at a passage, e.g. when the player talks to someone (see StoryInfo.Passages),
        /// or at a line of dialogue in one, "passage.line_…" (see StoryInfo.Lines), to pick a conversation up partway.
        /// </summary>
        public void StartAt(string passage)
        {
            if (!IsStartPoint(passage)) { ReportError("There is no passage or line called " + passage + "."); return; }
            Begin(passage);
        }

        /// <summary>Starts (or restarts) the story at a line of dialogue in a passage: StartAt(passage + "." + line).</summary>
        public void StartAtLine(string passage, string line) => StartAt(string.IsNullOrEmpty(line) ? passage : passage + "." + line);

        /// <summary>Whether the story can start at (or jump to) this name: one of StoryInfo.Passages or StoryInfo.Lines.</summary>
        public static bool IsStartPoint(string name) =>
            !string.IsNullOrEmpty(name) && (Array.IndexOf(StoryInfo.Passages, name) >= 0 || Array.IndexOf(StoryInfo.Lines, name) >= 0);

        /// <summary>The passage a start point is in: the name itself, or the passage of a line ("garden" for "garden.line_…").</summary>
        public static string PassageOf(string name)
        {
            if (string.IsNullOrEmpty(name)) return name;
            var dot = name.IndexOf('.');
            return dot < 0 ? name : name.Substring(0, dot);
        }

        // A line is reached through its entry knot, "passage__line_…", which diverts to the line's label in the
        // passage (a label after a Continue break sits inside the weave, where a path can't name it).
        static string InkPathOf(string name) => Array.IndexOf(StoryInfo.Lines, name) >= 0 ? name.Replace(".", "__") : name;

        void Begin(string passage)
        {
            string json = null;
#if NARRATIVE_BRIDGE_INK_FILE
            if (inkFile != null && inkFile.isCompiled) json = inkFile.storyJson;
            else if (inkFile != null) Debug.LogWarning("[NarrativeBridge] " + inkFile.name + " has not compiled; using the story in the package.", this);
#endif
            if (json == null)
            {
                var asset = storyJson != null ? storyJson : Resources.Load<TextAsset>(StoryInfo.CompiledResource);
                if (asset != null) json = asset.text;
            }
            if (json == null)
            {
                ReportError("No compiled story found. Assign storyJson or keep Resources/" + StoryInfo.CompiledResource + ".json.");
                return;
            }
            Story = new Story(json);
            Story.onError += (message, type) =>
            {
                if (type == Ink.ErrorType.Error) ReportError(message);
                else Debug.LogWarning("[NarrativeBridge] " + message);
            };
            foreach (var v in StoryInfo.ItemVariables) Story.ObserveVariable(v, OnVariableObserved);
            foreach (var v in StoryInfo.Variables) Story.ObserveVariable(v, OnVariableObserved);
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            StartPassage = passage;
            lastPassage = PassageOf(passage);
            SetStatus("");
            StopVoice();
            if (passage != null) Story.ChoosePathString(InkPathOf(passage));
            Restarted?.Invoke();
            Advance();
        }

        /// <summary>Goes on past a Continue break.</summary>
        public void Continue()
        {
            if (IsWaitingForContinue) Choose(0);
        }

        /// <summary>Goes on after an exit to the game, from where the dialogue left off.</summary>
        public void Resume()
        {
            if (!IsAtExit) return;
            Resumed?.Invoke();
            onResume.Invoke();
            Choose(0);
        }

        /// <summary>
        /// Goes on after an exit at another passage (e.g. "won_fight" or "lost_fight"), keeping the story's
        /// variables and items. Also works when the dialogue isn't at an exit, to jump there. See StoryInfo.Passages;
        /// a line of dialogue, "passage.line_…" (StoryInfo.Lines), goes on from that line.
        /// </summary>
        public void ResumeAt(string passage)
        {
            if (Story == null) return;
            if (!IsStartPoint(passage)) { ReportError("There is no passage or line called " + passage + "."); return; }
            var exited = IsAtExit;
            // Saves record the jump, so a save carries over to a revised story too.
            choicePath.Add(JumpMark + passage);
            lastPassage = PassageOf(passage);
            Story.ChoosePathString(InkPathOf(passage));
            StopVoice();
            if (exited) { Resumed?.Invoke(); onResume.Invoke(); }
            Advance();
        }

        /// <summary>
        /// Enters the dialogue at a passage or a line of dialogue ("passage.line_…", see StoryInfo.Lines), e.g. when the
        /// player talks to someone again: the page starts afresh there, but the story keeps what it knows (its variables
        /// and items) from before. The first time, it starts the story there (StartAt).
        /// </summary>
        public void EnterAt(string name)
        {
            if (Story == null) { StartAt(name); return; }
            if (!IsStartPoint(name)) { ReportError("There is no passage or line called " + name + "."); return; }
            var exited = IsAtExit;
            // Saved as a jump, like ResumeAt, so a save carries over to a revised story.
            choicePath.Add(JumpMark + name);
            transcript.Clear();
            HasEnded = false;
            lastPassage = PassageOf(name);
            SetStatus("");
            StopVoice();
            Story.ChoosePathString(InkPathOf(name));
            Restarted?.Invoke();
            if (exited) { Resumed?.Invoke(); onResume.Invoke(); }
            Advance();
        }

        /// <summary>Whether the player has an item (an id from StoryInfo.ItemVariables, without "has_"): your inventory's answer, or the story's.</summary>
        public bool HasItem(string itemId)
        {
            if (authority != null) return authority.HasItem(itemId);
            var name = "has_" + itemId;
            return Story != null && Array.IndexOf(StoryInfo.ItemVariables, name) >= 0 && Story.variablesState[name] is bool b && b;
        }

        /// <summary>How a jump (ResumeAt) is written in a save's choice path.</summary>
        const string JumpMark = "→";

        public void Choose(int index)
        {
            if (Story == null || index < 0 || index >= Story.currentChoices.Count) return;
            // A Continue break or an exit leaves no trace in the transcript: the page simply goes on.
            if (!IsWaitingForContinue && !IsAtExit)
                RememberChosen(Story.currentChoices[index]);
            if (!IsWaitingForContinue && !IsAtExit)
                transcript.Add(Localize(new Line { Speaker = null, Text = Story.currentChoices[index].text, SourceText = Story.currentChoices[index].text, Tags = new List<string> { "choice" }, IsChoice = true }));
            choicePath.Add(PathEntryOf(Story.currentChoices[index]));
            Story.ChooseChoiceIndex(index);
            StopVoice();
            Advance();
        }

        void Advance()
        {
            SyncFromAuthority();
            while (Story.canContinue)
            {
                NotePassage();
                var raw = Story.Continue().Trim();
                if (raw.Length == 0)
                {
                    // A tag with no text after it (a cue at the end of a passage) still reaches the game.
                    foreach (var t in Story.currentTags)
                        if (!IsStoryTag(t)) { TagFound?.Invoke(t); onTag.Invoke(t); }
                    continue;
                }
                var line = ParseLine(raw, new List<string>(Story.currentTags));
                transcript.Add(line);
                QueueVoice(line);
                LineShown?.Invoke(line);
                onLine.Invoke(line.Speaker ?? "", line.Text);
                foreach (var t in line.Tags)
                    if (!IsStoryTag(t)) { TagFound?.Invoke(t); onTag.Invoke(t); }
            }
            AutosaveIfNewPassage();
            if (IsAtExit) { ExitReached?.Invoke(CurrentExit); onExit.Invoke(CurrentExit); }
            else if (IsWaitingForContinue) { ContinueShown?.Invoke(); onContinue.Invoke(); }
            else if (Story.currentChoices.Count > 0) { ChoicesShown?.Invoke(Story.currentChoices); onChoices.Invoke(); }
            else
            {
                HasEnded = true;
                StoryEnded?.Invoke();
                onEnded.Invoke();
            }
        }

        // An autosave each time the reader reaches a new passage (only while the game plays).
        void AutosaveIfNewPassage()
        {
            if (!autosave || !Application.isPlaying || silent || Story == null) return;
            var passage = CurrentPassage;
            if (passage == null || passage == autosavedPassage) return;
            autosavedPassage = passage;
            SaveToSlot(AutosaveSlot);
        }

        static bool IsStoryTag(string t) =>
            t == "transition" || t == "cutscene" || t.StartsWith("speaker:") || t.StartsWith("scene:") || t.StartsWith("paren:") || t.StartsWith("ext:") || t.StartsWith("image:") || t.StartsWith("audio:") || t.StartsWith("id:");

        // ---- Voice clips: lines tagged #audio:<file> play in order --------------------------

        void QueueVoice(Line line)
        {
            if (!playVoiceClips || voice == null) return;
            foreach (var t in line.Tags)
            {
                if (!t.StartsWith("audio:")) continue;
                var item = new VoiceItem { Loading = true };
                voiceQueue.Enqueue(item);
                LoadVoiceClipAsync(t.Substring(6).Trim(), clip => { item.Clip = clip; item.Loading = false; });
            }
        }

        void StopVoice()
        {
            voiceQueue.Clear();
            if (voice != null) voice.Stop();
        }

        void Update()
        {
            // The next clip plays when the last has finished (and once it has loaded).
            while (voice != null && !voice.isPlaying && voiceQueue.Count > 0 && !voiceQueue.Peek().Loading)
            {
                var next = voiceQueue.Dequeue();
                if (next.Clip == null) continue;
                voice.clip = next.Clip;
                voice.volume = voiceVolume;
                voice.Play();
            }
        }

        static Line ParseLine(string raw, List<string> tags)
        {
            string speaker = null, speakerId = null, scene = null, paren = null, image = null;
            var transition = false;
            var cutscene = false;
            foreach (var t in tags)
            {
                if (t.StartsWith("speaker:")) speaker = speakerId = t.Substring(8).Trim();
                else if (t.StartsWith("scene:")) scene = t.Substring(6).Trim();
                else if (t.StartsWith("paren:")) paren = t.Substring(6).Trim();
                else if (t.StartsWith("image:")) image = t.Substring(6).Trim();
                else if (t == "transition") transition = true;
                else if (t == "cutscene") cutscene = true;
            }
            var text = raw;
            if (speaker != null)
            {
                var colon = raw.IndexOf(": ", StringComparison.Ordinal);
                if (colon > 0) { speaker = raw.Substring(0, colon); text = raw.Substring(colon + 2); }
            }
            return Localize(new Line { Speaker = speaker, SpeakerId = speakerId, Text = text, Tags = tags, Scene = scene, Paren = paren, Image = image, IsTransition = transition, IsCutscene = cutscene, SourceText = text, SourceSpeaker = speaker, SourceScene = scene, SourceParen = paren });
        }

        // ---- Scene pictures: the first line of a scene may carry #image:<file> ----------------

        static readonly Dictionary<string, Texture2D> pictures = new Dictionary<string, Texture2D>();
        static readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();

        // ---- Loading voice clips and pictures: from Resources, or on demand with Addressables ------

        /// <summary>
        /// The picture for an #image file name, or null. Pictures ship as their PNG or JPEG bytes (StoryInfo.ImageFolder +
        /// file + ".bytes" in Resources, or AddressPrefix + "Images/" + file with Addressables) and are decoded once, then
        /// kept. With Addressables this waits for the load; LoadPictureAsync doesn't (needed on WebGL).
        /// </summary>
        public static Texture2D LoadPicture(string file)
        {
            if (string.IsNullOrEmpty(file)) return null;
            if (pictures.TryGetValue(file, out var cached) && cached != null) return cached;
            if (!StoryInfo.UsesAddressables) return Decode(file, Resources.Load<TextAsset>(StoryInfo.ImageFolder + file), true);
#if UNITY_EDITOR
            // Outside Play mode Addressables has no content to load from: read the package's file itself.
            if (!Application.isPlaying) return Decode(file, UnityEditor.AssetDatabase.LoadAssetAtPath<TextAsset>(StoryInfo.StoryAssetsFolder + "Images/" + file + ".bytes"), false);
#endif
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<TextAsset>(StoryInfo.AddressPrefix + "Images/" + file);
            var data = handle.WaitForCompletion();
            var texture = Decode(file, handle.Status == AsyncOperationStatus.Succeeded ? data : null, false);
            Addressables.Release(handle);
            return texture;
#else
            NoAddressables();
            return null;
#endif
        }

        /// <summary>Loads a picture without waiting, then calls done with it (or null). At once when it's already loaded.</summary>
        public static void LoadPictureAsync(string file, Action<Texture2D> done)
        {
            if (string.IsNullOrEmpty(file)) { done(null); return; }
            if ((pictures.TryGetValue(file, out var cached) && cached != null) || !StoryInfo.UsesAddressables || !Application.isPlaying) { done(LoadPicture(file)); return; }
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<TextAsset>(StoryInfo.AddressPrefix + "Images/" + file);
            handle.Completed += op =>
            {
                var texture = pictures.TryGetValue(file, out var c) && c != null ? c : Decode(file, op.Status == AsyncOperationStatus.Succeeded ? op.Result : null, false);
                Addressables.Release(op);
                done(texture);
            };
#else
            NoAddressables();
            done(null);
#endif
        }

        static Texture2D Decode(string file, TextAsset data, bool fromResources)
        {
            if (data == null) return null;
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = file, wrapMode = TextureWrapMode.Clamp };
            // Keep no CPU copy once it's on the GPU (there is no GPU when the editor runs headless).
            var ok = texture.LoadImage(data.bytes, SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null);
            if (fromResources) Resources.UnloadAsset(data);
            if (!ok) return null;
            pictures[file] = texture;
            return texture;
        }

        static string ClipName(string file)
        {
            var dot = file.LastIndexOf('.');
            return dot > 0 ? file.Substring(0, dot) : file;
        }

        /// <summary>A voice clip by its #audio file name, or null. With Addressables this waits for the load.</summary>
        public static AudioClip LoadVoiceClip(string file)
        {
            var name = ClipName(file);
            if (clips.TryGetValue(name, out var cached) && cached != null) return cached;
            AudioClip clip = null;
            if (!StoryInfo.UsesAddressables) clip = Resources.Load<AudioClip>(StoryInfo.AudioFolder + name);
#if UNITY_EDITOR
            else if (!Application.isPlaying)
            {
                // Outside Play mode Addressables has no content to load from: find the package's clip itself.
                foreach (var guid in UnityEditor.AssetDatabase.FindAssets(name + " t:AudioClip", new[] { StoryInfo.StoryAssetsFolder + "Audio" }))
                {
                    var path = UnityEditor.AssetDatabase.GUIDToAssetPath(guid);
                    if (System.IO.Path.GetFileNameWithoutExtension(path) == name) { clip = UnityEditor.AssetDatabase.LoadAssetAtPath<AudioClip>(path); break; }
                }
            }
#endif
            else
            {
#if NARRATIVE_BRIDGE_ADDRESSABLES
                var handle = Addressables.LoadAssetAsync<AudioClip>(StoryInfo.AddressPrefix + "Audio/" + name);
                clip = handle.WaitForCompletion();
                if (handle.Status != AsyncOperationStatus.Succeeded) clip = null;
                else loadedClips.Add(handle);
#else
                NoAddressables();
#endif
            }
            if (clip != null) clips[name] = clip;
            return clip;
        }

        /// <summary>Loads a voice clip without waiting, then calls done with it (or null). At once when it's already loaded.</summary>
        public static void LoadVoiceClipAsync(string file, Action<AudioClip> done)
        {
            var name = ClipName(file);
            if ((clips.TryGetValue(name, out var cached) && cached != null) || !StoryInfo.UsesAddressables || !Application.isPlaying)
            {
                var clip = LoadVoiceClip(file);
                if (clip == null) Debug.LogWarning("[NarrativeBridge] Voice clip not found: " + file);
                done(clip);
                return;
            }
#if NARRATIVE_BRIDGE_ADDRESSABLES
            var handle = Addressables.LoadAssetAsync<AudioClip>(StoryInfo.AddressPrefix + "Audio/" + name);
            handle.Completed += op =>
            {
                AudioClip clip = null;
                if (op.Status == AsyncOperationStatus.Succeeded) { clip = op.Result; clips[name] = clip; loadedClips.Add(op); }
                else Debug.LogWarning("[NarrativeBridge] Voice clip not found in Addressables: " + StoryInfo.AddressPrefix + "Audio/" + name);
                done(clip);
            };
#else
            NoAddressables();
            done(null);
#endif
        }

#if NARRATIVE_BRIDGE_ADDRESSABLES
        static readonly List<AsyncOperationHandle<AudioClip>> loadedClips = new List<AsyncOperationHandle<AudioClip>>();
#endif

        /// <summary>Lets go of every voice clip and picture loaded so far (they load again when needed), e.g. between chapters.</summary>
        public static void ReleaseLoadedMedia()
        {
            foreach (var t in pictures.Values)
            {
                if (t == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(t);
                else UnityEngine.Object.DestroyImmediate(t);
            }
            pictures.Clear();
            clips.Clear();
#if NARRATIVE_BRIDGE_ADDRESSABLES
            foreach (var h in loadedClips) if (h.IsValid()) Addressables.Release(h);
            loadedClips.Clear();
#endif
        }

#if !NARRATIVE_BRIDGE_ADDRESSABLES
        static bool warnedAddressables;
        static void NoAddressables()
        {
            if (warnedAddressables) return;
            warnedAddressables = true;
            Debug.LogError("[NarrativeBridge] This story loads its voice clips and pictures with Addressables, but the Addressables package (com.unity.addressables) isn't installed.");
        }
#endif

        /// <summary>A character's portrait file name (in StoryInfo.ImageFolder), by speaker id, or null.</summary>
        public static string PortraitFile(string speakerId)
        {
            var i = speakerId == null ? -1 : Array.IndexOf(StoryInfo.PortraitSpeakers, speakerId);
            return i >= 0 ? StoryInfo.PortraitFiles[i] : null;
        }

        /// <summary>A character's portrait, by speaker id (Line.SpeakerId), or null if they have none.</summary>
        public static Texture2D LoadPortrait(string speakerId) => LoadPicture(PortraitFile(speakerId));

        /// <summary>The picture of the scene the reader is in: the latest #image in the transcript, or null.</summary>
        public string CurrentPicture
        {
            get
            {
                for (int i = transcript.Count - 1; i >= 0; i--) if (transcript[i].Image != null) return transcript[i].Image;
                return null;
            }
        }

        // ---- Variables -------------------------------------------------------------------

        public object GetVariable(string name)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0 && Array.IndexOf(StoryInfo.ItemVariables, name) < 0)
                throw new ArgumentException("Not an approved story variable: " + name);
            return Story.variablesState[name];
        }

        public void SetVariable(string name, object value)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0)
                throw new ArgumentException("Not a writable story variable: " + name);
            Story.variablesState[name] = value;
        }

        void OnVariableObserved(string name, object value)
        {
            if (Array.IndexOf(StoryInfo.ItemVariables, name) >= 0) OnItemVariableChanged(name, value);
            if (silent) return;
            VariableChanged?.Invoke(name, value);
            onVariableChanged.Invoke(name, value == null ? "" : value.ToString());
        }

        /// <summary>Tells listeners the value of every variable, e.g. after a load.</summary>
        void RaiseAllVariables()
        {
            if (Story == null) return;
            foreach (var v in StoryInfo.ItemVariables) OnVariableObserved(v, Story.variablesState[v]);
            foreach (var v in StoryInfo.Variables) OnVariableObserved(v, Story.variablesState[v]);
        }

        // ---- Inventory synchronisation: the host game is the single source of truth -------

        void SyncFromAuthority()
        {
            if (authority == null || Story == null) return;
            syncing = true;
            foreach (var v in StoryInfo.ItemVariables)
                Story.variablesState[v] = authority.HasItem(v.Substring(4));
            syncing = false;
        }

        void OnItemVariableChanged(string variableName, object newValue)
        {
            if (syncing || authority == null) return;
            var itemId = variableName.Substring(4);
            if (newValue is bool has)
            {
                if (has) authority.GiveItem(itemId);
                else authority.TakeItem(itemId);
            }
        }

        // ---- Save / load with story-version checks ----------------------------------------

        /// <summary>Saves to PlayerPrefs (one slot per story), as the demo's Save button does.</summary>
        public void SaveToPrefs()
        {
            if (Story == null) return;
            PlayerPrefs.SetString(SaveKey, SaveState());
            SetStatus("Saved.");
        }

        /// <summary>Loads the PlayerPrefs slot, as the demo's Load button does. The outcome is in Status.</summary>
        public void LoadFromPrefs()
        {
            if (Story == null) return;
            SetStatus(TryLoadState(PlayerPrefs.GetString(SaveKey, ""), out var err) ? LoadNote ?? "Loaded." : err);
        }

        // ---- Save slots: several saves and an autosave, through ISaveStorage --------------------

        /// <summary>The autosave's slot number; the player's slots are 1 to saveSlots.</summary>
        public const int AutosaveSlot = 0;

        /// <summary>What a save slot holds: when it was saved, where, and the last line read.</summary>
        public struct SlotInfo
        {
            public int Slot;
            public bool Exists;
            public DateTime SavedAt;
            public string Passage;
            public string PassageTitle;
            public string Excerpt;
            /// <summary>The save is from an earlier version of the story (it loads by replaying its choices).</summary>
            public bool OtherVersion;
        }

        /// <summary>Where slots are kept: Save Storage when set, else files (see FileSaveStorage). Settable from code.</summary>
        public ISaveStorage Storage
        {
            get
            {
                if (storage == null) storage = saveStorage as ISaveStorage ?? new FileSaveStorage();
                return storage;
            }
            set => storage = value;
        }

        /// <summary>Raised after a slot is saved (its number; AutosaveSlot for the autosave).</summary>
        public event Action<int> Saved;

        ISaveStorage storage;
        string autosavedPassage;

        static string SlotKey(int slot) => slot == AutosaveSlot ? "autosave" : "slot-" + slot;

        public SlotInfo GetSlot(int slot)
        {
            var info = new SlotInfo { Slot = slot };
            string json = null;
            try { json = Storage.Read(SlotKey(slot)); } catch (Exception e) { Debug.LogWarning("[NarrativeBridge] Could not read save slot " + slot + ": " + e.Message); }
            if (string.IsNullOrEmpty(json)) return info;
            SaveData data = null;
            try { data = JsonUtility.FromJson<SaveData>(json); } catch { }
            if (data == null || string.IsNullOrEmpty(data.inkState)) return info;
            info.Exists = true;
            DateTime.TryParse(data.savedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out info.SavedAt);
            info.Passage = data.passage;
            var i = string.IsNullOrEmpty(data.passage) ? -1 : Array.IndexOf(StoryInfo.Passages, data.passage);
            info.PassageTitle = i >= 0 ? StoryInfo.PassageTitles[i] : data.passage;
            info.Excerpt = data.excerpt;
            info.OtherVersion = data.storyVersion != StoryInfo.StoryVersion;
            return info;
        }

        /// <summary>The autosave and every player slot, in order (slot 0 is the autosave).</summary>
        public List<SlotInfo> GetSlots()
        {
            var list = new List<SlotInfo>();
            for (int i = 0; i <= saveSlots; i++) list.Add(GetSlot(i));
            return list;
        }

        public void SaveToSlot(int slot)
        {
            if (Story == null) return;
            try
            {
                Storage.Write(SlotKey(slot), SaveState());
                if (slot != AutosaveSlot) SetStatus("Saved to slot " + slot + ".");
                Saved?.Invoke(slot);
            }
            catch (Exception e) { ReportError("Could not save: " + e.Message); }
        }

        /// <summary>Loads a slot; false (with the reason in Status) when it's empty or can't be loaded.</summary>
        public bool LoadFromSlot(int slot)
        {
            string json = null;
            try { json = Storage.Read(SlotKey(slot)); } catch (Exception e) { SetStatus("Could not read the save: " + e.Message); return false; }
            if (string.IsNullOrEmpty(json)) { SetStatus("That slot is empty."); return false; }
            var ok = TryLoadState(json, out var err);
            SetStatus(ok ? LoadNote ?? (slot == AutosaveSlot ? "Loaded the autosave." : "Loaded slot " + slot + ".") : err);
            autosavedPassage = CurrentPassage;
            return ok;
        }

        public void DeleteSlot(int slot)
        {
            try { Storage.Delete(SlotKey(slot)); } catch (Exception e) { Debug.LogWarning("[NarrativeBridge] Could not delete save slot " + slot + ": " + e.Message); }
        }

        string Excerpt()
        {
            for (int i = transcript.Count - 1; i >= 0; i--)
            {
                if (transcript[i].IsChoice || string.IsNullOrEmpty(transcript[i].Text)) continue;
                var t = (transcript[i].Speaker != null ? transcript[i].Speaker + ": " : "") + transcript[i].Text;
                return t.Length > 90 ? t.Substring(0, 87) + "..." : t;
            }
            return "";
        }

        /// <summary>The story's state as a string, to keep in your own save system.</summary>
        public string SaveState()
        {
            return JsonUtility.ToJson(new SaveData
            {
                storyVersion = StoryInfo.StoryVersion,
                inkState = Story.state.ToJson(),
                choicePath = new List<string>(choicePath),
                startPassage = StartPassage ?? "",
                savedAt = DateTime.UtcNow.ToString("o"),
                passage = CurrentPassage ?? "",
                excerpt = Excerpt(),
            });
        }

        public bool TryLoadState(string saveJson, out string error)
        {
            error = null;
            LoadNote = null;
            SaveData data = null;
            try { data = JsonUtility.FromJson<SaveData>(saveJson); } catch (Exception e) { error = "Save data is corrupt: " + e.Message; return false; }
            if (data == null || string.IsNullOrEmpty(data.inkState)) { error = "Save data is empty."; return false; }
            if (Story == null) StartStory();
            if (Story == null) { error = "The story could not start."; return false; }
            StartPassage = string.IsNullOrEmpty(data.startPassage) ? null : data.startPassage;
            if (data.storyVersion != StoryInfo.StoryVersion)
            {
                // Saves from before choices were recorded can't be carried over (JsonUtility turns a
                // missing list into an empty one, so look for the field itself).
                if (data.choicePath == null || saveJson.IndexOf("\"choicePath\"", StringComparison.Ordinal) < 0)
                {
                    error = "This save was made with story version " + data.storyVersion + " but the game now has " + StoryInfo.StoryVersion + ". Restart the narrative.";
                    return false;
                }
                ReplayChoices(data.choicePath, data.storyVersion);
                return true;
            }
            Story.state.LoadJson(data.inkState);
            choicePath.Clear();
            if (data.choicePath != null) choicePath.AddRange(data.choicePath);
            transcript.Clear();
            HasEnded = false;
            Restarted?.Invoke();
            RaiseAllVariables();
            if (Story.canContinue) Advance();
            else if (IsAtExit) { ExitReached?.Invoke(CurrentExit); onExit.Invoke(CurrentExit); }
            else if (IsWaitingForContinue) { ContinueShown?.Invoke(); onContinue.Invoke(); }
            else if (Story.currentChoices.Count > 0) { ChoicesShown?.Invoke(Story.currentChoices); onChoices.Invoke(); }
            return true;
        }

        // A save from another version of the story: play the new version from the start (or the passage
        // it was started at), silently, making the same choices (matched by their id when the save and the story both have ids, else by their text), so its text and
        // variables apply. Stops at the first choice the new version no longer offers.
        void ReplayChoices(List<string> path, string savedVersion)
        {
            Story.ResetState();
            if (IsStartPoint(StartPassage)) Story.ChoosePathString(InkPathOf(StartPassage));
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            StopVoice();
            var followed = 0;
            syncing = true; // the host's inventory is already where the save left it
            silent = true;
            try
            {
                // Continue breaks added or removed since the save don't stop it: take or skip them.
                for (int i = 0, steps = 0; i < path.Count && steps < 10000; steps++)
                {
                    var before = Story.state.ToJson();
                    while (Story.canContinue) Story.Continue();
                    if (path[i].StartsWith(JumpMark, StringComparison.Ordinal))
                    {
                        // A jump the game made with ResumeAt.
                        var target = path[i].Substring(JumpMark.Length);
                        if (!IsStartPoint(target)) break;
                        Story.ChoosePathString(InkPathOf(target));
                        choicePath.Add(path[i]);
                        followed++;
                        i++;
                        continue;
                    }
                    SplitPathEntry(path[i], out var wantId, out var wantText);
                    var match = (wantId != null ? Story.currentChoices.Find(c => ChoiceId(c) == wantId) : null) ?? Story.currentChoices.Find(c => c.text == wantText);
                    if (match != null)
                    {
                        Story.ChooseChoiceIndex(match.index);
                        choicePath.Add(PathEntryOf(match));
                        followed++;
                        i++;
                    }
                    else if (IsWaitingForContinue)
                    {
                        Story.ChooseChoiceIndex(0);
                        choicePath.Add(ContinueText);
                    }
                    else if (wantText == ContinueText)
                    {
                        followed++;
                        i++;
                    }
                    else { Story.state.LoadJson(before); break; }
                }
            }
            finally { syncing = false; silent = false; }
            Restarted?.Invoke();
            RaiseAllVariables();
            LoadNote = followed == path.Count
                ? "Carried this save over from story version " + savedVersion + ": all " + path.Count + " choices replayed."
                : "Carried this save over from story version " + savedVersion + ": " + followed + " of " + path.Count + " choices still exist, so it resumes after the last one that does.";
            Advance();
        }

        void ReportError(string message)
        {
            Debug.LogError("[NarrativeBridge] " + message, this);
            SetStatus(message);
            RuntimeError?.Invoke(message);
        }

        void SetStatus(string message)
        {
            status = message ?? "";
            StatusChanged?.Invoke(status);
        }

        // ---- Demo UI ---------------------------------------------------------------------

        void OnGUI()
        {
            if (!drawDemoUI) return;
            var w = Mathf.Min(720, Screen.width - 40);
            GUILayout.BeginArea(new Rect((Screen.width - w) / 2, 20, w, Screen.height - 40));
            GUILayout.Label("<size=20><b>" + StoryInfo.Title + "</b></size>", new GUIStyle(GUI.skin.label) { richText = true });
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            var style = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true, fontSize = 15 };
            foreach (var l in transcript)
            {
                if (l.IsChoice) GUILayout.Label("<i>> " + l.Text + "</i>", style);
                else if (l.Speaker != null) GUILayout.Label("<b>" + l.Speaker + "</b>  " + l.Text, style);
                else GUILayout.Label(l.Text, style);
            }
            GUILayout.EndScrollView();
            if (Story != null)
            {
                for (int i = 0; i < Story.currentChoices.Count; i++)
                    if (GUILayout.Button(Story.currentChoices[i].text, GUILayout.Height(32))) { Choose(i); scroll.y = float.MaxValue; }
                if (HasEnded) GUILayout.Label("<b>— The End —</b>", style);
            }
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Restart")) StartStory();
            if (Story != null && GUILayout.Button("Save")) SaveToPrefs();
            if (Story != null && GUILayout.Button("Load")) LoadFromPrefs();
            GUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(status)) GUILayout.Label(status);
            GUILayout.EndArea();
        }
    }
}
