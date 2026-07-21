"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./Button";

type Theme = "light" | "dark";

function preferredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("ai-calendar-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTheme(preferredTheme()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    window.localStorage.setItem("ai-calendar-theme", next);
  }

  const nextLabel = theme === "dark" ? "Use light theme" : "Use dark theme";
  return <IconButton label={nextLabel} icon={theme === "dark" ? "sun" : "moon"} variant="ghost" size="sm" onClick={toggle} />;
}
