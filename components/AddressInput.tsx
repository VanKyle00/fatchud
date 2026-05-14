"use client";

import { useState } from "react";
import type { GeocodeResult } from "@/lib/types";

type Props = {
  onLocate: (result: GeocodeResult) => void;
};

export function AddressInput({ onLocate }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(value)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed: ${res.status}`);
      }
      const data: GeocodeResult = await res.json();
      onLocate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to locate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 w-full max-w-md">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter delivery address"
          className="flex-1 rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 px-4 py-3 outline-none backdrop-blur-xl focus:border-black/30 dark:focus:border-white/30"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl bg-foreground px-5 py-3 font-medium text-background disabled:opacity-50"
        >
          {loading ? "…" : "Find"}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
