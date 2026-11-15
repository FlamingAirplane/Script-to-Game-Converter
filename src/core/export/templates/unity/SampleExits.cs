using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using __NAMESPACE__;

/// <summary>
/// Hands the story over to your gameplay at its exits, without code: list each exit (StoryInfo.Exits) with
/// what to do when the dialogue reaches it (enable the player's controls, load the fight, start a timer).
/// When the gameplay is done, call ResumeStory() (go on from the exit) or ResumeStoryAt("passage") (go on
/// somewhere else, e.g. after the player lost), from a UnityEvent, a trigger or your own script.
/// </summary>
public class StoryExits : MonoBehaviour
{
    [System.Serializable]
    public class Exit
    {
        [Tooltip("One of StoryInfo.Exits, as named in Narrative Bridge.")]
        public string name;
        public UnityEvent onReached = new UnityEvent();
    }

    public NarrativeController story;
    public List<Exit> exits = new List<Exit>();
    [Tooltip("Any exit, after its own event.")]
    public UnityEvent onAnyExit = new UnityEvent();
    public UnityEvent onResumed = new UnityEvent();

    void OnEnable()
    {
        if (story == null) story = GetComponent<NarrativeController>();
        if (story == null) return;
        story.ExitReached += Reached;
        story.Resumed += Resumed;
    }

    void OnDisable()
    {
        if (story == null) return;
        story.ExitReached -= Reached;
        story.Resumed -= Resumed;
    }

    void Reached(string exit)
    {
        foreach (var e in exits) if (e.name == exit) e.onReached.Invoke();
        onAnyExit.Invoke();
    }

    void Resumed() => onResumed.Invoke();

    /// <summary>Goes on with the dialogue from the exit it stopped at.</summary>
    public void ResumeStory() { if (story != null) story.Resume(); }

    /// <summary>Goes on with the dialogue at another passage (see StoryInfo.Passages).</summary>
    public void ResumeStoryAt(string passage) { if (story != null) story.ResumeAt(passage); }
}
