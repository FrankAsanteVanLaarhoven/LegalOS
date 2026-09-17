import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "dark";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
  secondary:
    "bg-transparent text-[var(--ink)] border border-[var(--ink)]/15 hover:border-[var(--ink)]/40 hover:bg-black/[0.02]",
  ghost: "bg-transparent text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-black/[0.03]",
  danger: "bg-red-50 text-red-800 border border-red-200 hover:bg-red-100",
  soft: "bg-[var(--warm)] text-[var(--accent)] hover:bg-[#e8e1d6]",
  dark: "bg-[var(--ink)] text-white hover:bg-black",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-xs rounded-full gap-1.5",
  md: "h-11 px-5 text-sm rounded-full gap-2",
  lg: "h-12 px-6 text-sm rounded-full gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
