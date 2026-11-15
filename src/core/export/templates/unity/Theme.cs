using System;
using UnityEngine;

namespace __NAMESPACE__
{
    /// <summary>
    /// How the story UI looks and behaves. The theme asset (Assets/NarrativeBridge/...) is made from the look
    /// chosen in Narrative Bridge (StoryInfo.ThemeResource); change any of it in the Inspector, even while playing.
    /// Tools → Narrative Bridge → __MENU_TITLE__ → Reset Theme to Exported Defaults brings back the exported look.
    /// </summary>
    [CreateAssetMenu(menuName = "Narrative Bridge/__MENU_TITLE__ Theme", fileName = "NarrativeTheme")]
    public class NarrativeTheme : ScriptableObject
    {
        public const string ExportedResource = StoryInfo.ThemeResource;

        public enum TextAlign { Left, Center, Right }
        public enum TranscriptMode { History, Scene, Line }
        public enum SpeakerStyle { Above, Inline }
        public enum ChoiceAlign { Left, Center }
        public enum PictureFit { Cover, Contain }
        public enum PortraitPlacement { Above, Inside }
        public enum PortraitSide { Left, Right, Alternate }

        [Header("Colours")]
        public Color background = new Color(0.996f, 0.98f, 0.878f, 1f);
        [Tooltip("The story's text.")]
        public Color text = new Color(0.157f, 0.212f, 0.094f, 1f);
        [Tooltip("The ending, and highlights.")]
        public Color accent = new Color(0.737f, 0.424f, 0.145f, 1f);
        [Tooltip("Stage directions, transitions, choices made and the status line.")]
        public Color muted = new Color(0.376f, 0.424f, 0.22f, 1f);
        public Color speakerColour = new Color(0.737f, 0.424f, 0.145f, 1f);
        public Color sceneColour = new Color(0.376f, 0.424f, 0.22f, 1f);
        [Tooltip("Choice, Continue and toolbar buttons (see the button fills under Choices and buttons).")]
        public Color buttonColour = new Color(0.737f, 0.424f, 0.145f, 1f);
        public Color choiceTextColour = new Color(0.157f, 0.212f, 0.094f, 1f);
        public Color borderColour = new Color(0.737f, 0.424f, 0.145f, 1f);

        [Header("Panel")]
        [Tooltip("Lower-left corner of the story panel, as fractions of the screen.")]
        public Vector2 panelMin = new Vector2(0.1f, 0.03f);
        [Tooltip("Upper-right corner of the story panel, as fractions of the screen.")]
        public Vector2 panelMax = new Vector2(0.9f, 0.45f);
        [Range(0f, 1f)] public float panelOpacity = 0.96f;
        [Range(0, 120)] public int padding = 32;
        [Tooltip("A border around the panel, in pixels. 0 for none.")]
        [Range(0, 12)] public int borderWidth = 0;

        [Header("Text")]
        [Tooltip("Leave empty for Unity's built-in font. With TextMeshPro, used only when TMP Font is empty (made into a font asset).")]
        public Font font;
#if NARRATIVE_BRIDGE_TMP
        [Tooltip("TextMeshPro font asset for the story. Empty: your project's default TMP font, or one made from Font.")]
        public TMPro.TMP_FontAsset tmpFont;
#endif
        [Tooltip("At the reference resolution; the UI scales with the screen.")]
        [Range(12, 72)] public int fontSize = 30;
        [Range(0.7f, 2.5f)] public float lineSpacing = 1f;
        [Tooltip("Space between the story's lines, as a fraction of the text size.")]
        [Range(0f, 2f)] public float paragraphSpacing = 0.45f;
        public TextAlign textAlign = TextAlign.Left;
        [Tooltip("History: everything so far, scrolling. Scene: cleared at each new scene. Line: only the latest line, one at a time.")]
        public TranscriptMode transcript = TranscriptMode.History;
        [Tooltip("Show the choices the player made among the story's lines.")]
        public bool showChoiceHistory = true;

        [Header("Speakers and scenes")]
        public bool showSpeakers = true;
        public SpeakerStyle speakerStyle = SpeakerStyle.Above;
        [Range(0.4f, 1.6f)] public float speakerScale = 0.7f;
        public bool speakerUppercase = true;
        [Tooltip("Stage directions such as (quietly), after the speaker's name.")]
        public bool showParentheticals = true;
        public bool showSceneHeadings = true;
        [Range(0.4f, 2f)] public float sceneScale = 0.65f;
        public bool sceneUppercase = true;

        [Header("Typing and pacing")]
        [Tooltip("Typewriter speed in characters per second. 0 shows each line at once.")]
        [Min(0f)] public float charactersPerSecond = 45f;
        [Tooltip("Extra pause, in seconds, after a sentence ends while typing.")]
        [Range(0f, 1.5f)] public float punctuationPause = 0f;
        [Tooltip("Each new line fades in over this many seconds. 0 for no fade.")]
        [Range(0f, 2f)] public float lineFade = 0f;
        [Tooltip("A click, Space or Return finishes the line being typed.")]
        public bool clickToSkip = true;
        [Tooltip("Go on past Continue breaks (and, in Line mode, to the next line) by itself.")]
        public bool autoAdvance = false;
        [Min(0.2f)] public float autoAdvanceDelay = 2f;

        [Header("Choices and buttons")]
        public bool showChoiceNumbers = true;
        public ChoiceAlign choiceAlign = ChoiceAlign.Left;
        [Range(0.5f, 1.6f)] public float choiceScale = 0.9f;
        [Tooltip("Button height as a multiple of the text size.")]
        [Range(1f, 4f)] public float choiceHeight = 1.9f;
        [Range(0f, 1.5f)] public float choiceSpacing = 0.25f;
        [Range(0f, 1f)] public float buttonOpacity = 0.14f;
        [Range(0f, 1f)] public float buttonHoverOpacity = 0.3f;
        public string continueLabel = "Continue";
        public bool continueArrow = true;
        public string endLabel = "The End";
        [Tooltip("Choices that need an item or a value the player doesn't have yet, shown greyed out with what they need.")]
        public bool showLockedChoices = true;
        [Tooltip("Before what a locked choice needs, e.g. Needs → Needs Brass Key.")]
        public string lockedLabel = "Needs";

        [Header("Toolbar")]
        [Tooltip("Restart, Save and Load buttons under the story.")]
        public bool showToolbar = true;
        public bool showRestart = true;
        public bool showSave = true;
        public bool showLoad = true;
        [Tooltip("Messages such as Saved. and Loaded.")]
        public bool showStatus = true;
        public string restartLabel = "Restart";
        public string saveLabel = "Save";
        public string loadLabel = "Load";
        [Tooltip("A Settings button for the player: text size, typing speed, auto-advance, high contrast and voice volume (see NarrativeSettings).")]
        public bool showSettings = true;
        public string settingsLabel = "Settings";

        [Header("Scene pictures")]
        [Tooltip("Show scene pictures (#image) behind the panel.")]
        public bool showPictures = true;
        public PictureFit pictureFit = PictureFit.Cover;
        [Tooltip("Darkens the picture, so the panel stands out.")]
        [Range(0f, 0.9f)] public float pictureDim = 0f;
        [Range(0f, 3f)] public float pictureFade = 0.3f;

        [Header("Character portraits")]
        [Tooltip("Show the portrait of the character who is speaking (StoryInfo.PortraitSpeakers).")]
        public bool showPortraits = true;
        public PortraitPlacement portraitPlacement = PortraitPlacement.Above;
        [Tooltip("Alternate: each new speaker takes the other side, as in a conversation.")]
        public PortraitSide portraitSide = PortraitSide.Left;
        [Tooltip("Height in pixels at the reference resolution.")]
        [Range(80, 1000)] public int portraitHeight = 380;
        [Tooltip("Mirror portraits on the right, so characters face inwards.")]
        public bool portraitMirrorRight = false;
        [Range(0f, 2f)] public float portraitFade = 0.2f;
        [Tooltip("Keep the last speaker's portrait during narration (otherwise it's hidden).")]
        public bool keepPortraitForNarration = false;

        [Header("Screen and sound")]
        [Tooltip("The screen size the UI is designed for; it scales to the real screen.")]
        public Vector2 referenceResolution = new Vector2(1920, 1080);
        [Tooltip("0 scales the UI with the screen's width, 1 with its height.")]
        [Range(0f, 1f)] public float matchWidthOrHeight = 0.5f;
        [Range(0f, 1f)] public float voiceVolume = 1f;

        /// <summary>Raised when the theme is edited in the Inspector, so a playing NarrativeView redraws.</summary>
        public event Action Changed;
        void OnValidate() => Changed?.Invoke();

        [Serializable]
        class Exported
        {
            public string background, text, accent, muted, speakerColour, sceneColour, buttonColour, choiceTextColour, borderColour;
            public float panelXMin, panelYMin, panelXMax, panelYMax, panelOpacity;
            public int padding, borderWidth, fontSize, portraitHeight, referenceWidth, referenceHeight;
            public float lineSpacing, paragraphSpacing, speakerScale, sceneScale, charactersPerSecond, punctuationPause, lineFade, autoAdvanceDelay;
            public float choiceScale, choiceHeight, choiceSpacing, buttonOpacity, buttonHoverOpacity, pictureDim, pictureFade, portraitFade, matchWidthOrHeight, voiceVolume;
            public string textAlign, transcript, speakerStyle, choiceAlign, pictureFit, portraitPlacement, portraitSide;
            public string continueLabel, endLabel, restartLabel, saveLabel, loadLabel, lockedLabel, settingsLabel;
            public bool showChoiceHistory, showSpeakers, speakerUppercase, showParentheticals, showSceneHeadings, sceneUppercase, clickToSkip, autoAdvance;
            public bool showChoiceNumbers, continueArrow, showToolbar, showRestart, showSave, showLoad, showStatus, showPictures, showPortraits, portraitMirrorRight, keepPortraitForNarration, showLockedChoices, showSettings;
        }

        /// <summary>Applies a theme exported from Narrative Bridge (the package's Theme.json).</summary>
        public void ApplyExported(string json)
        {
            var e = JsonUtility.FromJson<Exported>(json);
            if (e == null) return;
            background = Parse(e.background, background);
            text = Parse(e.text, text);
            accent = Parse(e.accent, accent);
            muted = Parse(e.muted, muted);
            speakerColour = Parse(e.speakerColour, accent);
            sceneColour = Parse(e.sceneColour, muted);
            buttonColour = Parse(e.buttonColour, accent);
            choiceTextColour = Parse(e.choiceTextColour, text);
            borderColour = Parse(e.borderColour, accent);
            if (e.panelXMax > e.panelXMin && e.panelYMax > e.panelYMin)
            {
                panelMin = new Vector2(e.panelXMin, e.panelYMin);
                panelMax = new Vector2(e.panelXMax, e.panelYMax);
            }
            panelOpacity = Mathf.Clamp01(e.panelOpacity);
            padding = Mathf.Max(0, e.padding);
            borderWidth = Mathf.Max(0, e.borderWidth);
            if (e.fontSize > 0) fontSize = e.fontSize;
            if (e.lineSpacing > 0) lineSpacing = e.lineSpacing;
            paragraphSpacing = Mathf.Max(0f, e.paragraphSpacing);
            textAlign = ParseEnum(e.textAlign, textAlign);
            transcript = ParseEnum(e.transcript, transcript);
            showChoiceHistory = e.showChoiceHistory;
            showSpeakers = e.showSpeakers;
            speakerStyle = ParseEnum(e.speakerStyle, speakerStyle);
            if (e.speakerScale > 0) speakerScale = e.speakerScale;
            speakerUppercase = e.speakerUppercase;
            showParentheticals = e.showParentheticals;
            showSceneHeadings = e.showSceneHeadings;
            if (e.sceneScale > 0) sceneScale = e.sceneScale;
            sceneUppercase = e.sceneUppercase;
            charactersPerSecond = Mathf.Max(0f, e.charactersPerSecond);
            punctuationPause = Mathf.Max(0f, e.punctuationPause);
            lineFade = Mathf.Max(0f, e.lineFade);
            clickToSkip = e.clickToSkip;
            autoAdvance = e.autoAdvance;
            if (e.autoAdvanceDelay > 0) autoAdvanceDelay = e.autoAdvanceDelay;
            showChoiceNumbers = e.showChoiceNumbers;
            choiceAlign = ParseEnum(e.choiceAlign, choiceAlign);
            if (e.choiceScale > 0) choiceScale = e.choiceScale;
            if (e.choiceHeight > 0) choiceHeight = e.choiceHeight;
            choiceSpacing = Mathf.Max(0f, e.choiceSpacing);
            buttonOpacity = Mathf.Clamp01(e.buttonOpacity);
            buttonHoverOpacity = Mathf.Clamp01(e.buttonHoverOpacity);
            if (!string.IsNullOrEmpty(e.continueLabel)) continueLabel = e.continueLabel;
            continueArrow = e.continueArrow;
            if (!string.IsNullOrEmpty(e.endLabel)) endLabel = e.endLabel;
            showToolbar = e.showToolbar;
            showRestart = e.showRestart;
            showSave = e.showSave;
            showLoad = e.showLoad;
            showStatus = e.showStatus;
            if (!string.IsNullOrEmpty(e.restartLabel)) restartLabel = e.restartLabel;
            if (!string.IsNullOrEmpty(e.saveLabel)) saveLabel = e.saveLabel;
            if (!string.IsNullOrEmpty(e.loadLabel)) loadLabel = e.loadLabel;
            showLockedChoices = e.showLockedChoices;
            if (!string.IsNullOrEmpty(e.lockedLabel)) lockedLabel = e.lockedLabel;
            showSettings = e.showSettings;
            if (!string.IsNullOrEmpty(e.settingsLabel)) settingsLabel = e.settingsLabel;
            showPictures = e.showPictures;
            pictureFit = ParseEnum(e.pictureFit, pictureFit);
            pictureDim = Mathf.Clamp(e.pictureDim, 0f, 0.9f);
            pictureFade = Mathf.Max(0f, e.pictureFade);
            showPortraits = e.showPortraits;
            portraitPlacement = ParseEnum(e.portraitPlacement, portraitPlacement);
            portraitSide = ParseEnum(e.portraitSide, portraitSide);
            if (e.portraitHeight > 0) portraitHeight = e.portraitHeight;
            portraitMirrorRight = e.portraitMirrorRight;
            portraitFade = Mathf.Max(0f, e.portraitFade);
            keepPortraitForNarration = e.keepPortraitForNarration;
            if (e.referenceWidth > 0 && e.referenceHeight > 0) referenceResolution = new Vector2(e.referenceWidth, e.referenceHeight);
            matchWidthOrHeight = Mathf.Clamp01(e.matchWidthOrHeight);
            voiceVolume = Mathf.Clamp01(e.voiceVolume);
        }

        /// <summary>A new (unsaved) theme with the exported look, or the defaults if there is none.</summary>
        public static NarrativeTheme LoadExported()
        {
            var theme = CreateInstance<NarrativeTheme>();
            var asset = Resources.Load<TextAsset>(ExportedResource);
            if (asset != null) theme.ApplyExported(asset.text);
            return theme;
        }

        public Font ResolveFont() => font != null ? font : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

#if NARRATIVE_BRIDGE_TMP
        /// <summary>The TextMeshPro font: tmpFont, else the project's default (TMP Settings), else one made from ResolveFont().</summary>
        public TMPro.TMP_FontAsset ResolveFontAsset()
        {
            if (tmpFont != null) return tmpFont;
            if (Resources.Load<TMPro.TMP_Settings>("TMP Settings") != null && TMPro.TMP_Settings.defaultFontAsset != null) return TMPro.TMP_Settings.defaultFontAsset;
            if (madeFontAsset == null) madeFontAsset = TMPro.TMP_FontAsset.CreateFontAsset(ResolveFont());
            return madeFontAsset;
        }

        [NonSerialized] TMPro.TMP_FontAsset madeFontAsset;
#endif

        static Color Parse(string html, Color fallback) => !string.IsNullOrEmpty(html) && ColorUtility.TryParseHtmlString(html, out var c) ? c : fallback;
        static T ParseEnum<T>(string value, T fallback) where T : struct => !string.IsNullOrEmpty(value) && Enum.TryParse(value, true, out T v) ? v : fallback;

        [ContextMenu("Layout/Bottom")] void LayoutBottom() => SetPanel(0.1f, 0.03f, 0.9f, 0.45f);
        [ContextMenu("Layout/Centre")] void LayoutCentre() => SetPanel(0.2f, 0.15f, 0.8f, 0.85f);
        [ContextMenu("Layout/Left")] void LayoutLeft() => SetPanel(0.03f, 0.05f, 0.43f, 0.95f);
        [ContextMenu("Layout/Right")] void LayoutRight() => SetPanel(0.57f, 0.05f, 0.97f, 0.95f);
        [ContextMenu("Layout/Full screen")] void LayoutFull() => SetPanel(0.04f, 0.04f, 0.96f, 0.96f);

        void SetPanel(float xMin, float yMin, float xMax, float yMax)
        {
            panelMin = new Vector2(xMin, yMin);
            panelMax = new Vector2(xMax, yMax);
            Changed?.Invoke();
        }
    }
}
