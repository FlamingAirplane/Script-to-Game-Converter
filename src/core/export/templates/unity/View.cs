using System.Collections;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
#if NARRATIVE_BRIDGE_TMP
using UIText = TMPro.TextMeshProUGUI;
#else
using UIText = UnityEngine.UI.Text;
#endif

namespace __NAMESPACE__
{
    /// <summary>
    /// The story UI: a uGUI panel built at runtime from a NarrativeTheme and driven by a NarrativeController's
    /// events. Story text (scrolling, by scene, or one line at a time), the speaker's portrait, choices, the
    /// Continue button and the ending; Restart, Save and Load are optional. Keys: 1-9 choose, Space or Return
    /// continues (or finishes the typewriter). To design your own UI instead, remove this component and use
    /// the controller's events.
    /// </summary>
    [AddComponentMenu("Narrative Bridge/__MENU_TITLE__/Narrative View")]
    public class NarrativeView : MonoBehaviour
    {
        public NarrativeController controller;
        [Tooltip("Leave empty to use the look exported from Narrative Bridge.")]
        public NarrativeTheme theme;
        [Tooltip("Draw order against your game's other screen-space canvases (higher draws on top).")]
        public int sortingOrder = 100;
        [Tooltip("1-9 choose, Space or Return continue. Turn off if your game uses those keys.")]
        public bool keyboardShortcuts = true;
        [Tooltip("Add an EventSystem when the scene has none, so the buttons can be clicked.")]
        public bool createEventSystem = true;
        [Tooltip("Hide the story panel while the game plays after an exit to the game, and show it again when the story resumes.")]
        public bool hideDuringExits = true;

        /// <summary>Whether the panel is showing (it hides during exits to the game).</summary>
        public bool Visible => Canvas != null && Canvas.enabled;

        public Canvas Canvas { get; private set; }
        public IReadOnlyList<Button> Buttons => buttons;
        // The theme as the player has adjusted it (NarrativeSettings: text size, typing speed, contrast).
        int FontSize => Mathf.Max(8, Mathf.RoundToInt(theme.fontSize * NarrativeSettings.TextScale));
        float CharactersPerSecond => theme.charactersPerSecond * NarrativeSettings.SpeedMultiplier;
        bool AutoAdvance => NarrativeSettings.AutoAdvance == NarrativeSettings.AutoAdvanceMode.AsDesigned ? theme.autoAdvance : NarrativeSettings.AutoAdvance == NarrativeSettings.AutoAdvanceMode.On;
        static bool Contrast => NarrativeSettings.HighContrast;
        Color TextColour => Contrast ? Color.white : theme.text;
        Color Muted => Contrast ? new Color(0.86f, 0.86f, 0.86f, 1f) : theme.muted;
        Color Accent => Contrast ? new Color(1f, 0.85f, 0.35f, 1f) : theme.accent;
        Color SpeakerColour => Contrast ? Accent : theme.speakerColour;
        Color SceneColour => Contrast ? Muted : theme.sceneColour;
        Color ButtonColour => Contrast ? Color.white : theme.buttonColour;
        Color ChoiceTextColour => Contrast ? Color.white : theme.choiceTextColour;
        Color PanelColour => Contrast ? new Color(0.04f, 0.04f, 0.04f, 1f) : WithAlpha(theme.background, theme.panelOpacity);
        float ButtonOpacity => Contrast ? 0.16f : theme.buttonOpacity;
        float ButtonHoverOpacity => Contrast ? 0.34f : theme.buttonHoverOpacity;

        /// <summary>The greyed-out buttons of locked choices (not in Buttons; they can't be clicked).</summary>
        public IReadOnlyList<Button> LockedButtons => lockedButtons;

        /// <summary>A line on screen: its own object, so a scene or Line mode can clear the earlier ones.</summary>
        class Entry
        {
            public NarrativeController.Line Line;
            public GameObject Root;
            public UIText Body;
            public string Prefix = "";
            public string Text = "";
        }

        readonly List<Button> buttons = new List<Button>();
        readonly List<Button> lockedButtons = new List<Button>();
        readonly List<Entry> entries = new List<Entry>();
        readonly Queue<Entry> typing = new Queue<Entry>();
        Font font;
#if NARRATIVE_BRIDGE_TMP
        TMPro.TMP_FontAsset fontAsset;
#endif
        RectTransform panel, lines, choiceArea, portraitRect;
        VerticalLayoutGroup column;
        RawImage picture, portrait;
        Image pictureShade;
        AspectRatioFitter pictureFit, portraitFit;
        ScrollRect scroll;
        UIText status;
        Coroutine typer, autoNext;
        bool skipTyping, choicesWaiting, subscribed, waitingForNextLine;
        string lastSpeaker;
        bool portraitOnRight, portraitOnRightNow;

        void Awake()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
        }

        void OnEnable() => Subscribe();
        void OnDisable() => Unsubscribe();

        void Start()
        {
            if (createEventSystem) EnsureEventSystem();
            Build();
            Redraw();
        }

        void Subscribe()
        {
            if (subscribed || controller == null) return;
            controller.LineShown += OnLine;
            controller.ChoicesShown += OnChoices;
            controller.ContinueShown += OnContinue;
            controller.StoryEnded += OnEnded;
            controller.Restarted += ClearStory;
            controller.StatusChanged += OnStatus;
            controller.ExitReached += OnExit;
            controller.Resumed += OnResumed;
            NarrativeSettings.Changed += OnThemeChanged;
            NarrativeLocalization.Changed += OnLanguageChanged;
            subscribed = true;
        }

        void Unsubscribe()
        {
            if (!subscribed || controller == null) return;
            controller.LineShown -= OnLine;
            controller.ChoicesShown -= OnChoices;
            controller.ContinueShown -= OnContinue;
            controller.StoryEnded -= OnEnded;
            controller.Restarted -= ClearStory;
            controller.StatusChanged -= OnStatus;
            controller.ExitReached -= OnExit;
            controller.Resumed -= OnResumed;
            NarrativeSettings.Changed -= OnThemeChanged;
            NarrativeLocalization.Changed -= OnLanguageChanged;
            if (theme != null) theme.Changed -= OnThemeChanged;
            subscribed = false;
        }

        // Another language: the story's lines (the controller's transcript) and the panel's own words change.
        void OnLanguageChanged()
        {
            if (controller != null) controller.Relocalize();
            OnThemeChanged();
        }

        void OnThemeChanged()
        {
            if (!Application.isPlaying || Canvas == null) return;
            Build();
            Redraw();
        }

        /// <summary>Builds (or rebuilds) the panel from the theme.</summary>
        public void Build()
        {
            if (theme == null) theme = NarrativeTheme.LoadExported();
            Subscribe();
            theme.Changed -= OnThemeChanged; // edits in the Inspector redraw the panel while playing
            theme.Changed += OnThemeChanged;
            if (Canvas != null) Discard(Canvas.gameObject);
            StopTyping();
            buttons.Clear();
            entries.Clear();
            lastSpeaker = null;
            portraitOnRight = portraitOnRightNow = theme.portraitSide == NarrativeTheme.PortraitSide.Right;
            font = theme.ResolveFont();
#if NARRATIVE_BRIDGE_TMP
            fontAsset = theme.ResolveFontAsset();
#endif
            if (controller != null) controller.voiceVolume = theme.voiceVolume * NarrativeSettings.VoiceVolume;

            var canvasObject = new GameObject("Story UI", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            Canvas = canvasObject.GetComponent<Canvas>();
            Canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            Canvas.sortingOrder = sortingOrder;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = theme.referenceResolution;
            scaler.matchWidthOrHeight = theme.matchWidthOrHeight;

            // The scene picture fills the screen behind the panel (cropped, or whole), with an optional shade.
            var art = Child("Scene Picture", canvasObject.transform);
            Stretch(art);
            picture = art.gameObject.AddComponent<RawImage>();
            picture.raycastTarget = false;
            picture.enabled = false;
            pictureFit = art.gameObject.AddComponent<AspectRatioFitter>();
            pictureFit.aspectMode = theme.pictureFit == NarrativeTheme.PictureFit.Contain ? AspectRatioFitter.AspectMode.FitInParent : AspectRatioFitter.AspectMode.EnvelopeParent;
            var shade = Child("Picture Shade", canvasObject.transform);
            Stretch(shade);
            pictureShade = shade.gameObject.AddComponent<Image>();
            pictureShade.color = new Color(0, 0, 0, theme.pictureDim);
            pictureShade.raycastTarget = false;
            pictureShade.enabled = false;

            panel = Child("Panel", canvasObject.transform);
            panel.anchorMin = theme.panelMin;
            panel.anchorMax = theme.panelMax;
            panel.offsetMin = panel.offsetMax = Vector2.zero;
            var background = panel.gameObject.AddComponent<Image>();
            background.color = PanelColour;
            if (theme.borderWidth > 0)
            {
                var border = panel.gameObject.AddComponent<Outline>();
                border.effectColor = theme.borderColour;
                border.effectDistance = new Vector2(theme.borderWidth, -theme.borderWidth);
            }
            column = panel.gameObject.AddComponent<VerticalLayoutGroup>();
            column.padding = new RectOffset(theme.padding, theme.padding, theme.padding, theme.padding);
            column.spacing = FontSize * 0.5f;
            column.childControlWidth = column.childControlHeight = true;
            column.childForceExpandWidth = true;
            column.childForceExpandHeight = false;

            // The speaker's portrait: standing on the panel, or inside it beside the text.
            var inside = theme.portraitPlacement == NarrativeTheme.PortraitPlacement.Inside;
            portraitRect = Child("Portrait", inside ? panel : canvasObject.transform);
            if (inside) portraitRect.gameObject.AddComponent<LayoutElement>().ignoreLayout = true;
            portrait = portraitRect.gameObject.AddComponent<RawImage>();
            portrait.raycastTarget = false;
            portrait.enabled = false;
            portraitFit = portraitRect.gameObject.AddComponent<AspectRatioFitter>();
            portraitFit.aspectMode = AspectRatioFitter.AspectMode.HeightControlsWidth;
            PlacePortrait();

            // Story text, scrolling.
            var story = Child("Story", panel);
            story.gameObject.AddComponent<LayoutElement>().flexibleHeight = 1;
            scroll = story.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 40;
            var viewport = Child("Viewport", story);
            Stretch(viewport);
            viewport.gameObject.AddComponent<RectMask2D>();
            viewport.gameObject.AddComponent<Image>().color = new Color(0, 0, 0, 0); // catches the scroll wheel
            lines = Child("Lines", viewport);
            lines.anchorMin = new Vector2(0, 1);
            lines.anchorMax = new Vector2(1, 1);
            lines.pivot = new Vector2(0.5f, 1);
            lines.offsetMin = lines.offsetMax = Vector2.zero;
            var stack = lines.gameObject.AddComponent<VerticalLayoutGroup>();
            stack.spacing = FontSize * theme.paragraphSpacing;
            stack.childControlWidth = stack.childControlHeight = true;
            stack.childForceExpandWidth = true;
            stack.childForceExpandHeight = false;
            lines.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport;
            scroll.content = lines;

            // Choices, the Continue button and the ending.
            choiceArea = Child("Choices", panel);
            var list = choiceArea.gameObject.AddComponent<VerticalLayoutGroup>();
            list.spacing = FontSize * theme.choiceSpacing;
            list.childControlWidth = list.childControlHeight = true;
            list.childForceExpandWidth = true;
            list.childForceExpandHeight = false;

            status = null;
            if (theme.showToolbar && controller != null && (theme.showRestart || theme.showSave || theme.showLoad || theme.showStatus || theme.showSettings))
            {
                var bar = Child("Toolbar", panel);
                var row = bar.gameObject.AddComponent<HorizontalLayoutGroup>();
                row.spacing = 12;
                row.childAlignment = TextAnchor.MiddleLeft;
                row.childControlWidth = row.childControlHeight = true;
                row.childForceExpandWidth = row.childForceExpandHeight = false;
                if (theme.showRestart) ToolButton(bar, T(theme.restartLabel), controller.StartStory);
                // With save slots, Save and Load open the slot menu; without, they use the one quick save.
                if (theme.showSave) ToolButton(bar, T(theme.saveLabel), () => { if (controller.saveSlots > 0) OpenSaveSlots(true); else controller.SaveToPrefs(); });
                if (theme.showLoad) ToolButton(bar, T(theme.loadLabel), () => { if (controller.saveSlots > 0) OpenSaveSlots(false); else controller.LoadFromPrefs(); });
                if (theme.showSettings) ToolButton(bar, T(theme.settingsLabel), ToggleSettings);
                if (theme.showStatus)
                {
                    status = AddText(bar, controller.Status, Mathf.RoundToInt(FontSize * 0.6f), Muted, FontStyle.Italic, TextAnchor.MiddleLeft);
                    status.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
                }
            }
            BuildSettings();
        }

        // ---- The player's Settings menu (NarrativeSettings) ----------------------------------

        /// <summary>The words of the Settings menu, to change or translate them.</summary>
        [System.Serializable]
        public class SettingsWords
        {
            public string title = "Settings", textSize = "Text size", typingSpeed = "Typing speed", autoAdvance = "Go on by itself", highContrast = "High contrast", voiceVolume = "Voice volume";
            public string slow = "Slow", normal = "Normal", fast = "Fast", instant = "Instant", asDesigned = "As designed", on = "On", off = "Off", reset = "Reset", close = "Close";
            public string language = "Language";
            public string saveTitle = "Save to a slot", loadTitle = "Load a save", slot = "Slot", autosave = "Autosave", empty = "empty", olderVersion = "earlier version";
        }

        [Tooltip("The words of the Settings menu (the toolbar's Settings button), e.g. to translate them.")]
        public SettingsWords settingsWords = new SettingsWords();

        enum Overlay { None, Settings, Save, Load }

        /// <summary>Whether the Settings menu is open.</summary>
        public bool SettingsOpen => overlay == Overlay.Settings;
        /// <summary>Whether the save-slot menu is open (for saving or loading).</summary>
        public bool SlotsOpen => overlay == Overlay.Save || overlay == Overlay.Load;
        /// <summary>The open menu's buttons: Settings (text size, typing speed, auto-advance, contrast, volume, reset, close) or the slots and Close.</summary>
        public IReadOnlyList<Button> SettingsButtons => settingsButtons;

        Overlay overlay;
        bool settingsOpen => overlay != Overlay.None;
        int settingsFocus;
        RectTransform settingsPanel;
        readonly List<Button> settingsButtons = new List<Button>();

        public void ToggleSettings()
        {
            if (SettingsOpen) CloseSettings();
            else OpenSettings();
        }

        public void OpenSettings()
        {
            overlay = Overlay.Settings;
            settingsFocus = 0;
            BuildSettings();
        }

        /// <summary>Opens the save-slot menu, to save into a slot or to load one (the autosave first).</summary>
        public void OpenSaveSlots(bool saving)
        {
            if (controller == null || controller.Story == null) return;
            overlay = saving ? Overlay.Save : Overlay.Load;
            settingsFocus = 0;
            BuildSettings();
        }

        /// <summary>Closes whichever menu is open (Settings or the save slots).</summary>
        public void CloseSettings()
        {
            overlay = Overlay.None;
            settingsButtons.Clear();
            if (settingsPanel != null) Discard(settingsPanel.gameObject);
            settingsPanel = null;
        }

        void BuildSettings()
        {
            settingsButtons.Clear();
            if (settingsPanel != null) Discard(settingsPanel.gameObject);
            settingsPanel = null;
            if (!settingsOpen || Canvas == null) return;
            var w = settingsWords ?? new SettingsWords();
            // A shade over everything (it also keeps clicks from reaching the story), and the menu on it.
            settingsPanel = Child("Settings", Canvas.transform);
            Stretch(settingsPanel);
            settingsPanel.gameObject.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.55f);
            var box = Child("Menu", settingsPanel);
            box.anchorMin = new Vector2(0.2f, 0.08f);
            box.anchorMax = new Vector2(0.8f, 0.92f);
            box.offsetMin = box.offsetMax = Vector2.zero;
            var back = PanelColour;
            box.gameObject.AddComponent<Image>().color = new Color(back.r, back.g, back.b, 1f);
            var list = box.gameObject.AddComponent<VerticalLayoutGroup>();
            list.padding = new RectOffset(theme.padding, theme.padding, theme.padding, theme.padding);
            list.spacing = FontSize * 0.35f;
            list.childControlWidth = list.childControlHeight = true;
            list.childForceExpandWidth = true;
            list.childForceExpandHeight = false;
            list.childAlignment = TextAnchor.UpperCenter;
            if (overlay == Overlay.Save || overlay == Overlay.Load)
            {
                BuildSlots(box, w, overlay == Overlay.Save);
                FocusMenu();
                return;
            }
            AddText(box, T(w.title), FontSize, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);
            SettingButton(box, T(w.textSize) + ":  " + Mathf.RoundToInt(NarrativeSettings.TextScale * 100f) + "%", () => NarrativeSettings.TextScale = NarrativeSettings.Next(NarrativeSettings.TextScales, NarrativeSettings.TextScale));
            SettingButton(box, T(w.typingSpeed) + ":  " + SpeedWord(w), () => NarrativeSettings.TypingSpeed = (NarrativeSettings.Speed)(((int)NarrativeSettings.TypingSpeed + 1) % 4));
            SettingButton(box, T(w.autoAdvance) + ":  " + AutoWord(w), () => NarrativeSettings.AutoAdvance = (NarrativeSettings.AutoAdvanceMode)(((int)NarrativeSettings.AutoAdvance + 1) % 3));
            SettingButton(box, T(w.highContrast) + ":  " + (NarrativeSettings.HighContrast ? T(w.on) : T(w.off)), () => NarrativeSettings.HighContrast = !NarrativeSettings.HighContrast);
            SettingButton(box, T(w.voiceVolume) + ":  " + Mathf.RoundToInt(NarrativeSettings.VoiceVolume * 100f) + "%", () => NarrativeSettings.VoiceVolume = NarrativeSettings.Next(NarrativeSettings.VoiceVolumes, NarrativeSettings.VoiceVolume));
            if (NarrativeLocalization.Languages.Count > 0)
                SettingButton(box, T(w.language) + ":  " + NarrativeLocalization.DisplayName(NarrativeLocalization.Language), NextLanguage);
            SettingButton(box, T(w.reset), NarrativeSettings.Reset);
            SettingButton(box, T(w.close), CloseSettings);
            FocusMenu();
        }

        // Keyboard and gamepad: keep the focus on the row that was just used.
        void FocusMenu()
        {
            var es = EventSystem.current;
            if (es != null && settingsButtons.Count > 0) es.SetSelectedGameObject(settingsButtons[Mathf.Clamp(settingsFocus, 0, settingsButtons.Count - 1)].gameObject);
        }

        void BuildSlots(Transform box, SettingsWords w, bool saving)
        {
            AddText(box, saving ? T(w.saveTitle) : T(w.loadTitle), FontSize, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);
            foreach (var slot in controller.GetSlots())
            {
                // The autosave can be loaded, not saved over.
                if (saving && slot.Slot == NarrativeController.AutosaveSlot) continue;
                var name = slot.Slot == NarrativeController.AutosaveSlot ? T(w.autosave) : T(w.slot) + " " + slot.Slot;
                var label = !slot.Exists ? name + "  ·  " + T(w.empty) : name + "  ·  " + slot.PassageTitle + "  ·  " + slot.SavedAt.ToLocalTime().ToString("g") + (slot.OtherVersion ? "  (" + T(w.olderVersion) + ")" : "");
                var n = slot.Slot;
                var button = SettingButton(box, label, () =>
                {
                    if (saving) controller.SaveToSlot(n);
                    else controller.LoadFromSlot(n);
                    CloseSettings();
                });
                if (!saving && !slot.Exists) button.interactable = false;
            }
            SettingButton(box, T(w.close), CloseSettings);
        }

        Button SettingButton(Transform parent, string label, System.Action onClick)
        {
            var row = settingsButtons.Count;
            var rect = Child(label, parent);
            var image = rect.gameObject.AddComponent<Image>();
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var tint = button.colors;
            tint.normalColor = WithAlpha(ButtonColour, ButtonOpacity);
            tint.highlightedColor = tint.selectedColor = WithAlpha(ButtonColour, ButtonHoverOpacity);
            tint.pressedColor = WithAlpha(ButtonColour, Mathf.Min(1f, ButtonHoverOpacity + 0.15f));
            button.colors = tint;
            rect.gameObject.AddComponent<LayoutElement>().minHeight = FontSize * 1.7f;
            var text = AddText(rect, label, Mathf.RoundToInt(FontSize * 0.8f), ChoiceTextColour, FontStyle.Normal, TextAnchor.MiddleCenter);
            text.rectTransform.anchorMin = Vector2.zero;
            text.rectTransform.anchorMax = Vector2.one;
            text.rectTransform.offsetMin = new Vector2(12, 4);
            text.rectTransform.offsetMax = new Vector2(-12, -4);
            button.onClick.AddListener(() =>
            {
                settingsFocus = row;
                onClick();
            });
            settingsButtons.Add(button);
            return button;
        }

        // The story's own language, then each language in the translation sheet.
        static void NextLanguage()
        {
            var all = new List<string> { "" };
            foreach (var l in NarrativeLocalization.Languages) all.Add(l);
            NarrativeLocalization.Language = all[(all.IndexOf(NarrativeLocalization.Language) + 1) % all.Count];
        }

        static string SpeedWord(SettingsWords w)
        {
            switch (NarrativeSettings.TypingSpeed)
            {
                case NarrativeSettings.Speed.Slow: return T(w.slow);
                case NarrativeSettings.Speed.Fast: return T(w.fast);
                case NarrativeSettings.Speed.Instant: return T(w.instant);
                default: return T(w.normal);
            }
        }

        static string AutoWord(SettingsWords w) =>
            NarrativeSettings.AutoAdvance == NarrativeSettings.AutoAdvanceMode.On ? T(w.on) : NarrativeSettings.AutoAdvance == NarrativeSettings.AutoAdvanceMode.Off ? T(w.off) : T(w.asDesigned);

        /// <summary>Draws everything the controller has shown so far, without the typewriter.</summary>
        public void Redraw()
        {
            if (Canvas == null || controller == null) return;
            ClearStory();
            foreach (var line in controller.Transcript) ShowLine(line, false);
            if (controller.Story == null) return;
            if (controller.HasEnded) OnEnded();
            else ShowChoices();
        }

        void ClearStory()
        {
            if (Canvas != null) Canvas.enabled = true;
            if (lines == null) return;
            StopTyping();
            for (int i = lines.childCount - 1; i >= 0; i--) Discard(lines.GetChild(i).gameObject);
            entries.Clear();
            ClearChoices();
            ShowPicture(null);
            lastSpeaker = null;
            portraitOnRight = theme != null && theme.portraitSide == NarrativeTheme.PortraitSide.Right;
            ShowPortrait(null);
        }

        void OnLine(NarrativeController.Line line) => ShowLine(line, Application.isPlaying);
        void OnChoices(IReadOnlyList<Choice> choices) => QueueChoices();
        void OnContinue() => QueueChoices();

        // An exit to the game: once the lines before it have been shown, the panel steps aside.
        void OnExit(string exit) => QueueChoices();
        void OnResumed()
        {
            if (Canvas != null) Canvas.enabled = true;
        }
        void OnStatus(string message)
        {
            if (status != null) status.text = Markup(message);
        }

        void OnEnded()
        {
            choicesWaiting = false;
            ClearChoices();
            if (choiceArea != null) AddText(choiceArea, T(theme.endLabel), FontSize, Accent, FontStyle.Italic, TextAnchor.MiddleCenter);
        }

        // ---- Scene pictures and portraits ------------------------------------------------------

        /// <summary>Shows a scene picture (an #image file name) behind the panel, or hides it for null.</summary>
        public void ShowPicture(string file)
        {
            if (picture == null) return;
            wantedPicture = file;
            if (file == null) { ApplyPicture(null); return; }
            // At once from Resources; when loaded with Addressables (unless another picture was asked for meanwhile).
            NarrativeController.LoadPictureAsync(file, t => { if (picture != null && wantedPicture == file) ApplyPicture(t); });
        }

        string wantedPicture, wantedPortrait;

        void ApplyPicture(Texture2D texture)
        {
            var changed = picture.texture != texture;
            picture.texture = texture;
            picture.enabled = texture != null;
            if (pictureShade != null) pictureShade.enabled = texture != null && theme.pictureDim > 0f;
            if (texture == null) return;
            pictureFit.aspectRatio = (float)texture.width / Mathf.Max(1, texture.height);
            if (changed) FadeIn(picture, theme.pictureFade);
        }

        /// <summary>The picture being shown, or null.</summary>
        public Texture Picture => picture != null && picture.enabled ? picture.texture : null;

        /// <summary>Shows the portrait of a speaker (by speaker id, the #speaker tag), or hides it for null.</summary>
        public void ShowPortrait(string speakerId)
        {
            if (portrait == null) return;
            wantedPortrait = speakerId;
            var file = speakerId != null && theme.showPortraits ? NarrativeController.PortraitFile(speakerId) : null;
            if (file == null) { ApplyPortrait(speakerId, null); return; }
            NarrativeController.LoadPictureAsync(file, t => { if (portrait != null && wantedPortrait == speakerId) ApplyPortrait(speakerId, t); });
        }

        void ApplyPortrait(string speakerId, Texture2D texture)
        {
            if (texture == null)
            {
                portrait.enabled = false;
                portrait.texture = null;
                SetTextRoom(0f);
                return;
            }
            // Take turns: each new speaker stands on the other side.
            if (theme.portraitSide == NarrativeTheme.PortraitSide.Alternate && lastSpeaker != null && speakerId != lastSpeaker) portraitOnRight = !portraitOnRight;
            lastSpeaker = speakerId;
            var changed = portrait.texture != texture || !portrait.enabled;
            portrait.texture = texture;
            portrait.enabled = true;
            portraitFit.aspectRatio = (float)texture.width / Mathf.Max(1, texture.height);
            PlacePortrait();
            if (changed) FadeIn(portrait, theme.portraitFade);
        }

        /// <summary>The portrait being shown, or null.</summary>
        public Texture Portrait => portrait != null && portrait.enabled ? portrait.texture : null;

        void PlacePortrait()
        {
            if (portraitRect == null) return;
            var right = theme.portraitSide == NarrativeTheme.PortraitSide.Right || (theme.portraitSide == NarrativeTheme.PortraitSide.Alternate && portraitOnRight);
            portraitOnRightNow = right;
            var h = (float)theme.portraitHeight;
            var w = h * portraitFit.aspectRatio;
            if (theme.portraitPlacement == NarrativeTheme.PortraitPlacement.Inside)
            {
                // In the panel's bottom corner, with the text column moved aside to make room.
                portraitRect.anchorMin = portraitRect.anchorMax = portraitRect.pivot = new Vector2(right ? 1 : 0, 0);
                portraitRect.anchoredPosition = new Vector2(right ? -theme.padding : theme.padding, theme.padding);
            }
            else
            {
                // Standing on the panel's top edge, at its left or right end.
                portraitRect.anchorMin = portraitRect.anchorMax = new Vector2(right ? theme.panelMax.x : theme.panelMin.x, theme.panelMax.y);
                portraitRect.pivot = new Vector2(right ? 1 : 0, 0);
                portraitRect.anchoredPosition = Vector2.zero;
            }
            portraitRect.sizeDelta = new Vector2(w, h);
            portrait.uvRect = right && theme.portraitMirrorRight ? new Rect(1, 0, -1, 1) : new Rect(0, 0, 1, 1);
            SetTextRoom(portrait.enabled && theme.portraitPlacement == NarrativeTheme.PortraitPlacement.Inside ? w + theme.padding * 0.75f : 0f);
        }

        /// <summary>Room beside the text for a portrait inside the panel.</summary>
        void SetTextRoom(float room)
        {
            if (column == null) return;
            var p = theme.padding;
            var extra = Mathf.RoundToInt(room);
            column.padding = new RectOffset(p + (portraitOnRightNow ? 0 : extra), p + (portraitOnRightNow ? extra : 0), p, p);
        }

        void FadeIn(Graphic g, float seconds)
        {
            if (!Application.isPlaying || seconds <= 0f || !isActiveAndEnabled) { g.canvasRenderer.SetAlpha(1f); return; }
            g.canvasRenderer.SetAlpha(0f);
            g.CrossFadeAlpha(1f, seconds, true);
        }

        // ---- Lines ---------------------------------------------------------------------------

        void ShowLine(NarrativeController.Line line, bool animate)
        {
            if (lines == null) return;
            if (line.IsChoice && !theme.showChoiceHistory) return;
            var entry = MakeEntry(line);
            // Line mode always goes through the queue, so lines arriving together are shown one at a time.
            if (animate && (CharactersPerSecond > 0f || theme.transcript == NarrativeTheme.TranscriptMode.Line || theme.lineFade > 0f || line.IsCutscene))
            {
                entry.Root.SetActive(false);
                typing.Enqueue(entry);
                if (typer == null) typer = StartCoroutine(TypeAll());
            }
            else
            {
                Begin(entry);
                entry.Body.text = entry.Prefix + Markup(entry.Text);
                ScrollToEnd();
            }
        }

        Entry MakeEntry(NarrativeController.Line line)
        {
            var e = new Entry { Line = line };
            var root = Child("Line", lines);
            e.Root = root.gameObject;
            var group = root.gameObject.AddComponent<VerticalLayoutGroup>();
            group.spacing = FontSize * 0.1f;
            group.childControlWidth = group.childControlHeight = true;
            group.childForceExpandWidth = true;
            group.childForceExpandHeight = false;
            root.gameObject.AddComponent<CanvasGroup>();
            var anchor = Anchor(theme.textAlign);
            if (line.IsChoice)
            {
                e.Body = AddText(root, "", Mathf.RoundToInt(FontSize * 0.8f), Muted, FontStyle.Italic, TextAnchor.UpperCenter);
                e.Text = line.Text;
                return e;
            }
            if (theme.showSceneHeadings && !string.IsNullOrEmpty(line.Scene))
                AddText(root, theme.sceneUppercase ? line.Scene.ToUpperInvariant() : line.Scene, Mathf.RoundToInt(FontSize * theme.sceneScale), SceneColour, FontStyle.Bold, TextAnchor.UpperCenter);
            var paren = theme.showParentheticals && !string.IsNullOrEmpty(line.Paren) ? "(" + line.Paren + ")" : null;
            var name = line.Speaker != null && theme.showSpeakers ? (theme.speakerUppercase ? line.Speaker.ToUpperInvariant() : line.Speaker) : null;
            var inline = theme.speakerStyle == NarrativeTheme.SpeakerStyle.Inline;
            if (!inline && (name != null || paren != null))
                AddText(root, name != null ? name + (paren != null ? "  " + paren : "") : paren, Mathf.RoundToInt(FontSize * theme.speakerScale), SpeakerColour, FontStyle.Bold, anchor);
            var colour = line.IsTransition ? Muted : TextColour;
            e.Body = AddText(root, "", FontSize, colour, line.IsTransition ? FontStyle.Italic : FontStyle.Normal, line.IsTransition ? TextAnchor.UpperRight : anchor);
            e.Text = line.Text;
            if (inline && (name != null || paren != null))
            {
                // The name in its own colour, before the line.
                var label = (name ?? "") + (paren != null ? (name != null ? " " : "") + paren : "") + ": ";
                e.Prefix = "<color=#" + ColorUtility.ToHtmlStringRGBA(SpeakerColour) + "><b>" + Markup(label) + "</b></color>";
            }
            return e;
        }

        /// <summary>A line starts showing: earlier lines may clear, and its picture and portrait appear.</summary>
        void Begin(Entry e)
        {
            var line = e.Line;
            // A cutscene shows one line at a time, like subtitles.
            var clear = line.IsCutscene || theme.transcript == NarrativeTheme.TranscriptMode.Line || (theme.transcript == NarrativeTheme.TranscriptMode.Scene && !string.IsNullOrEmpty(line.Scene));
            if (clear && !line.IsChoice)
            {
                foreach (var old in entries) Discard(old.Root);
                entries.Clear();
            }
            entries.Add(e);
            e.Root.SetActive(true);
            if (theme.lineFade > 0f && Application.isPlaying) StartCoroutine(FadeGroup(e.Root.GetComponent<CanvasGroup>(), theme.lineFade));
            if (line.Image != null && theme.showPictures) ShowPicture(line.Image);
            if (!line.IsChoice)
            {
                if (line.SpeakerId != null) ShowPortrait(line.SpeakerId);
                else if (!theme.keepPortraitForNarration) ShowPortrait(null);
            }
        }

        IEnumerator FadeGroup(CanvasGroup g, float seconds)
        {
            for (float t = 0f; t < seconds && g != null; t += Time.unscaledDeltaTime)
            {
                g.alpha = t / seconds;
                yield return null;
            }
            if (g != null) g.alpha = 1f;
        }

        IEnumerator TypeAll()
        {
            while (typing.Count > 0)
            {
                var next = typing.Peek();
                Begin(next);
                var text = next.Text;
                // Typing counts the letters the reader sees; emphasis tags (<i>, <b>, <u>) aren't typed out.
                var visible = Plain(text);
                if (CharactersPerSecond > 0f)
                {
                    var shown = 0f;
                    var pause = 0f;
                    var count = 0;
                    while (!skipTyping && count < visible.Length)
                    {
                        if (pause > 0f) { pause -= Time.unscaledDeltaTime; yield return null; continue; }
                        shown += CharactersPerSecond * Time.unscaledDeltaTime;
                        var now = Mathf.Min(visible.Length, (int)shown);
                        // A pause at the end of a sentence (. ! ? or …), before the next word.
                        if (theme.punctuationPause > 0f)
                            for (int i = count; i < now; i++)
                                if (IsSentenceEnd(visible, i)) { now = i + 1; shown = now; pause = theme.punctuationPause; break; }
                        count = now;
                        next.Body.text = next.Prefix + Markup(Typed(text, count));
                        ScrollToEnd();
                        yield return null;
                    }
                }
                next.Body.text = next.Prefix + Markup(text);
                skipTyping = false;
                typing.Dequeue();
                ScrollToEnd();
                // Line mode: one line at a time. The reader goes on (or it goes on by itself).
                // A cutscene goes on by itself after time to read the line (unless the player turned that Off); Skip goes on now.
                var cutscene = next.Line.IsCutscene;
                if ((cutscene || theme.transcript == NarrativeTheme.TranscriptMode.Line) && typing.Count > 0)
                {
                    waitingForNextLine = true;
                    ClearChoices();
                    AddButton(cutscene ? T("Skip") + "  ›" : ContinueText(), NextLine, TextAnchor.MiddleCenter);
                    var waited = 0f;
                    var hold = cutscene ? CutsceneSeconds(visible) : theme.autoAdvanceDelay;
                    var auto = cutscene ? NarrativeSettings.AutoAdvance != NarrativeSettings.AutoAdvanceMode.Off : AutoAdvance;
                    while (waitingForNextLine)
                    {
                        waited += Time.unscaledDeltaTime;
                        if (auto && waited >= hold) waitingForNextLine = false;
                        yield return null;
                    }
                    ClearChoices();
                }
            }
            typer = null;
            ScrollToEnd();
            if (choicesWaiting) ShowChoices();
        }

        /// <summary>How long a cutscene line stays: time to read it, 2 to 9 seconds (as in Playtest).</summary>
        static float CutsceneSeconds(string s) => Mathf.Clamp(1.2f + s.Length * 0.055f, 2f, 9f);

        static bool IsSentenceEnd(string s, int i)
        {
            var c = s[i];
            return (c == '.' || c == '!' || c == '?' || c == '…') && i + 1 < s.Length && s[i + 1] == ' ';
        }

        void NextLine() => waitingForNextLine = false;

        /// <summary>Shows the rest of the text being typed at once.</summary>
        public void FinishTyping()
        {
            if (typer != null) skipTyping = true;
        }

        void StopTyping()
        {
            if (typer != null) StopCoroutine(typer);
            typer = null;
            skipTyping = false;
            waitingForNextLine = false;
            typing.Clear();
            if (autoNext != null) StopCoroutine(autoNext);
            autoNext = null;
        }

        void QueueChoices()
        {
            choicesWaiting = true;
            if (typer == null) ShowChoices();
        }

        string ContinueText() => T(theme.continueLabel) + (theme.continueArrow ? "  ›" : "");

        /// <summary>Words in the current language (NarrativeLocalization), or as written.</summary>
        static string T(string words) => NarrativeLocalization.Translate(words);

        void ShowChoices()
        {
            choicesWaiting = false;
            ClearChoices();
            if (choiceArea == null || controller == null || controller.Story == null) return;
            if (Canvas != null) Canvas.enabled = true;
            if (controller.IsAtExit)
            {
                // The game plays now; it resumes the story with controller.Resume() or ResumeAt(passage).
                if (hideDuringExits && Canvas != null) Canvas.enabled = false;
                return;
            }
            if (controller.IsWaitingForContinue)
            {
                AddButton(ContinueText(), controller.Continue, TextAnchor.MiddleCenter);
                if (AutoAdvance && Application.isPlaying) autoNext = StartCoroutine(ContinueAfter(theme.autoAdvanceDelay, controller.Story.state.currentTurnIndex));
                return;
            }
            var anchor = theme.choiceAlign == NarrativeTheme.ChoiceAlign.Center ? TextAnchor.MiddleCenter : TextAnchor.MiddleLeft;
            var choices = controller.Story.currentChoices;
            for (int i = 0; i < choices.Count; i++)
            {
                var index = i;
                // A choice taken before (in this read or an earlier one) is greyed out, still clickable.
                AddButton((theme.showChoiceNumbers ? (i + 1) + ".  " : "") + NarrativeController.ChoiceText(choices[i]), () => controller.Choose(index), anchor, false, controller.WasChosen(choices[i]));
            }
            // Choices that need something the reader doesn't have yet: greyed out, saying what they need.
            if (theme.showLockedChoices)
                foreach (var l in controller.LockedChoices)
                    AddButton(l.Text + "   ·   " + (string.IsNullOrEmpty(theme.lockedLabel) ? "" : T(theme.lockedLabel) + " ") + l.Needs, null, anchor, true);
        }

        IEnumerator ContinueAfter(float seconds, int turn)
        {
            yield return new WaitForSecondsRealtime(seconds);
            autoNext = null;
            if (controller != null && controller.IsWaitingForContinue && controller.Story.state.currentTurnIndex == turn) controller.Continue();
        }

        void ClearChoices()
        {
            buttons.Clear();
            lockedButtons.Clear();
            if (choiceArea == null) return;
            for (int i = choiceArea.childCount - 1; i >= 0; i--) Discard(choiceArea.GetChild(i).gameObject);
        }

        void Update()
        {
            if (settingsOpen)
            {
                if (keyboardShortcuts && EscapePressed()) CloseSettings();
                return; // the menu has the keys while it's open
            }
            if (!keyboardShortcuts || controller == null || controller.Story == null) return;
            if (ContinuePressed())
            {
                if (typer != null && waitingForNextLine) NextLine();
                else if (typer != null) { if (theme.clickToSkip) FinishTyping(); }
                else if (controller.IsWaitingForContinue) controller.Continue();
            }
            else if (typer != null && !waitingForNextLine && theme.clickToSkip && ClickPressed()) FinishTyping();
            else if (typer == null)
                for (int i = 0; i < 9 && i < buttons.Count; i++)
                    if (NumberPressed(i + 1)) { buttons[i].onClick.Invoke(); break; }
        }

        // Keys work with the old Input Manager and with the Input System package, whichever the game uses.
#if ENABLE_LEGACY_INPUT_MANAGER
        static bool ContinuePressed() => Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return);
        static bool ClickPressed() => Input.GetMouseButtonDown(0);
        static bool NumberPressed(int n) => Input.GetKeyDown(KeyCode.Alpha0 + n);
        static bool EscapePressed() => Input.GetKeyDown(KeyCode.Escape);
#elif NARRATIVE_BRIDGE_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
        static bool ContinuePressed()
        {
            var k = UnityEngine.InputSystem.Keyboard.current;
            return k != null && (k.spaceKey.wasPressedThisFrame || k.enterKey.wasPressedThisFrame);
        }
        static bool ClickPressed()
        {
            var m = UnityEngine.InputSystem.Mouse.current;
            return m != null && m.leftButton.wasPressedThisFrame;
        }
        static bool NumberPressed(int n)
        {
            var k = UnityEngine.InputSystem.Keyboard.current;
            return k != null && k[UnityEngine.InputSystem.Key.Digit1 + (n - 1)].wasPressedThisFrame;
        }
        static bool EscapePressed()
        {
            var k = UnityEngine.InputSystem.Keyboard.current;
            return k != null && k.escapeKey.wasPressedThisFrame;
        }
#else
        static bool ContinuePressed() => false;
        static bool ClickPressed() => false;
        static bool NumberPressed(int n) => false;
        static bool EscapePressed() => false;
#endif

        // ---- Building blocks -------------------------------------------------------------

        static RectTransform Child(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        static void Stretch(RectTransform r)
        {
            r.anchorMin = Vector2.zero;
            r.anchorMax = Vector2.one;
            r.offsetMin = r.offsetMax = Vector2.zero;
        }

        static TextAnchor Anchor(NarrativeTheme.TextAlign a) =>
            a == NarrativeTheme.TextAlign.Center ? TextAnchor.UpperCenter : a == NarrativeTheme.TextAlign.Right ? TextAnchor.UpperRight : TextAnchor.UpperLeft;

        // Text is TextMeshPro when the game has it (Unity 6, or the TextMeshPro package), and Unity's
        // older Text component otherwise; the story panel looks the same either way.
        UIText AddText(Transform parent, string value, int size, Color color, FontStyle style, TextAnchor anchor)
        {
            var t = Child("Text", parent).gameObject.AddComponent<UIText>();
            t.fontSize = size;
            t.color = color;
            t.raycastTarget = false;
#if NARRATIVE_BRIDGE_TMP
            if (fontAsset != null) t.font = fontAsset;
            t.fontStyle = style == FontStyle.Bold ? TMPro.FontStyles.Bold : style == FontStyle.Italic ? TMPro.FontStyles.Italic : style == FontStyle.BoldAndItalic ? TMPro.FontStyles.Bold | TMPro.FontStyles.Italic : TMPro.FontStyles.Normal;
            t.alignment = TmpAlignment(anchor);
            // TextMeshPro's line spacing is added space, in hundredths of the text size.
            t.lineSpacing = (theme.lineSpacing - 1f) * 100f;
            t.overflowMode = TMPro.TextOverflowModes.Overflow;
#else
            t.font = font;
            t.fontStyle = style;
            t.alignment = anchor;
            t.lineSpacing = theme.lineSpacing;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
#endif
            // Story text is shown as written: only its emphasis (<i>, <b>, <u>) is read as markup (see Markup).
            SetRichText(t, true);
            t.text = Markup(value);
            return t;
        }

        /// <summary>
        /// Text made safe for rich text: the story's emphasis tags (<i>, <b>, <u>) are kept, and any other "<" is shown
        /// as written instead of being read as markup. uGUI's Text has no underline, so <u> is left out there.
        /// </summary>
        public static string Markup(string s)
        {
            if (string.IsNullOrEmpty(s) || s.IndexOf('<') < 0) return s;
            var sb = new System.Text.StringBuilder(s.Length + 16);
            for (int i = 0; i < s.Length; i++)
            {
                if (s[i] != '<') { sb.Append(s[i]); continue; }
                var tag = EmphasisTagAt(s, i);
                if (tag > 0)
                {
#if !NARRATIVE_BRIDGE_TMP
                    if (s[i + tag - 2] == 'u') { i += tag - 1; continue; }
#endif
                    sb.Append(s, i, tag);
                    i += tag - 1;
                    continue;
                }
#if NARRATIVE_BRIDGE_TMP
                sb.Append("<noparse><</noparse>");
#else
                // uGUI's Text has no way to escape: a zero-width space keeps "<b" or "<color" from being a tag.
                sb.Append(i + 1 < s.Length && (char.IsLetter(s[i + 1]) || s[i + 1] == '/') ? "<\u200B" : "<");
#endif
            }
            return sb.ToString();
        }

        /// <summary>The length of the emphasis tag (<i>, </b>, …) starting at i, or 0.</summary>
        static int EmphasisTagAt(string s, int i)
        {
            if (s[i] != '<') return 0;
            var j = i + 1;
            if (j < s.Length && s[j] == '/') j++;
            return j + 1 < s.Length && (s[j] == 'i' || s[j] == 'b' || s[j] == 'u') && s[j + 1] == '>' ? j + 2 - i : 0;
        }

        /// <summary>The text without its emphasis tags: what the reader sees.</summary>
        public static string Plain(string s)
        {
            if (string.IsNullOrEmpty(s) || s.IndexOf('<') < 0) return s;
            var sb = new System.Text.StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                var tag = EmphasisTagAt(s, i);
                if (tag > 0) i += tag - 1;
                else sb.Append(s[i]);
            }
            return sb.ToString();
        }

        /// <summary>The first count letters the reader sees, with the emphasis tags around them kept and closed.</summary>
        public static string Typed(string s, int count)
        {
            if (s.IndexOf('<') < 0) return s.Substring(0, Mathf.Min(count, s.Length));
            var sb = new System.Text.StringBuilder(s.Length + 8);
            var open = new List<char>();
            var seen = 0;
            for (int i = 0; i < s.Length; i++)
            {
                var tag = EmphasisTagAt(s, i);
                if (tag > 0)
                {
                    var name = s[i + tag - 2];
                    if (s[i + 1] == '/') { var k = open.LastIndexOf(name); if (k >= 0) open.RemoveAt(k); }
                    else if (seen >= count) break;
                    else open.Add(name);
                    sb.Append(s, i, tag);
                    i += tag - 1;
                    continue;
                }
                if (seen >= count) break;
                sb.Append(s[i]);
                seen++;
            }
            for (int k = open.Count - 1; k >= 0; k--) sb.Append("</").Append(open[k]).Append('>');
            return sb.ToString();
        }

        static void SetRichText(UIText t, bool on)
        {
#if NARRATIVE_BRIDGE_TMP
            t.richText = on;
#else
            t.supportRichText = on;
#endif
        }

#if NARRATIVE_BRIDGE_TMP
        static TMPro.TextAlignmentOptions TmpAlignment(TextAnchor a)
        {
            switch (a)
            {
                case TextAnchor.UpperCenter: return TMPro.TextAlignmentOptions.Top;
                case TextAnchor.UpperRight: return TMPro.TextAlignmentOptions.TopRight;
                case TextAnchor.MiddleLeft: return TMPro.TextAlignmentOptions.Left;
                case TextAnchor.MiddleCenter: return TMPro.TextAlignmentOptions.Center;
                case TextAnchor.MiddleRight: return TMPro.TextAlignmentOptions.Right;
                default: return TMPro.TextAlignmentOptions.TopLeft;
            }
        }
#endif

        Button AddButton(string label, UnityEngine.Events.UnityAction onClick, TextAnchor anchor, bool locked = false, bool chosen = false)
        {
            var rect = Child("Choice", choiceArea);
            var image = rect.gameObject.AddComponent<Image>();
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var tint = button.colors;
            tint.normalColor = WithAlpha(ButtonColour, ButtonOpacity);
            tint.highlightedColor = WithAlpha(ButtonColour, ButtonHoverOpacity);
            tint.selectedColor = tint.highlightedColor;
            tint.pressedColor = WithAlpha(ButtonColour, Mathf.Min(1f, ButtonHoverOpacity + 0.15f));
            tint.disabledColor = WithAlpha(ButtonColour, ButtonOpacity * 0.4f);
            button.colors = tint;
            rect.gameObject.AddComponent<LayoutElement>().minHeight = FontSize * theme.choiceHeight;
            var text = AddText(rect, label, Mathf.RoundToInt(FontSize * theme.choiceScale), locked || chosen ? Muted : ChoiceTextColour, locked ? FontStyle.Italic : FontStyle.Normal, anchor);
            var tr = text.rectTransform;
            tr.anchorMin = Vector2.zero;
            tr.anchorMax = Vector2.one;
            tr.offsetMin = new Vector2(18, 6);
            tr.offsetMax = new Vector2(-18, -6);
            if (locked)
            {
                button.interactable = false;
                lockedButtons.Add(button);
                return button;
            }
            button.onClick.AddListener(onClick);
            buttons.Add(button);
            return button;
        }

        void ToolButton(Transform parent, string label, UnityEngine.Events.UnityAction onClick)
        {
            var rect = Child(label, parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = WithAlpha(ButtonColour, Mathf.Max(0.12f, ButtonOpacity));
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(onClick);
            var size = rect.gameObject.AddComponent<LayoutElement>();
            size.minWidth = FontSize * 3.2f;
            size.minHeight = FontSize * 1.3f;
            var text = AddText(rect, label, Mathf.RoundToInt(FontSize * 0.6f), ChoiceTextColour, FontStyle.Normal, TextAnchor.MiddleCenter);
            text.rectTransform.anchorMin = Vector2.zero;
            text.rectTransform.anchorMax = Vector2.one;
            text.rectTransform.offsetMin = text.rectTransform.offsetMax = Vector2.zero;
        }

        void ScrollToEnd()
        {
            if (scroll == null) return;
            Canvas.ForceUpdateCanvases();
            scroll.verticalNormalizedPosition = 0f;
        }

        static Color WithAlpha(Color c, float a) => new Color(c.r, c.g, c.b, a);

        static void EnsureEventSystem()
        {
            // Your game's own EventSystem is used when there is one, even a disabled one.
            if (!Application.isPlaying || EventSystem.current != null || UnityEngine.Object.FindAnyObjectByType<EventSystem>(FindObjectsInactive.Include) != null) return;
            var es = new GameObject("EventSystem", typeof(EventSystem));
#if ENABLE_LEGACY_INPUT_MANAGER
            es.AddComponent<StandaloneInputModule>();
#elif NARRATIVE_BRIDGE_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
            es.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>();
#else
            Debug.LogWarning("[NarrativeBridge] Add an input module to the EventSystem so the story's buttons can be clicked.");
#endif
        }

        static void Discard(UnityEngine.Object o)
        {
            if (Application.isPlaying) UnityEngine.Object.Destroy(o);
            else UnityEngine.Object.DestroyImmediate(o);
        }
    }
}
