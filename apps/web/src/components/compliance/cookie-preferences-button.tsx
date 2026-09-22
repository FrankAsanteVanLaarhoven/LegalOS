"use client";

import { openCookiePreferences } from "./cookie-consent";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";

export function CookiePreferencesButton({
  className = "",
  variant = "secondary",
}: {
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft" | "dark";
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={() => openCookiePreferences()}
      className={className}
    >
      <Settings2 className="mr-2 h-4 w-4" />
      Manage Cookie Preferences
    </Button>
  );
}
