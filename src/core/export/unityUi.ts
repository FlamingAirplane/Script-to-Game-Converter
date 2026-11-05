// The Unity story UI: a theme asset the developer edits in the Inspector (NarrativeTheme) and a uGUI
// view built from it at runtime (NarrativeView). The writer's choices from the Export page arrive as
// Resources/NarrativeBridgeTheme.json (see unityTheme.ts). These are C# sources inside template
// literals: keep backslashes out of them (none are needed), and don't use `${`.

export const THEME_CS = `using System;
using UnityEngine;

namespace NarrativeBridge
{
    /// <summary>
    /// How the story UI looks. The demo scene's theme asset is made from the look chosen in Narrative Bridge
    /// (Resources/NarrativeBridgeTheme.json); change it here in the Inspector, even while playing.
    /// Narrative Bridge → Reset Theme to Exported Defaults brings back the exported look.
    /// </summary>
    [CreateAssetMenu(menuName = "Narrative Bridge/Theme", fileName = "NarrativeTheme")]
    public class NarrativeTheme : ScriptableObject
    {
        public const string ExportedResource = "NarrativeBridgeTheme";

        [Header("Colours")]
        public Color background = new Color(0.996f, 0.98f, 0.878f, 1f);
        public Color text = new Color(0.157f, 0.212f, 0.094f, 1f);
        [Tooltip("Speaker names, choice buttons and the Continue button.")]
        public Color accent = new Color(0.737f, 0.424f, 0.145f, 1f);
        [Tooltip("Scene headings, stage directions, transitions and the status line.")]
        public Color muted = new Color(0.376f, 0.424f, 0.22f, 1f);

        [Header("Panel")]
        [Tooltip("Lower-left corner of the story panel, as fractions of the screen.")]
        public Vector2 panelMin = new Vector2(0.1f, 0.03f);
        [Tooltip("Upper-right corner of the story panel, as fractions of the screen.")]
        public Vector2 panelMax = new Vector2(0.9f, 0.45f);
        [Range(0f, 1f)] public float panelOpacity = 0.96f;
        [Range(8, 96)] public int padding = 32;

        [Header("Text")]
        [Tooltip("Leave empty for Unity's built-in font.")]
        public Font font;
        [Tooltip("At a 1920 x 1080 screen; the UI scales with the screen.")]
        [Range(12, 72)] public int fontSize = 30;
        [Tooltip("Typewriter speed in characters per second. 0 shows each line at once.")]
        [Min(0f)] public float charactersPerSecond = 45f;

        [Header("Show")]
        public bool showSpeakers = true;
        public bool showSceneHeadings = true;
        public bool showChoiceNumbers = true;
        [Tooltip("Restart, Save and Load buttons under the story.")]
        public bool showToolbar = true;
        [Tooltip("Show scene pictures (#image) full screen behind the panel.")]
        public bool showPictures = true;

        [Header("Words")]
        public string continueLabel = "Continue";
        public string endLabel = "The End";

        /// <summary>Raised when the theme is edited in the Inspector, so a playing NarrativeView redraws.</summary>
        public event Action Changed;
        void OnValidate() => Changed?.Invoke();

        [Serializable]
        class Exported
        {
            public string background, text, accent, muted, continueLabel, endLabel;
            public int fontSize;
            public float panelOpacity, charactersPerSecond, panelXMin, panelYMin, panelXMax, panelYMax;
            public bool showSpeakers, showSceneHeadings, showChoiceNumbers, showToolbar, showPictures;
        }

        /// <summary>Applies a theme exported from Narrative Bridge (NarrativeBridgeTheme.json).</summary>
        public void ApplyExported(string json)
        {
            var e = JsonUtility.FromJson<Exported>(json);
            if (e == null) return;
            background = Parse(e.background, background);
            text = Parse(e.text, text);
            accent = Parse(e.accent, accent);
            muted = Parse(e.muted, muted);
            if (e.panelXMax > e.panelXMin && e.panelYMax > e.panelYMin)
            {
                panelMin = new Vector2(e.panelXMin, e.panelYMin);
                panelMax = new Vector2(e.panelXMax, e.panelYMax);
            }
            panelOpacity = Mathf.Clamp01(e.panelOpacity);
            if (e.fontSize > 0) fontSize = e.fontSize;
            charactersPerSecond = Mathf.Max(0f, e.charactersPerSecond);
            showSpeakers = e.showSpeakers;
            showSceneHeadings = e.showSceneHeadings;
            showChoiceNumbers = e.showChoiceNumbers;
            showToolbar = e.showToolbar;
            showPictures = e.showPictures;
            if (!string.IsNullOrEmpty(e.continueLabel)) continueLabel = e.continueLabel;
            if (!string.IsNullOrEmpty(e.endLabel)) endLabel = e.endLabel;
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

        static Color Parse(string html, Color fallback) => !string.IsNullOrEmpty(html) && ColorUtility.TryParseHtmlString(html, out var c) ? c : fallback;

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
`;

export const VIEW_CS = `using System.Collections;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace NarrativeBridge
{
    /// <summary>
    /// The story UI: a uGUI panel built at runtime from a NarrativeTheme and driven by a NarrativeController's
    /// events. Story text scrolls; choices, the Continue button and the ending sit below; Restart, Save and
    /// Load are optional. Keys: 1-9 choose, Space or Return continues (or finishes the typewriter).
    /// To design your own UI instead, remove this component and use the controller's events.
    /// </summary>
    public class NarrativeView : MonoBehaviour
    {
        public NarrativeController controller;
        [Tooltip("Leave empty to use the look exported from Narrative Bridge.")]
        public NarrativeTheme theme;

        public Canvas Canvas { get; private set; }
        public IReadOnlyList<Button> Buttons => buttons;

        readonly List<Button> buttons = new List<Button>();
        readonly Queue<KeyValuePair<Text, string>> typing = new Queue<KeyValuePair<Text, string>>();
        Font font;
        RectTransform lines, choiceArea;
        RawImage picture;
        AspectRatioFitter pictureFit;
        ScrollRect scroll;
        Text status;
        Coroutine typer;
        bool skipTyping, choicesWaiting, subscribed;

        void Awake()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
        }

        void OnEnable() => Subscribe();
        void OnDisable() => Unsubscribe();

        void Start()
        {
            EnsureEventSystem();
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
            if (theme != null) theme.Changed -= OnThemeChanged;
            subscribed = false;
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
            buttons.Clear();
            typing.Clear();
            typer = null;
            font = theme.ResolveFont();

            var canvasObject = new GameObject("Story UI", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            Canvas = canvasObject.GetComponent<Canvas>();
            Canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            Canvas.sortingOrder = 100;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            scaler.matchWidthOrHeight = 0.5f;

            // The scene picture fills the screen behind the panel, cropped to keep its shape.
            var art = Child("Scene Picture", canvasObject.transform);
            art.anchorMin = Vector2.zero;
            art.anchorMax = Vector2.one;
            art.offsetMin = art.offsetMax = Vector2.zero;
            picture = art.gameObject.AddComponent<RawImage>();
            picture.raycastTarget = false;
            picture.enabled = false;
            pictureFit = art.gameObject.AddComponent<AspectRatioFitter>();
            pictureFit.aspectMode = AspectRatioFitter.AspectMode.EnvelopeParent;

            var panel = Child("Panel", canvasObject.transform);
            panel.anchorMin = theme.panelMin;
            panel.anchorMax = theme.panelMax;
            panel.offsetMin = panel.offsetMax = Vector2.zero;
            var background = panel.gameObject.AddComponent<Image>();
            background.color = WithAlpha(theme.background, theme.panelOpacity);
            var column = panel.gameObject.AddComponent<VerticalLayoutGroup>();
            column.padding = new RectOffset(theme.padding, theme.padding, theme.padding, theme.padding);
            column.spacing = theme.fontSize * 0.5f;
            column.childControlWidth = column.childControlHeight = true;
            column.childForceExpandWidth = true;
            column.childForceExpandHeight = false;

            // Story text, scrolling.
            var story = Child("Story", panel);
            story.gameObject.AddComponent<LayoutElement>().flexibleHeight = 1;
            scroll = story.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 40;
            var viewport = Child("Viewport", story);
            viewport.anchorMin = Vector2.zero;
            viewport.anchorMax = Vector2.one;
            viewport.offsetMin = viewport.offsetMax = Vector2.zero;
            viewport.gameObject.AddComponent<RectMask2D>();
            viewport.gameObject.AddComponent<Image>().color = new Color(0, 0, 0, 0); // catches the scroll wheel
            lines = Child("Lines", viewport);
            lines.anchorMin = new Vector2(0, 1);
            lines.anchorMax = new Vector2(1, 1);
            lines.pivot = new Vector2(0.5f, 1);
            lines.offsetMin = lines.offsetMax = Vector2.zero;
            var stack = lines.gameObject.AddComponent<VerticalLayoutGroup>();
            stack.spacing = theme.fontSize * 0.45f;
            stack.childControlWidth = stack.childControlHeight = true;
            stack.childForceExpandWidth = true;
            stack.childForceExpandHeight = false;
            lines.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = viewport;
            scroll.content = lines;

            // Choices, the Continue button and the ending.
            choiceArea = Child("Choices", panel);
            var list = choiceArea.gameObject.AddComponent<VerticalLayoutGroup>();
            list.spacing = theme.fontSize * 0.25f;
            list.childControlWidth = list.childControlHeight = true;
            list.childForceExpandWidth = true;
            list.childForceExpandHeight = false;

            status = null;
            if (theme.showToolbar && controller != null)
            {
                var bar = Child("Toolbar", panel);
                var row = bar.gameObject.AddComponent<HorizontalLayoutGroup>();
                row.spacing = 12;
                row.childAlignment = TextAnchor.MiddleLeft;
                row.childControlWidth = row.childControlHeight = true;
                row.childForceExpandWidth = row.childForceExpandHeight = false;
                ToolButton(bar, "Restart", controller.StartStory);
                ToolButton(bar, "Save", controller.SaveToPrefs);
                ToolButton(bar, "Load", controller.LoadFromPrefs);
                status = AddText(bar, controller.Status, Mathf.RoundToInt(theme.fontSize * 0.6f), theme.muted, FontStyle.Italic, TextAnchor.MiddleLeft);
                status.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            }
        }

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
            if (lines == null) return;
            StopTyping();
            for (int i = lines.childCount - 1; i >= 0; i--) Discard(lines.GetChild(i).gameObject);
            ClearChoices();
            ShowPicture(null);
        }

        void OnLine(NarrativeController.Line line) => ShowLine(line, Application.isPlaying && theme.charactersPerSecond > 0f);
        void OnChoices(IReadOnlyList<Choice> choices) => QueueChoices();
        void OnContinue() => QueueChoices();
        void OnStatus(string message)
        {
            if (status != null) status.text = message;
        }

        void OnEnded()
        {
            choicesWaiting = false;
            ClearChoices();
            if (choiceArea != null) AddText(choiceArea, theme.endLabel, theme.fontSize, theme.accent, FontStyle.Italic, TextAnchor.MiddleCenter);
        }

        /// <summary>Shows a scene picture (an #image file name) behind the panel, or hides it for null.</summary>
        public void ShowPicture(string file)
        {
            if (picture == null) return;
            var texture = NarrativeController.LoadPicture(file);
            picture.texture = texture;
            picture.enabled = texture != null;
            if (texture != null) pictureFit.aspectRatio = (float)texture.width / Mathf.Max(1, texture.height);
        }

        /// <summary>The picture being shown, or null.</summary>
        public Texture Picture => picture != null && picture.enabled ? picture.texture : null;

        void ShowLine(NarrativeController.Line line, bool animate)
        {
            if (lines == null) return;
            if (line.Image != null && theme.showPictures) ShowPicture(line.Image);
            if (line.IsChoice)
            {
                AddText(lines, line.Text, Mathf.RoundToInt(theme.fontSize * 0.8f), theme.muted, FontStyle.Italic, TextAnchor.UpperCenter);
                ScrollToEnd();
                return;
            }
            if (theme.showSceneHeadings && !string.IsNullOrEmpty(line.Scene))
                AddText(lines, line.Scene.ToUpperInvariant(), Mathf.RoundToInt(theme.fontSize * 0.65f), theme.muted, FontStyle.Bold, TextAnchor.UpperCenter);
            if (line.Speaker != null && theme.showSpeakers)
                AddText(lines, line.Speaker.ToUpperInvariant() + (string.IsNullOrEmpty(line.Paren) ? "" : "  (" + line.Paren + ")"), Mathf.RoundToInt(theme.fontSize * 0.7f), theme.accent, FontStyle.Bold, TextAnchor.UpperLeft);
            var body = AddText(lines, animate ? "" : line.Text, theme.fontSize, line.IsTransition ? theme.muted : theme.text, line.IsTransition ? FontStyle.Italic : FontStyle.Normal, line.IsTransition ? TextAnchor.UpperRight : TextAnchor.UpperLeft);
            if (animate)
            {
                typing.Enqueue(new KeyValuePair<Text, string>(body, line.Text));
                if (typer == null) typer = StartCoroutine(TypeAll());
            }
            ScrollToEnd();
        }

        IEnumerator TypeAll()
        {
            while (typing.Count > 0)
            {
                var next = typing.Peek();
                var shown = 0f;
                while (!skipTyping && shown < next.Value.Length)
                {
                    shown += theme.charactersPerSecond * Time.unscaledDeltaTime;
                    next.Key.text = next.Value.Substring(0, Mathf.Min(next.Value.Length, (int)shown));
                    ScrollToEnd();
                    yield return null;
                }
                next.Key.text = next.Value;
                typing.Dequeue();
            }
            skipTyping = false;
            typer = null;
            ScrollToEnd();
            if (choicesWaiting) ShowChoices();
        }

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
            typing.Clear();
        }

        void QueueChoices()
        {
            choicesWaiting = true;
            if (typer == null) ShowChoices();
        }

        void ShowChoices()
        {
            choicesWaiting = false;
            ClearChoices();
            if (choiceArea == null || controller == null || controller.Story == null) return;
            if (controller.IsWaitingForContinue)
            {
                AddButton(theme.continueLabel + "  ›", controller.Continue, TextAnchor.MiddleCenter);
                return;
            }
            var choices = controller.Story.currentChoices;
            for (int i = 0; i < choices.Count; i++)
            {
                var index = i;
                AddButton((theme.showChoiceNumbers ? (i + 1) + ".  " : "") + choices[i].text, () => controller.Choose(index), TextAnchor.MiddleLeft);
            }
        }

        void ClearChoices()
        {
            buttons.Clear();
            if (choiceArea == null) return;
            for (int i = choiceArea.childCount - 1; i >= 0; i--) Discard(choiceArea.GetChild(i).gameObject);
        }

        void Update()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (controller == null || controller.Story == null) return;
            if (Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return))
            {
                if (typer != null) FinishTyping();
                else if (controller.IsWaitingForContinue) controller.Continue();
            }
            else if (typer != null && Input.GetMouseButtonDown(0)) FinishTyping();
            else if (typer == null)
                for (int i = 0; i < 9 && i < buttons.Count; i++)
                    if (Input.GetKeyDown(KeyCode.Alpha1 + i)) { buttons[i].onClick.Invoke(); break; }
#endif
        }

        // ---- Building blocks -------------------------------------------------------------

        static RectTransform Child(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        Text AddText(Transform parent, string value, int size, Color color, FontStyle style, TextAnchor anchor)
        {
            var t = Child("Text", parent).gameObject.AddComponent<Text>();
            t.font = font;
            t.fontSize = size;
            t.color = color;
            t.fontStyle = style;
            t.alignment = anchor;
            t.supportRichText = false; // story text is shown as written, never read as markup
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            t.text = value;
            return t;
        }

        Button AddButton(string label, UnityEngine.Events.UnityAction onClick, TextAnchor anchor)
        {
            var rect = Child("Choice", choiceArea);
            var image = rect.gameObject.AddComponent<Image>();
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var tint = button.colors;
            tint.normalColor = WithAlpha(theme.accent, 0.14f);
            tint.highlightedColor = WithAlpha(theme.accent, 0.3f);
            tint.selectedColor = tint.highlightedColor;
            tint.pressedColor = WithAlpha(theme.accent, 0.45f);
            button.colors = tint;
            rect.gameObject.AddComponent<LayoutElement>().minHeight = theme.fontSize * 1.9f;
            var text = AddText(rect, label, Mathf.RoundToInt(theme.fontSize * 0.9f), theme.text, FontStyle.Normal, anchor);
            var tr = text.rectTransform;
            tr.anchorMin = Vector2.zero;
            tr.anchorMax = Vector2.one;
            tr.offsetMin = new Vector2(18, 6);
            tr.offsetMax = new Vector2(-18, -6);
            button.onClick.AddListener(onClick);
            buttons.Add(button);
            return button;
        }

        void ToolButton(Transform parent, string label, UnityEngine.Events.UnityAction onClick)
        {
            var rect = Child(label, parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = WithAlpha(theme.muted, 0.18f);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(onClick);
            var size = rect.gameObject.AddComponent<LayoutElement>();
            size.minWidth = theme.fontSize * 3.2f;
            size.minHeight = theme.fontSize * 1.3f;
            var text = AddText(rect, label, Mathf.RoundToInt(theme.fontSize * 0.6f), theme.text, FontStyle.Normal, TextAnchor.MiddleCenter);
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
            if (!Application.isPlaying || EventSystem.current != null) return;
            var es = new GameObject("EventSystem", typeof(EventSystem));
#if ENABLE_LEGACY_INPUT_MANAGER
            es.AddComponent<StandaloneInputModule>();
#else
            Debug.LogWarning("[NarrativeBridge] This project uses only the new Input System: add an Input System UI Input Module to the EventSystem so the story's buttons can be clicked.");
#endif
        }

        static void Discard(UnityEngine.Object o)
        {
            if (Application.isPlaying) UnityEngine.Object.Destroy(o);
            else UnityEngine.Object.DestroyImmediate(o);
        }
    }
}
`;
