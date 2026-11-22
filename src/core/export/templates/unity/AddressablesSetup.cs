#if NARRATIVE_BRIDGE_ADDRESSABLES
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.AddressableAssets;
using UnityEditor.AddressableAssets.Settings;
using UnityEditor.AddressableAssets.Settings.GroupSchemas;
using UnityEngine;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// When the story loads its voice clips and pictures with Addressables (StoryInfo.UsesAddressables), puts them in an
    /// Addressables group, "__MENU_TITLE__ Story", with the addresses the controller asks for. It runs by itself when the
    /// group is missing; Tools → Pen to Ink → __MENU_TITLE__ → Set Up Addressables runs it again (after an update).
    /// </summary>
    [InitializeOnLoad]
    public static class AddressablesSetup
    {
        public const string GroupName = "__MENU_TITLE__ Story";
        const string Folder = "Packages/__PACKAGE__/Runtime/StoryAssets";

        static AddressablesSetup()
        {
            if (!StoryInfo.UsesAddressables) return;
            EditorApplication.delayCall += () =>
            {
                var settings = AddressableAssetSettingsDefaultObject.Settings;
                if (settings == null || settings.FindGroup(GroupName) == null) SetUp();
            };
        }

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Set Up Addressables")]
        static void SetUpMenu()
        {
            if (!StoryInfo.UsesAddressables) { Debug.Log("[NarrativeBridge] This story keeps its voice clips and pictures in Resources; export it with Addressables to load them on demand."); return; }
            Debug.Log("[NarrativeBridge] " + SetUp() + " voice clip(s) and picture(s) are in the Addressables group " + GroupName + ".");
        }

        /// <summary>Adds every voice clip and picture to the group with its address; returns how many.</summary>
        public static int SetUp()
        {
            var settings = AddressableAssetSettingsDefaultObject.GetSettings(true);
            var group = settings.FindGroup(GroupName);
            if (group == null) group = settings.CreateGroup(GroupName, false, false, false, null, typeof(BundledAssetGroupSchema), typeof(ContentUpdateGroupSchema));
            var count = 0;
            if (!AssetDatabase.IsValidFolder(Folder)) return 0;
            foreach (var guid in AssetDatabase.FindAssets("", new[] { Folder }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (AssetDatabase.IsValidFolder(path)) continue;
                var rel = path.Substring(Folder.Length + 1);
                string address;
                if (rel.StartsWith("Audio/")) address = "Audio/" + System.IO.Path.GetFileNameWithoutExtension(rel);
                else if (rel.StartsWith("Images/") && rel.EndsWith(".bytes")) address = rel.Substring(0, rel.Length - ".bytes".Length);
                else continue;
                var entry = settings.CreateOrMoveEntry(guid, group, false, false);
                entry.address = StoryInfo.AddressPrefix + address;
                count++;
            }
            settings.SetDirty(AddressableAssetSettings.ModificationEvent.BatchModification, null, true, true);
            AssetDatabase.SaveAssets();
            return count;
        }
    }
}
#endif
