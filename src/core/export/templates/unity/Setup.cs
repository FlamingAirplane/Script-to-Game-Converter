using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace __NAMESPACE__.Setup
{
    /// <summary>
    /// "__MENU_TITLE__" runs on Ink Unity Integration (inkle's free ink runtime). Until a project has it, the
    /// package's scripts stay switched off (so the game never sees compile errors) and this offers, once per
    /// editor session, to install it from GitHub, or to use an ink runtime the project already has.
    /// </summary>
    [InitializeOnLoad]
    static class InkSetup
    {
        const string InkPackage = "__INK_URL__";
        const string Define = "NARRATIVE_BRIDGE_INK";
        const string Title = "__MENU_TITLE__ (Pen to Ink)";

#if !NARRATIVE_BRIDGE_ADDRESSABLES
        /// <summary>The story was exported to load its voice clips and pictures with Addressables.</summary>
        static readonly bool UsesAddressables = __USES_ADDRESSABLES__;
#endif

        static InkSetup()
        {
#if !NARRATIVE_BRIDGE_INK
            EditorApplication.delayCall += Check;
#endif
#if !NARRATIVE_BRIDGE_ADDRESSABLES
            if (UsesAddressables) EditorApplication.delayCall += CheckAddressables;
#endif
        }

#if !NARRATIVE_BRIDGE_ADDRESSABLES
        static void CheckAddressables()
        {
            if (SessionState.GetBool("NarrativeBridge.AddressablesChecked", false)) return;
            SessionState.SetBool("NarrativeBridge.AddressablesChecked", true);
            if (Application.isBatchMode) { Debug.LogWarning("[NarrativeBridge] " + Title + " loads its voice clips and pictures with Addressables: add com.unity.addressables to the project."); return; }
            if (EditorUtility.DisplayDialog(Title, "This story loads its voice clips and pictures on demand with Unity's Addressables package. Install it now?", "Install", "Not now"))
                InstallAddressables();
        }

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Install Addressables")]
        static void InstallAddressables()
        {
            UnityEditor.PackageManager.Client.Add("com.unity.addressables");
            Debug.Log("[NarrativeBridge] Installing Addressables. The story's voice clips and pictures are added to a group once it has installed.");
        }
#endif

        static bool InkRuntimeLoaded()
        {
            return AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetType("Ink.Runtime.Story", false) != null);
        }

        static void Check()
        {
            // One question per session, however many Pen to Ink stories are installed.
            if (SessionState.GetBool("NarrativeBridge.InkChecked", false)) return;
            SessionState.SetBool("NarrativeBridge.InkChecked", true);
            if (Application.isBatchMode)
            {
                Debug.LogWarning("[NarrativeBridge] " + Title + " needs Ink Unity Integration: add " + InkPackage + " to Packages/manifest.json.");
                return;
            }
            if (InkRuntimeLoaded())
            {
                if (EditorUtility.DisplayDialog(Title, "This project has the ink runtime, but not as the Ink Unity Integration package (for example a copy in Assets). Switch on the story's scripts by adding the " + Define + " scripting define?", "Add the define", "Not now"))
                    UseExistingInk();
            }
            else if (EditorUtility.DisplayDialog(Title, "This story needs Ink Unity Integration, inkle's free ink runtime. Install it now from GitHub? (Git must be installed.)", "Install", "Not now"))
                InstallInk();
        }

#if !NARRATIVE_BRIDGE_INK
        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Install Ink Unity Integration")]
#endif
        static void InstallInk()
        {
            UnityEditor.PackageManager.Client.Add(InkPackage);
            Debug.Log("[NarrativeBridge] Installing Ink Unity Integration (" + InkPackage + "). The story's scripts switch on when it has installed.");
        }

#if !NARRATIVE_BRIDGE_INK
        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Use the Ink Already in This Project")]
#endif
        static void UseExistingInk()
        {
            var target = NamedBuildTarget.FromBuildTargetGroup(EditorUserBuildSettings.selectedBuildTargetGroup);
            var defines = PlayerSettings.GetScriptingDefineSymbols(target);
            if (defines.Split(';').Contains(Define)) return;
            PlayerSettings.SetScriptingDefineSymbols(target, string.IsNullOrEmpty(defines) ? Define : defines + ";" + Define);
            Debug.Log("[NarrativeBridge] Added the " + Define + " scripting define for " + target.TargetName + ".");
        }
    }
}
