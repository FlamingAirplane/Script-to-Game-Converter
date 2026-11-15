using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
#if NARRATIVE_BRIDGE_LOCALIZATION
using UnityEngine.Localization.Settings;
#endif

namespace __NAMESPACE__
{
    /// <summary>
    /// Shows the story in another language. The package's translation sheet (Resources: StoryInfo.TranslationsResource,
    /// a CSV) lists every piece of text the player can see with a key made from its text; translators add a column per
    /// language ("fr", "de"…). Language picks one (or "" for the story as written); the story panel's Settings menu has
    /// it too. With Unity's Localization package, Tools → Narrative Bridge → __MENU_TITLE__ → Create Localization Tables
    /// makes a String Table Collection from the sheet, and the story then follows the selected locale.
    /// </summary>
    public static class NarrativeLocalization
    {
        const string LanguageKey = "NarrativeBridge.Language";
        static Dictionary<string, string[]> table;
        static string[] languages = new string[0];
        static TextAsset sheet;
        static bool loaded, languageLoaded;
        static string language = "";

        /// <summary>Raised when the language (or the sheet) changes: the story and its panel show the new words.</summary>
        public static event Action Changed;

        /// <summary>The languages the sheet has (its column names after "source"), not counting the story's own.</summary>
        public static IReadOnlyList<string> Languages
        {
            get
            {
                EnsureLoaded();
                return languages;
            }
        }

        /// <summary>The language shown: one of Languages, or "" for the story as written. Kept in PlayerPrefs; the first time, the player's system language if the sheet has it.</summary>
        public static string Language
        {
            get
            {
                LoadLanguage();
                return language;
            }
            set
            {
                LoadLanguage();
                value = value ?? "";
                if (value == language) return;
                language = value;
                PlayerPrefs.SetString(LanguageKey, value);
                Changed?.Invoke();
            }
        }

        /// <summary>Uses another sheet (a CSV TextAsset like Translations.csv, e.g. your translators' newest); null goes back to the package's.</summary>
        public static void UseSheet(TextAsset csv)
        {
            sheet = csv;
            loaded = false;
            Changed?.Invoke();
        }

        /// <summary>The text in the current language, or as written when there's no translation for it.</summary>
        public static string Translate(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
#if NARRATIVE_BRIDGE_LOCALIZATION
            if (UseUnityLocalization)
            {
                var fromTables = FromUnity(Key(text));
                if (!string.IsNullOrEmpty(fromTables)) return fromTables;
            }
#endif
            var lang = Language;
            if (string.IsNullOrEmpty(lang)) return text;
            EnsureLoaded();
            var column = Array.IndexOf(languages, lang);
            if (column < 0) return text;
            return table.TryGetValue(Key(text), out var row) && column < row.Length && !string.IsNullOrEmpty(row[column]) ? row[column] : text;
        }

        /// <summary>The sheet's key for a text: its words with spaces tidied, hashed (FNV-1a), e.g. "nb_1c3f9a2e". The same as Narrative Bridge's.</summary>
        public static string Key(string text)
        {
            var t = Normalise(text);
            uint h = 0x811c9dc5;
            for (int i = 0; i < t.Length; i++)
            {
                h ^= t[i];
                h = unchecked(h * 0x01000193);
            }
            return "nb_" + h.ToString("x8");
        }

        static string Normalise(string text)
        {
            var sb = new StringBuilder(text.Length);
            var space = false;
            foreach (var ch in text)
            {
                if (char.IsWhiteSpace(ch)) { space = sb.Length > 0; continue; }
                if (space) sb.Append(' ');
                space = false;
                sb.Append(ch);
            }
            return sb.ToString();
        }

        /// <summary>A language's own name for itself (fr → Français), or the code; "" is the story's own language.</summary>
        public static string DisplayName(string code)
        {
            if (string.IsNullOrEmpty(code)) code = StoryInfo.SourceLanguage;
            try
            {
                var name = CultureInfo.GetCultureInfo(code).NativeName;
                if (!string.IsNullOrEmpty(name) && name.IndexOf("Unknown", StringComparison.OrdinalIgnoreCase) < 0) return char.ToUpper(name[0]) + name.Substring(1);
            }
            catch (Exception) { }
            return code;
        }

        /// <summary>The sheet's rows: the header (key, kind, passage, source, languages…) first. For tools such as Create Localization Tables.</summary>
        public static List<string[]> ReadSheet(TextAsset csv = null)
        {
            var asset = csv != null ? csv : (sheet != null ? sheet : Resources.Load<TextAsset>(StoryInfo.TranslationsResource));
            return asset != null ? ParseCsv(asset.text) : new List<string[]>();
        }

        static void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;
            table = new Dictionary<string, string[]>();
            languages = new string[0];
            var rows = ReadSheet();
            if (rows.Count == 0) return;
            var header = rows[0];
            var first = Array.IndexOf(header, "source") + 1;
            if (first <= 0) return;
            languages = new string[Math.Max(0, header.Length - first)];
            for (int i = 0; i < languages.Length; i++) languages[i] = header[first + i].Trim();
            for (int r = 1; r < rows.Count; r++)
            {
                var row = rows[r];
                if (row.Length == 0 || string.IsNullOrEmpty(row[0])) continue;
                var values = new string[languages.Length];
                for (int i = 0; i < values.Length; i++) values[i] = first + i < row.Length ? row[first + i] : "";
                table[row[0]] = values;
            }
        }

        static void LoadLanguage()
        {
            if (languageLoaded) return;
            languageLoaded = true;
            if (PlayerPrefs.HasKey(LanguageKey)) { language = PlayerPrefs.GetString(LanguageKey, ""); return; }
            // Nobody has chosen yet: the player's system language, if there's a translation into it.
            var system = SystemLanguageCode();
            EnsureLoaded();
            language = system != null && system != StoryInfo.SourceLanguage && Array.IndexOf(languages, system) >= 0 ? system : "";
        }

        static string SystemLanguageCode()
        {
            switch (Application.systemLanguage)
            {
                case SystemLanguage.English: return "en";
                case SystemLanguage.French: return "fr";
                case SystemLanguage.German: return "de";
                case SystemLanguage.Spanish: return "es";
                case SystemLanguage.Italian: return "it";
                case SystemLanguage.Portuguese: return "pt";
                case SystemLanguage.Dutch: return "nl";
                case SystemLanguage.Polish: return "pl";
                case SystemLanguage.Russian: return "ru";
                case SystemLanguage.Japanese: return "ja";
                case SystemLanguage.Korean: return "ko";
                case SystemLanguage.ChineseSimplified: return "zh-Hans";
                case SystemLanguage.ChineseTraditional: return "zh-Hant";
                case SystemLanguage.Turkish: return "tr";
                case SystemLanguage.Swedish: return "sv";
                default: return null;
            }
        }

        /// <summary>Reads CSV: commas between fields, "quoted" fields may hold commas, quotes ("") and line breaks.</summary>
        public static List<string[]> ParseCsv(string text)
        {
            var rows = new List<string[]>();
            var row = new List<string>();
            var field = new StringBuilder();
            var quoted = false;
            for (int i = 0; i < text.Length; i++)
            {
                var c = text[i];
                if (quoted)
                {
                    if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                    else if (c == '"') quoted = false;
                    else field.Append(c);
                    continue;
                }
                if (c == '"' && field.Length == 0) quoted = true;
                else if (c == ',') { row.Add(field.ToString()); field.Clear(); }
                else if (c == '\n' || c == '\r')
                {
                    if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                    row.Add(field.ToString());
                    field.Clear();
                    if (row.Count > 1 || row[0].Length > 0) rows.Add(row.ToArray());
                    row = new List<string>();
                }
                else if (c != '\uFEFF') field.Append(c);
            }
            if (field.Length > 0 || row.Count > 0)
            {
                row.Add(field.ToString());
                rows.Add(row.ToArray());
            }
            return rows;
        }

#if NARRATIVE_BRIDGE_LOCALIZATION
        /// <summary>Read translations from Unity's Localization package (the tables Create Localization Tables makes), following its selected locale.</summary>
        public static bool UseUnityLocalization = true;
        static bool hooked;

        static string FromUnity(string key)
        {
            if (!Application.isPlaying || !LocalizationSettings.HasSettings) return null;
            if (!hooked)
            {
                hooked = true;
                LocalizationSettings.SelectedLocaleChanged += _ => Changed?.Invoke();
            }
            var locale = LocalizationSettings.SelectedLocale;
            if (locale == null || locale.Identifier.Code == StoryInfo.SourceLanguage) return null;
            var strings = LocalizationSettings.StringDatabase.GetTable(StoryInfo.StringTableName, locale);
            var entry = strings != null ? strings.GetEntry(key) : null;
            return entry != null ? entry.GetLocalizedString() : null;
        }
#endif
    }
}
