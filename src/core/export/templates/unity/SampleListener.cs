using UnityEngine;
using __NAMESPACE__;

/// <summary>
/// Shows how a game system can follow the story from code: every line, custom tag (#shake, #music:calm)
/// and variable change. Put it next to a NarrativeController.
/// </summary>
public class StoryEventsListener : MonoBehaviour
{
    public NarrativeController story;

    void OnEnable()
    {
        if (story == null) story = GetComponent<NarrativeController>();
        if (story == null) return;
        story.LineShown += OnLine;
        story.TagFound += OnTag;
        story.VariableChanged += OnVariable;
        story.StoryEnded += OnEnded;
    }

    void OnDisable()
    {
        if (story == null) return;
        story.LineShown -= OnLine;
        story.TagFound -= OnTag;
        story.VariableChanged -= OnVariable;
        story.StoryEnded -= OnEnded;
    }

    void OnLine(NarrativeController.Line line) => Debug.Log((line.Speaker != null ? line.Speaker + ": " : "") + line.Text);
    void OnTag(string tag) => Debug.Log("Story tag: #" + tag);
    void OnVariable(string name, object value) => Debug.Log("Story variable " + name + " = " + value);
    void OnEnded() => Debug.Log("The story has ended.");
}
