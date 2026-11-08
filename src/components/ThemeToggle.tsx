import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const nextPreference: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const preferenceLabels: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const themePreferenceEvent = "localtext:theme-preference";

function systemTheme(): Exclude<ThemePreference, "system"> {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] =
    useState<Exclude<ThemePreference, "system">>("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolved = preference === "system" ? systemTheme() : preference;
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = preference;
    };

    const synchronisePreference = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next === "system" || next === "light" || next === "dark") {
        setPreference(next);
      }
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    window.addEventListener(themePreferenceEvent, synchronisePreference);

    return () => {
      media.removeEventListener("change", applyTheme);
      window.removeEventListener(themePreferenceEvent, synchronisePreference);
    };
  }, [preference]);

  const label = preferenceLabels[preference];
  const nextLabel = preferenceLabels[nextPreference[preference]];

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Theme: ${label}. Switch to ${nextLabel.toLowerCase()} theme.`}
      title={`Theme: ${label}`}
      onClick={() => {
        const next = nextPreference[preference];
        setPreference(next);
        window.dispatchEvent(
          new CustomEvent<ThemePreference>(themePreferenceEvent, {
            detail: next,
          }),
        );
      }}
    >
      <span
        className={`theme-toggle__icon theme-toggle__icon--${resolvedTheme}`}
        aria-hidden="true"
      />
      <span className="theme-toggle__label">{label}</span>
    </button>
  );
}
