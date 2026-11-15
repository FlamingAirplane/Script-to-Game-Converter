using UnityEngine;
using UnityEngine.Events;
using __NAMESPACE__;

/// <summary>
/// Starts the story at a passage when the player walks into this trigger (or when you call Begin()), and
/// tells your game when the story starts and ends, e.g. to pause player movement while it's on screen.
/// Put it on an object with a trigger collider, and point it at a NarrativeController with
/// "Start On Awake" turned off.
/// </summary>
public class StoryTrigger : MonoBehaviour
{
    public NarrativeController story;
    [StoryPassage, Tooltip("Where to start, one of StoryInfo.Passages. Empty starts from the beginning.")]
    public string passage = "";
    [Tooltip("Only objects with this tag start the story.")]
    public string playerTag = "Player";
    public bool onlyOnce = true;

    public UnityEvent storyStarted = new UnityEvent();
    public UnityEvent storyFinished = new UnityEvent();

    bool used;

    void OnEnable() { if (story != null) story.StoryEnded += OnEnded; }
    void OnDisable() { if (story != null) story.StoryEnded -= OnEnded; }

    // Each needs its physics module; the sample's assembly switches them on when your game has it.
#if NARRATIVE_BRIDGE_PHYSICS
    void OnTriggerEnter(Collider other) { if (other.CompareTag(playerTag)) Begin(); }
#endif
#if NARRATIVE_BRIDGE_PHYSICS_2D
    void OnTriggerEnter2D(Collider2D other) { if (other.CompareTag(playerTag)) Begin(); }
#endif

    public void Begin()
    {
        if (story == null || (onlyOnce && used)) return;
        used = true;
        if (string.IsNullOrEmpty(passage)) story.StartStory(); else story.StartAt(passage);
        storyStarted.Invoke();
    }

    void OnEnded() => storyFinished.Invoke();
}
