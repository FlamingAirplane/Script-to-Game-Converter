#if NARRATIVE_BRIDGE_LOCALIZATION
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Localization;
using UnityEngine;
using UnityEngine.Localization;
using UnityEngine.Localization.Settings;
using UnityEngine.Localization.Tables;

namespace __NAMESPACE__.EditorTools
{
    /// <summary>
    /// For games that use Unity's Localization package: makes (or updates) a String Table Collection from the story's
    /// translation sheet, with a locale for the story's own language and each language in the sheet. The story then
    /// follows the selected locale (NarrativeLocalization.UseUnityLocalization).
    /// </summary>
    public static class LocalizationTables
    {
        const string Folder = "__ASSET_FOLDER__/Localization";

        [MenuItem("Tools/Pen to Ink/__MENU_TITLE__/Create Localization Tables")]
        static void CreateMenu()
        {
            var n = Create();
            Debug.Log("[NarrativeBridge] The String Table Collection " + StoryInfo.StringTableName + " has " + n + " entries, in " + (NarrativeLocalization.Languages.Count + 1) + " language(s). Translators can keep working in the sheet; run this again to bring their work in.");
        }

        /// <summary>Makes or updates the tables from the sheet (the package's, or csv); returns the number of entries.</summary>
        public static int Create(TextAsset csv = null)
        {
            EnsureFolder(Folder);
            if (LocalizationEditorSettings.ActiveLocalizationSettings == null)
            {
                var settings = ScriptableObject.CreateInstance<LocalizationSettings>();
                AssetDatabase.CreateAsset(settings, Folder + "/Localization Settings.asset");
                LocalizationEditorSettings.ActiveLocalizationSettings = settings;
            }
            var rows = NarrativeLocalization.ReadSheet(csv);
            if (rows.Count < 2) return 0;
            var header = rows[0];
            var source = System.Array.IndexOf(header, "source");
            if (source < 0) { Debug.LogWarning("[NarrativeBridge] The translation sheet has no source column."); return 0; }
            var columns = new List<KeyValuePair<string, int>> { new KeyValuePair<string, int>(StoryInfo.SourceLanguage, source) };
            for (int i = source + 1; i < header.Length; i++) if (!string.IsNullOrEmpty(header[i].Trim())) columns.Add(new KeyValuePair<string, int>(header[i].Trim(), i));
            foreach (var c in columns)
            {
                if (LocalizationEditorSettings.GetLocale(c.Key) != null) continue;
                var locale = Locale.CreateLocale(c.Key);
                AssetDatabase.CreateAsset(locale, Folder + "/" + c.Key + ".asset");
                LocalizationEditorSettings.AddLocale(locale);
            }
            var collection = LocalizationEditorSettings.GetStringTableCollection(StoryInfo.StringTableName);
            if (collection == null) collection = LocalizationEditorSettings.CreateStringTableCollection(StoryInfo.StringTableName, Folder);
            var count = 0;
            foreach (var c in columns)
            {
                var table = collection.GetTable(c.Key) as StringTable;
                if (table == null) table = collection.AddNewTable(c.Key) as StringTable;
                if (table == null) continue;
                for (int r = 1; r < rows.Count; r++)
                {
                    var row = rows[r];
                    if (row.Length <= c.Value || string.IsNullOrEmpty(row[0]) || string.IsNullOrEmpty(row[c.Value])) continue;
                    table.AddEntry(row[0], row[c.Value]);
                    if (c.Value == source) count++;
                }
                EditorUtility.SetDirty(table);
            }
            EditorUtility.SetDirty(collection);
            EditorUtility.SetDirty(collection.SharedData);
            AssetDatabase.SaveAssets();
            return count;
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var slash = path.LastIndexOf('/');
            EnsureFolder(path.Substring(0, slash));
            AssetDatabase.CreateFolder(path.Substring(0, slash), path.Substring(slash + 1));
        }
    }
}
#endif
