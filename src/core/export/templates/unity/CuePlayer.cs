using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.Events;

namespace __NAMESPACE__
{
    /// <summary>
    /// Plays the story's cues without code. A writer adds cues in Pen to Ink (#music:calm, #sound:door_creak,
    /// #shake:0.5, or any name of their own; StoryInfo.Cues lists them), and this does what each one is set to: play
    /// or stop music (fading between tracks), play a sound, loop an ambience, shake the camera, or only raise its
    /// event. A cue's value picks the clip with that name. Add it with Tools → Pen to Ink → __MENU_TITLE__ →
    /// Add Cue Player, which lists every cue in the story.
    /// </summary>
    [AddComponentMenu("Pen to Ink/__MENU_TITLE__/Narrative Cue Player")]
    public class NarrativeCuePlayer : MonoBehaviour
    {
        public enum CueAction { EventOnly, PlayMusic, StopMusic, PlaySound, PlayAmbience, StopAmbience, ShakeCamera }

        [Serializable] public class CueEvent : UnityEvent<string> { }
        [Serializable] public class AnyCueEvent : UnityEvent<string, string> { }

        [Serializable]
        public class Cue
        {
            [Tooltip("The cue's name as the writer gave it (one of StoryInfo.Cues), e.g. music, sound or shake.")]
            public string name;
            public CueAction action = CueAction.EventOnly;
            [Tooltip("Clips to choose from: the cue's value picks the one with that name (#music:calm plays \"calm\"), else the first.")]
            public List<AudioClip> clips = new List<AudioClip>();
            [Range(0f, 1f)] public float volume = 1f;
            [Tooltip("Raised with the cue's value, for anything else your game does.")]
            public CueEvent onCue = new CueEvent();
        }

        public NarrativeController controller;
        public List<Cue> cues = new List<Cue>();

        [Header("Sound")]
        [Tooltip("Optional AudioSources, e.g. routed through your game's mixer. Made when empty.")]
        public AudioSource musicSource;
        public AudioSource soundSource;
        public AudioSource ambienceSource;
        [Tooltip("Seconds to fade out one music track and in the next.")]
        [Min(0f)] public float musicFade = 1f;

        [Header("Camera shake")]
        [Tooltip("What shakes. Empty: the main camera.")]
        public Transform shakeTarget;
        [Min(0f)] public float shakeSeconds = 0.4f;
        [Tooltip("How far it moves at strength 1 (a shake cue's value, 0 to 1; 0.5 when it has none).")]
        [Min(0f)] public float shakeDistance = 0.3f;

        [Tooltip("Play the sounds the writer attached to cues in Pen to Ink (StoryInfo.CueSoundTags) when a cue has no clip of its own named by its value.")]
        public bool playStorySounds = true;

        [Tooltip("Every cue, listed or not: its name and value.")]
        public AnyCueEvent onAnyCue = new AnyCueEvent();

        /// <summary>Every cue the story reaches, listed or not: its name and value.</summary>
        public event Action<string, string> CuePlayed;

        /// <summary>The music track playing now, or null.</summary>
        public AudioClip CurrentMusic => musicSource != null && musicSource.isPlaying ? musicSource.clip : pendingMusic;

        AudioClip pendingMusic;
        Coroutine musicFader, shaker;
        Vector3 shakeHome;
        Transform shaking;

        void Awake()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
        }

        void OnEnable()
        {
            if (controller == null) controller = GetComponent<NarrativeController>();
            if (controller != null) controller.TagFound += OnTag;
        }

        void OnDisable()
        {
            if (controller != null) controller.TagFound -= OnTag;
            StopShake();
        }

        void OnTag(string tag)
        {
            var colon = tag.IndexOf(':');
            Play(colon < 0 ? tag.Trim() : tag.Substring(0, colon).Trim(), colon < 0 ? "" : tag.Substring(colon + 1).Trim());
        }

        /// <summary>Plays a cue by name and value, as if the story had reached it.</summary>
        public void Play(string name, string value)
        {
            value = value ?? "";
            CuePlayed?.Invoke(name, value);
            onAnyCue.Invoke(name, value);
            foreach (var cue in cues)
            {
                if (cue == null || !string.Equals(cue.name, name, StringComparison.OrdinalIgnoreCase)) continue;
                Run(cue, value, string.IsNullOrEmpty(value) ? name : name + ":" + value);
                cue.onCue.Invoke(value);
            }
        }

        void Run(Cue cue, string value, string tag)
        {
            switch (cue.action)
            {
                case CueAction.PlayMusic:
                    // A music cue with no value stops the music.
                    if (string.IsNullOrEmpty(value)) StopMusic();
                    else WithClip(cue, value, tag, clip => PlayMusic(clip, cue.volume));
                    break;
                case CueAction.StopMusic:
                    StopMusic();
                    break;
                case CueAction.PlaySound:
                    WithClip(cue, value, tag, sound => { if (sound != null) Source(ref soundSource, "Cue Sounds", false).PlayOneShot(sound, cue.volume); });
                    break;
                case CueAction.PlayAmbience:
                    // An ambience cue with no value stops the ambience.
                    if (string.IsNullOrEmpty(value)) { if (ambienceSource != null) ambienceSource.Stop(); break; }
                    WithClip(cue, value, tag, loop =>
                    {
                        if (loop == null) return;
                        var ambience = Source(ref ambienceSource, "Cue Ambience", true);
                        if (ambience.clip == loop && ambience.isPlaying) return;
                        ambience.clip = loop;
                        ambience.volume = cue.volume;
                        if (Application.isPlaying) ambience.Play();
                    });
                    break;
                case CueAction.StopAmbience:
                    if (ambienceSource != null) ambienceSource.Stop();
                    break;
                case CueAction.ShakeCamera:
                    Shake(float.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var strength) ? Mathf.Clamp01(strength) : 0.5f);
                    break;
            }
        }

        /// <summary>
        /// The clip for a cue, then use(clip): the cue's own clip named by the value; else the sound the writer attached to
        /// this cue in Pen to Ink (loaded without waiting); else the cue's first clip; null when there's none.
        /// </summary>
        void WithClip(Cue cue, string value, string tag, Action<AudioClip> use)
        {
            if (!string.IsNullOrEmpty(value))
                foreach (var c in cue.clips) if (c != null && string.Equals(c.name, value, StringComparison.OrdinalIgnoreCase)) { use(c); return; }
            var file = playStorySounds ? StorySound(tag) : null;
            if (file != null)
            {
                NarrativeController.LoadVoiceClipAsync(file, clip => use(clip != null ? clip : FirstClip(cue)));
                return;
            }
            if (!string.IsNullOrEmpty(value) && cue.clips.Count > 0) Debug.LogWarning("[NarrativeBridge] No clip called " + value + " for the " + cue.name + " cue; playing its first clip.");
            use(FirstClip(cue));
        }

        static AudioClip FirstClip(Cue cue)
        {
            foreach (var c in cue.clips) if (c != null) return c;
            return null;
        }

        /// <summary>The clip the writer attached to a cue tag (e.g. "music:calm"), or null.</summary>
        public static string StorySound(string tag)
        {
            var i = Array.IndexOf(StoryInfo.CueSoundTags, tag);
            return i >= 0 ? StoryInfo.CueSoundFiles[i] : null;
        }

        /// <summary>Whether the writer attached a sound to any cue with this name.</summary>
        public static bool HasStorySounds(string name)
        {
            foreach (var t in StoryInfo.CueSoundTags) if (t == name || t.StartsWith(name + ":", StringComparison.Ordinal)) return true;
            return false;
        }

        AudioSource Source(ref AudioSource source, string name, bool loop)
        {
            if (source == null)
            {
                var go = new GameObject(name);
                go.transform.SetParent(transform, false);
                source = go.AddComponent<AudioSource>();
                source.playOnAwake = false;
            }
            source.loop = loop;
            return source;
        }

        // ---- Music: one track at a time, faded -------------------------------------------------

        public void PlayMusic(AudioClip clip, float volume = 1f)
        {
            var music = Source(ref musicSource, "Cue Music", true);
            if (clip == null || (music.clip == clip && music.isPlaying)) return;
            pendingMusic = clip;
            if (musicFader != null) StopCoroutine(musicFader);
            if (!Application.isPlaying || musicFade <= 0f || !isActiveAndEnabled)
            {
                music.clip = clip;
                music.volume = volume;
                if (Application.isPlaying) music.Play();
                return;
            }
            musicFader = StartCoroutine(FadeMusic(clip, volume));
        }

        public void StopMusic()
        {
            pendingMusic = null;
            if (musicSource == null) return;
            if (musicFader != null) StopCoroutine(musicFader);
            if (!Application.isPlaying || musicFade <= 0f || !isActiveAndEnabled) { musicSource.Stop(); return; }
            musicFader = StartCoroutine(FadeMusic(null, 0f));
        }

        IEnumerator FadeMusic(AudioClip next, float volume)
        {
            var music = musicSource;
            var half = musicFade * 0.5f;
            if (music.isPlaying)
            {
                var from = music.volume;
                for (float t = 0f; t < half; t += Time.unscaledDeltaTime) { music.volume = Mathf.Lerp(from, 0f, t / half); yield return null; }
                music.Stop();
            }
            if (next != null)
            {
                music.clip = next;
                music.volume = 0f;
                music.Play();
                for (float t = 0f; t < half; t += Time.unscaledDeltaTime) { music.volume = Mathf.Lerp(0f, volume, t / half); yield return null; }
                music.volume = volume;
            }
            musicFader = null;
        }

        // ---- Camera shake -------------------------------------------------------------------

        public void Shake(float strength)
        {
            var target = shakeTarget != null ? shakeTarget : (Camera.main != null ? Camera.main.transform : null);
            if (target == null || !Application.isPlaying || !isActiveAndEnabled) return;
            StopShake();
            shaking = target;
            shakeHome = target.localPosition;
            shaker = StartCoroutine(ShakeFor(strength));
        }

        IEnumerator ShakeFor(float strength)
        {
            for (float t = 0f; t < shakeSeconds && shaking != null; t += Time.unscaledDeltaTime)
            {
                shaking.localPosition = shakeHome + UnityEngine.Random.insideUnitSphere * shakeDistance * strength * (1f - t / shakeSeconds);
                yield return null;
            }
            StopShake();
        }

        void StopShake()
        {
            if (shaker != null) StopCoroutine(shaker);
            shaker = null;
            if (shaking != null) shaking.localPosition = shakeHome;
            shaking = null;
        }

        /// <summary>A sensible action for a cue's name (music, sound, ambience, shake…), as Add Cue Player sets them.</summary>
        public static CueAction Guess(string name)
        {
            var n = (name ?? "").ToLowerInvariant();
            if (n.Contains("stop_music") || n == "silence") return CueAction.StopMusic;
            if (n.Contains("stop_ambience")) return CueAction.StopAmbience;
            if (n.Contains("music") || n == "song" || n == "track") return CueAction.PlayMusic;
            if (n.Contains("ambien") || n == "weather") return CueAction.PlayAmbience;
            if (n.Contains("sound") || n == "sfx") return CueAction.PlaySound;
            if (n.Contains("shake") || n == "rumble") return CueAction.ShakeCamera;
            return CueAction.EventOnly;
        }
    }
}
