using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>Lists the story's passages for a [StoryPassage] string field.</summary>
    [CustomPropertyDrawer(typeof(StoryPassageAttribute))]
    public class StoryPassageDrawer : PropertyDrawer
    {
        public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
        {
            if (property.propertyType != SerializedPropertyType.String) { EditorGUI.PropertyField(position, property, label); return; }
            var values = new List<string> { "" };
            var shown = new List<GUIContent> { new GUIContent("(beginning of the story)") };
            for (int i = 0; i < StoryInfo.Passages.Length; i++)
            {
                values.Add(StoryInfo.Passages[i]);
                var title = StoryInfo.PassageTitles[i];
                shown.Add(new GUIContent(title == StoryInfo.Passages[i] ? title : title + " (" + StoryInfo.Passages[i] + ")"));
            }
            StoryPointPopup.Draw(position, property, label, values, shown);
        }
    }

    /// <summary>Lists one passage's lines of dialogue, as they read, for a [StoryLine("passageField")] string field.</summary>
    [CustomPropertyDrawer(typeof(StoryLineAttribute))]
    public class StoryLineDrawer : PropertyDrawer
    {
        public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
        {
            if (property.propertyType != SerializedPropertyType.String) { EditorGUI.PropertyField(position, property, label); return; }
            var field = ((StoryLineAttribute)attribute).PassageField;
            var path = property.propertyPath;
            var dot = path.LastIndexOf('.');
            var passageProp = property.serializedObject.FindProperty(dot < 0 ? field : path.Substring(0, dot + 1) + field);
            var passage = passageProp != null && passageProp.propertyType == SerializedPropertyType.String ? passageProp.stringValue : "";
            var values = new List<string> { "" };
            var shown = new List<GUIContent> { new GUIContent("(top of the passage)") };
            for (int i = 0; i < StoryInfo.Lines.Length; i++)
            {
                var l = StoryInfo.Lines[i];
                var cut = l.IndexOf('.');
                if (cut < 0 || l.Substring(0, cut) != passage) continue;
                values.Add(l.Substring(cut + 1));
                shown.Add(new GUIContent(StoryInfo.LineTexts[i].Replace("/", "\u2215"), l));
            }
            using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(passage)))
                StoryPointPopup.Draw(position, property, label, values, shown);
        }
    }

    static class StoryPointPopup
    {
        /// Draws a popup of the values; a value the story no longer has stays, marked as missing, until it's changed.
        public static void Draw(Rect position, SerializedProperty property, GUIContent label, List<string> values, List<GUIContent> shown)
        {
            var current = property.stringValue ?? "";
            var index = values.IndexOf(current);
            if (index < 0)
            {
                values.Add(current);
                shown.Add(new GUIContent(current + " (not in the story)"));
                index = values.Count - 1;
            }
            EditorGUI.BeginProperty(position, label, property);
            EditorGUI.BeginChangeCheck();
            var picked = EditorGUI.Popup(position, label, index, shown.ToArray());
            if (EditorGUI.EndChangeCheck()) property.stringValue = values[picked];
            EditorGUI.EndProperty();
        }
    }
}
