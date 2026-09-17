"use client";
// Accepted: a client component importing a client-safe projection type and
// submitting only a target organisation id.
import type { ClientSession } from "@/lib/auth/repository-context";
export function Switcher({ session }: { session: ClientSession }) {
  return session.switchable.map((o) => o.id).join(",");
}
