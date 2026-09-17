import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-transparent text-[var(--muted)] border-[var(--line-strong)]",
  accent: "bg-transparent text-[var(--accent)] border-[var(--accent)]/20",
  success: "bg-transparent text-[var(--success)] border-[var(--success)]/25",
  warning: "bg-transparent text-[var(--warning)] border-[var(--warning)]/25",
  danger: "bg-transparent text-[var(--danger)] border-[var(--danger)]/25",
  info: "bg-transparent text-[var(--accent)] border-[var(--accent)]/20",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[0.04em]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
