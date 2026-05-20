export function initTheme() {
  const stored = localStorage.getItem("braid:theme");
  const resolved =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  document.documentElement.setAttribute("data-theme", resolved);
}

export type Theme = "light" | "dark";

export function getTheme(): Theme {
  return (document.documentElement.getAttribute("data-theme") as Theme) ?? "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("braid:theme", theme);
}
