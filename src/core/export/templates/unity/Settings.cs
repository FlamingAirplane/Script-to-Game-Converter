using System;
using UnityEngine;

namespace __NAMESPACE__
{
    /// <summary>
    /// The player's own reading settings: text size, typing speed, auto-advance, high contrast and voice volume.
    /// The story panel's Settings button changes them; your game's own options menu can too. They are kept in
    /// PlayerPrefs and shared by every Narrative Bridge story in the game. Changed is raised after each change.
    /// </summary>
    public static class NarrativeSettings
    {
        public enum Speed { Slow, Normal, Fast, Instant }
        public enum AutoAdvanceMode { AsDesigned, Off, On }

        const string Prefix = "NarrativeBridge.Settings.";
        static bool loaded;
        static float textScale = 1f, voiceVolume = 1f;
        static Speed typingSpeed = Speed.Normal;
        static AutoAdvanceMode autoAdvance = AutoAdvanceMode.AsDesigned;
        static bool highContrast;

        /// <summary>Raised after any setting changes, so story panels redraw.</summary>
        public static event Action Changed;

        /// <summary>The text sizes the Settings menu steps through.</summary>
        public static readonly float[] TextScales = { 0.85f, 1f, 1.15f, 1.3f, 1.5f };
        /// <summary>The voice volumes the Settings menu steps through.</summary>
        public static readonly float[] VoiceVolumes = { 1f, 0.75f, 0.5f, 0.25f, 0f };

        /// <summary>Text size, as a multiple of the theme's (0.5 to 2).</summary>
        public static float TextScale { get { Load(); return textScale; } set { Load(); textScale = Mathf.Clamp(value, 0.5f, 2f); Save(); } }
        public static Speed TypingSpeed { get { Load(); return typingSpeed; } set { Load(); typingSpeed = value; Save(); } }
        /// <summary>AsDesigned follows the theme's Auto Advance; Off and On override it.</summary>
        public static AutoAdvanceMode AutoAdvance { get { Load(); return autoAdvance; } set { Load(); autoAdvance = value; Save(); } }
        /// <summary>Light text on a solid dark panel, whatever the theme's colours.</summary>
        public static bool HighContrast { get { Load(); return highContrast; } set { Load(); highContrast = value; Save(); } }
        /// <summary>Voice clip volume, as a multiple of the theme's (0 to 1).</summary>
        public static float VoiceVolume { get { Load(); return voiceVolume; } set { Load(); voiceVolume = Mathf.Clamp01(value); Save(); } }

        /// <summary>How fast text types, as a multiple of the theme's speed; 0 shows each line at once.</summary>
        public static float SpeedMultiplier
        {
            get
            {
                switch (TypingSpeed)
                {
                    case Speed.Slow: return 0.5f;
                    case Speed.Fast: return 2f;
                    case Speed.Instant: return 0f;
                    default: return 1f;
                }
            }
        }

        /// <summary>Back to the theme's own look and pacing.</summary>
        public static void Reset()
        {
            Load();
            textScale = 1f;
            voiceVolume = 1f;
            typingSpeed = Speed.Normal;
            autoAdvance = AutoAdvanceMode.AsDesigned;
            highContrast = false;
            Save();
        }

        /// <summary>The next value in a list (for menus that step through choices).</summary>
        public static float Next(float[] values, float current)
        {
            for (int i = 0; i < values.Length; i++) if (Mathf.Abs(values[i] - current) < 0.01f) return values[(i + 1) % values.Length];
            return values[0];
        }

        static void Load()
        {
            if (loaded) return;
            loaded = true;
            textScale = Mathf.Clamp(PlayerPrefs.GetFloat(Prefix + "TextScale", 1f), 0.5f, 2f);
            voiceVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(Prefix + "VoiceVolume", 1f));
            typingSpeed = (Speed)Mathf.Clamp(PlayerPrefs.GetInt(Prefix + "TypingSpeed", (int)Speed.Normal), 0, 3);
            autoAdvance = (AutoAdvanceMode)Mathf.Clamp(PlayerPrefs.GetInt(Prefix + "AutoAdvance", 0), 0, 2);
            highContrast = PlayerPrefs.GetInt(Prefix + "HighContrast", 0) == 1;
        }

        static void Save()
        {
            PlayerPrefs.SetFloat(Prefix + "TextScale", textScale);
            PlayerPrefs.SetFloat(Prefix + "VoiceVolume", voiceVolume);
            PlayerPrefs.SetInt(Prefix + "TypingSpeed", (int)typingSpeed);
            PlayerPrefs.SetInt(Prefix + "AutoAdvance", (int)autoAdvance);
            PlayerPrefs.SetInt(Prefix + "HighContrast", highContrast ? 1 : 0);
            Changed?.Invoke();
        }
    }
}
