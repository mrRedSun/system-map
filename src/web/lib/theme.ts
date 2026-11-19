/**
 * Theme as atoms. The choice is stored raw under `system-map:theme` (read before first paint by
 * public/theme-init.js); "system" follows the OS setting live.
 */
import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react';
import { useCallback } from 'react';
import { Atom } from 'effect/reactivity';

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

export const themeAtom = Atom.writable<Theme, Theme>(
  () => readTheme(),
  (ctx, next) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Not persisted; still applied for this session.
    }
    ctx.setSelf(next);
  },
).pipe(Atom.keepAlive);

/** The OS preference, updated when it changes. */
const systemDarkAtom = Atom.make((get) => {
  if (typeof matchMedia !== 'function') return false;
  const mq = matchMedia(QUERY);
  const onChange = () => get.setSelf(mq.matches);
  mq.addEventListener('change', onChange);
  get.addFinalizer(() => mq.removeEventListener('change', onChange));
  return mq.matches;
});

export const darkAtom = Atom.make((get) => {
  const theme = get(themeAtom);
  return theme === 'dark' || (theme === 'system' && get(systemDarkAtom));
});

/** Keeps the `dark` class on <html> in sync while mounted. */
const applyThemeAtom = Atom.make((get) => {
  document.documentElement.classList.toggle('dark', get(darkAtom));
});

export function useTheme() {
  useAtomMount(applyThemeAtom);
  const theme = useAtomValue(themeAtom);
  const setTheme = useAtomSet(themeAtom);
  const dark = useAtomValue(darkAtom);
  const toggle = useCallback(() => setTheme(dark ? 'light' : 'dark'), [dark, setTheme]);
  return { theme, setTheme, dark, toggle };
}
