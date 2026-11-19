import { useCallback, useState } from 'react';

/** Per-viewer UI preference in localStorage. Falls back to the default when storage fails. */
export function usePersisted<T>(
  key: string,
  initial: T,
  valid: (v: unknown) => v is T,
): [T, (v: T) => void] {
  const storageKey = `system-map:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) return parsed;
      }
    } catch {
      // Unavailable or corrupt storage: use the default.
    }
    return initial;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(storageKey, JSON.stringify(v));
      } catch {
        // Not persisted; still applied.
      }
    },
    [storageKey],
  );
  return [value, set];
}
