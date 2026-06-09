import { useState, useCallback } from 'react';

export function usePersistedState<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...defaultValue, ...JSON.parse(raw) } as T;
    } catch { /* ignore */ }
    return defaultValue;
  });

  const set = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key]);

  return [value, set];
}

export function usePersistedString(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? defaultValue;
    } catch { return defaultValue; }
  });

  const set = useCallback((v: string) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  }, [key]);

  return [value, set];
}
