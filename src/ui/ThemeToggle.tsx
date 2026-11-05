import { useEffect, useState } from 'react';
import { designSetting } from './design/design';

// Light ("day") and dark ("night edition") themes. "auto" follows the system setting.
// The choice is applied as html[data-theme] and remembered per browser; index.html applies it
// before first paint so the page never flashes the wrong theme. Someone who hasn't chosen gets the
// design's default (the admin design editor's Defaults), which isn't saved as their choice.

export type ThemeChoice = 'auto' | 'light' | 'dark';
export const THEME_KEY = 'narrative-bridge.theme';

const NEXT: Record<ThemeChoice, ThemeChoice> = { auto: 'light', light: 'dark', dark: 'auto' };
const LABEL: Record<ThemeChoice, { icon: string; text: string; title: string }> = {
  auto: { icon: '◐', text: 'auto', title: 'Theme follows your system. Click for light.' },
  light: { icon: '☀', text: 'light', title: 'Light pages. Click for dark.' },
  dark: { icon: '☾', text: 'dark', title: 'Night edition. Click to follow your system.' },
};

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* storage unavailable */
  }
  const d = designSetting<string>('theme');
  return d === 'light' || d === 'dark' ? d : 'auto';
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  useEffect(() => applyTheme(choice), [choice]);
  const choose = (next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable: the theme still applies for this visit */
    }
  };
  const l = LABEL[choice];
  return (
    <button className="btn tiny ghost theme-toggle" onClick={() => choose(NEXT[choice])} title={l.title} aria-label={`Theme: ${l.text}`}>
      <span aria-hidden>{l.icon}</span> {l.text}
    </button>
  );
}
