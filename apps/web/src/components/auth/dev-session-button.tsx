"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

/** Development-only. Requests a session cookie and returns to the target page. */
export function DevSessionButton() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/dev-session", { method: "POST" });
      if (!res.ok) throw new Error("unavailable");
      router.push(params.get("next") ?? "/workspace");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button onClick={start} disabled={busy} size="sm" variant="dark" className="mt-3">
      {busy ? "Starting…" : "Continue with a development session"}
    </Button>
  );
}
