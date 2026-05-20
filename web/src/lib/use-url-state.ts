import { useCallback, useSyncExternalStore } from "react";

type Params = Record<string, string | undefined>;

function readSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("braid:urlchange", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("braid:urlchange", onChange);
  };
}

export function useUrlState(): {
  get: (key: string) => string | undefined;
  set: (patch: Params) => void;
} {
  const search = useSyncExternalStore(subscribe, readSearch, () => "");

  const get = useCallback(
    (key: string) => {
      const v = new URLSearchParams(search).get(key);
      return v === null ? undefined : v;
    },
    [search],
  );

  const set = useCallback((patch: Params) => {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      return;
    }
    window.history.replaceState(window.history.state, "", next);
    window.dispatchEvent(new Event("braid:urlchange"));
  }, []);

  return { get, set };
}
