#if NARRATIVE_BRIDGE_TMP
using System.IO;
using UnityEditor;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// The story panel's text is TextMeshPro, which shows nothing until the project has the "TMP Essential Resources"
    /// (its settings, default font and shaders). A new project doesn't, and Unity only offers them once Play is pressed,
    /// when they can no longer be imported. So they're imported here when they're missing, as soon as the project opens;
    /// Tools → Pen to Ink → __MENU_TITLE__ → Import TextMeshPro Essentials does it again.
    /// </summary>
    [InitializeOnLoad]
    public static class TextMeshProSetup
    {
        static readonly string[] Packages =
        {
            "Packages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage",
            "Packages/com.unity.textmeshpro/Package Resources/TMP Essential Resources.unitypackage",
        };

        static TextMeshProSetup()
        {
            EditorApplication.delayCall += () =>
            {
                if (Application.isBatchMode || EditorApplication.isPlayingOrWillChangePlaymode) return;
                if (!Missing) return;
                if (Import()) Debug.Log("[NarrativeBridge] Imported the TextMeshPro essentials (Assets/TextMesh Pro), which the story panel's text needs.");
            };
            // Pressing Play without them: say why the panel is empty, and what to do.
            EditorApplication.playModeStateChanged += change =>
            {
                if (change == PlayModeStateChange.EnteredPlayMode && Missing)
                    Debug.LogWarning("[NarrativeBridge] The story panel's text is empty because the TextMeshPro essentials aren't in this project. Stop Play, choose Tools → Pen to Ink → __MENU_TITLE__ → Import TextMeshPro Essentials (or Window → TextMeshPro → Import TMP Essential Resources), and press Play again.");
            };
        }

        /// <summary>Whether the project has no TMP Settings asset yet.</summary>
        public static bool Missing => Resources.Load("TMP Settings") == null && AssetDatabase.FindAssets("t:TMP_Settings").Length == 0;

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Import TextMeshPro Essentials")]
        static void ImportMenu()
        {
            if (EditorApplication.isPlaying) { Debug.LogWarning("[NarrativeBridge] Stop Play first: Unity can't import a package while playing."); return; }
            if (!Missing) { Debug.Log("[NarrativeBridge] The TextMeshPro essentials are already in this project."); return; }
            if (!Import()) Debug.LogWarning("[NarrativeBridge] Couldn't find the TextMeshPro essentials package. Use Window → TextMeshPro → Import TMP Essential Resources.");
        }

        /// <summary>Imports the essentials from whichever package this Unity has them in (uGUI 2.0, or TextMeshPro); false when neither does.</summary>
        public static bool Import()
        {
            foreach (var package in Packages)
            {
                if (!File.Exists(Path.GetFullPath(package))) continue;
                AssetDatabase.ImportPackage(package, false);
                return true;
            }
            return false;
        }
    }
}
#endif
