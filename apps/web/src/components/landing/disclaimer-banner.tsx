"use client";

import { useApp } from "@/lib/app-context";

export function DisclaimerBanner() {
  const { t } = useApp();
  return (
    <div className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-[1400px] section-pad py-2.5 text-center text-[12px] leading-relaxed text-[var(--muted)]">
        {t("disclaimer")}
      </div>
    </div>
  );
}
