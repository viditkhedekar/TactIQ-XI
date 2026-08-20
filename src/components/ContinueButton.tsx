"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/primitives";

/**
 * Drives the game loop. "Play match" opens the live ticker; "Quick sim"
 * resolves the whole round on the server and lands back on the results.
 */
export function ContinueButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "play" | "quick">(null);
  const [error, setError] = useState<string | null>(null);

  async function quickSim() {
    setBusy("quick");
    setError(null);
    try {
      const response = await fetch("/api/match/quick-sim", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not simulate that round");
      router.push(
        body.reportFixtureId
          ? `/career/report?fixture=${body.reportFixtureId}`
          : "/career/report",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-[var(--bad)]">{error}</span>}
      <Button variant="ghost" size="sm" onClick={quickSim} disabled={busy !== null}>
        {busy === "quick" ? "Simulating..." : "Quick sim"}
      </Button>
      <Button
        variant="primary"
        onClick={() => {
          setBusy("play");
          router.push("/career/match");
        }}
        disabled={busy !== null}
      >
        {busy === "play" ? "Loading..." : "Play match"}
      </Button>
    </div>
  );
}
