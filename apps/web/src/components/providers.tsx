"use client";

import { AppProvider } from "@/lib/app-context";
import { DisclaimerBanner } from "@/components/landing/disclaimer-banner";
import { WorldUtilsPanel } from "@/components/shell/world-utils";
import { VoiceAgentPanel } from "@/components/shell/voice-agent";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      {/*
        The disclaimer used to render only on the marketing landing page, while
        /resources, /enterprise, /workspace and every agent page — the surfaces
        that actually hand out legal material — carried nothing. The voice widget
        below answers immigration questions from any route and reads the answer
        aloud, so the banner belongs at the root, above it.
      */}
      <DisclaimerBanner />
      {children}
      <WorldUtilsPanel />
      <VoiceAgentPanel />
    </AppProvider>
  );
}
