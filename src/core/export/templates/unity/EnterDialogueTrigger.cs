using System;
using UnityEngine;
using UnityEngine.Events;

namespace __NAMESPACE__
{
    /// <summary>A passage of the story (one of StoryInfo.Passages): the Inspector shows a list to pick from.</summary>
    public class StoryPassageAttribute : PropertyAttribute { }

    /// <summary>
    /// A line of dialogue in the passage named by another field (a label from StoryInfo.Lines, "line_…"): the
    /// Inspector lists that passage's lines as they read.
    /// </summary>
    public class StoryLineAttribute : PropertyAttribute
    {
        public readonly string PassageField;
        public StoryLineAttribute(string passageField) { PassageField = passageField; }
    }

    /// <summary>
    /// Enter Dialogue Trigger: enters the story at a passage, or at a line of dialogue in it, when the player walks into
    /// this object's trigger collider (or when you call Enter()). Pick the Line to pick a conversation up partway: the
    /// player went off to fetch the flowers, comes back, and the talk goes on at "You found them!" instead of from the
    /// top. When the story has already run, it keeps what it knows (its variables and items); Fresh Start starts over.
    /// </summary>
    [AddComponentMenu("Pen to Ink/__MENU_TITLE__/Enter Dialogue Trigger")]
    public class NarrativeEnterDialogueTrigger : MonoBehaviour
    {
        [Tooltip("The story to enter. Empty uses the one in the scene.")]
        public NarrativeController story;
        [StoryPassage, Tooltip("The passage to enter. Empty is the beginning of the story.")]
        public string passage = "";
        [StoryLine("passage"), Tooltip("The line of dialogue in that passage the player picks up on. Empty is the top of the passage.")]
        public string line = "";
        [Tooltip("Enter when an object with this tag walks into the trigger collider. Empty: only when you call Enter().")]
        public string playerTag = "Player";
        [Tooltip("Enter only when the player has this item (an item id, without has_), e.g. the flowers. Empty: always.")]
        public string requiredItem = "";
        [Tooltip("Enter only the first time.")]
        public bool onlyOnce = true;
        [Tooltip("Start the story over there (forgetting its variables and items) instead of keeping what it knows.")]
        public bool freshStart;

        [Tooltip("The dialogue was entered.")]
        public UnityEvent entered = new UnityEvent();
        [Tooltip("The dialogue ended, or handed over to the game at an exit.")]
        public UnityEvent finished = new UnityEvent();

        bool used, active;

        /// <summary>Where it enters: the passage, or "passage.line_…" for a line (empty for the beginning).</summary>
        public string Target => string.IsNullOrEmpty(passage) || string.IsNullOrEmpty(line) ? passage : passage + "." + line;

        /// <summary>Whether Enter() would enter the dialogue now.</summary>
        public bool CanEnter => Controller() != null && !(onlyOnce && used) && (string.IsNullOrEmpty(requiredItem) || Controller().HasItem(requiredItem));

        void OnEnable()
        {
            var s = Controller();
            if (s == null) return;
            s.StoryEnded += OnFinished;
            s.ExitReached += OnExit;
        }

        void OnDisable()
        {
            if (story == null) return;
            story.StoryEnded -= OnFinished;
            story.ExitReached -= OnExit;
        }

#if NARRATIVE_BRIDGE_PHYSICS
        void OnTriggerEnter(Collider other) { if (IsPlayer(other.gameObject)) Enter(); }
#endif
#if NARRATIVE_BRIDGE_PHYSICS_2D
        void OnTriggerEnter2D(Collider2D other) { if (IsPlayer(other.gameObject)) Enter(); }
#endif

        bool IsPlayer(GameObject other) => !string.IsNullOrEmpty(playerTag) && other.CompareTag(playerTag);

        /// <summary>Enters the dialogue at Target (e.g. from your own "talk" button).</summary>
        public void Enter()
        {
            if (!CanEnter) return;
            var s = Controller();
            var target = Target;
            if (!string.IsNullOrEmpty(target) && !NarrativeController.IsStartPoint(target))
            {
                Debug.LogError("[NarrativeBridge] Enter Dialogue Trigger: the story has no passage or line called " + target + ".", this);
                return;
            }
            used = true;
            active = true;
            if (string.IsNullOrEmpty(target)) s.StartStory();
            else if (freshStart) s.StartAt(target);
            else s.EnterAt(target);
            entered.Invoke();
        }

        NarrativeController Controller()
        {
            if (story == null) story = FindAnyController();
            return story;
        }

        static NarrativeController FindAnyController()
        {
#if UNITY_2023_1_OR_NEWER
            return UnityEngine.Object.FindFirstObjectByType<NarrativeController>();
#else
            return UnityEngine.Object.FindObjectOfType<NarrativeController>();
#endif
        }

        void OnExit(string exit) => OnFinished();

        void OnFinished()
        {
            if (!active) return;
            active = false;
            finished.Invoke();
        }

        void OnValidate()
        {
            if (!string.IsNullOrEmpty(passage) && Array.IndexOf(StoryInfo.Passages, passage) < 0)
                Debug.LogWarning("[NarrativeBridge] Enter Dialogue Trigger on " + name + ": the story has no passage called " + passage + ".", this);
            else if (!string.IsNullOrEmpty(line) && !NarrativeController.IsStartPoint(Target))
                Debug.LogWarning("[NarrativeBridge] Enter Dialogue Trigger on " + name + ": " + passage + " has no line " + line + " (was it changed in the script?).", this);
        }
    }
}
