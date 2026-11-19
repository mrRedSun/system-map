import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'system-map:theme';
const QUERY = '(prefers-color-scheme: dark)';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage may be unavailable (private mode); fall back to the system theme.
  }
  return 'system';
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia(QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return;
    const mq = matchMedia(QUERY);
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Not persisted; still applied for this session.
    }
    setThemeState(next);
  }, []);

  const dark =
    theme === 'dark' ||
    (theme === 'system' && typeof matchMedia === 'function' && matchMedia(QUERY).matches);
  const toggle = useCallback(() => setTheme(dark ? 'light' : 'dark'), [dark, setTheme]);
  return { theme, setTheme, dark, toggle };
}
