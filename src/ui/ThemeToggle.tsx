import { useEffect, useState } from 'react';

// Light ("day") and dark ("night edition") themes. "auto" follows the system setting.
// The choice is applied as html[data-theme] and remembered per browser; index.html applies it
// before first paint so the page never flashes the wrong theme.

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
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  useEffect(() => {
    applyTheme(choice);
    try {
      if (choice === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* storage unavailable: the theme still applies for this visit */
    }
  }, [choice]);
  const l = LABEL[choice];
  return (
    <button className="btn tiny ghost theme-toggle" onClick={() => setChoice(NEXT[choice])} title={l.title} aria-label={`Theme: ${l.text}`}>
      <span aria-hidden>{l.icon}</span> {l.text}
    </button>
  );
}
