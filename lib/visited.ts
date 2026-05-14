"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "fatchud:visited";

export type VisitedSpinMode = "all" | "exclude" | "only";

export function useVisited() {
  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const ids = parsed.filter((x): x is string => typeof x === "string");
      setVisited(new Set(ids));
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const toggle = useCallback((id: string) => {
    setVisited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // storage may be full or blocked; state still updates in-memory
      }
      return next;
    });
  }, []);

  return { visited, toggle };
}
