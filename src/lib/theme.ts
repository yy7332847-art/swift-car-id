// Simple theme controller. Persists to localStorage; falls back to system preference.
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "pv-theme";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
}

export function useTheme(): [Theme, (t: Theme) => void, () => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const t = getInitialTheme();
    setThemeState(t);
    applyTheme(t);
  }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try { window.localStorage.setItem(KEY, t); } catch { /* ignore */ }
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");
  return [theme, setTheme, toggle];
}

// Blocking script injected in <head> to set the class before first paint (avoids FOUC).
export const THEME_INIT_SCRIPT = `(function(){try{var k=localStorage.getItem('${KEY}');var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=k?k==='dark':m!==false;var e=document.documentElement;if(d)e.classList.add('dark');else e.classList.remove('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;
