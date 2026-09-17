"use client";

import { cn } from "@/lib/utils";

type VideoMediaProps = {
  src: string;
  poster?: string;
  className?: string;
  videoClassName?: string;
  /** Dark gradient for text overlays */
  veil?: "none" | "soft" | "strong" | "left" | "bottom";
  label?: string;
  priority?: boolean;
};

const veils: Record<NonNullable<VideoMediaProps["veil"]>, string> = {
  none: "",
  soft: "bg-black/25",
  strong: "bg-black/55",
  left: "bg-gradient-to-r from-black/70 via-black/35 to-transparent",
  bottom: "bg-gradient-to-t from-black/70 via-black/25 to-transparent",
};

/**
 * Natural, muted ambient video — autoplay loop, no controls chrome.
 * Used for editorial story moments across the site.
 */
export function VideoMedia({
  src,
  poster,
  className,
  videoClassName,
  veil = "none",
  label,
}: VideoMediaProps) {
  return (
    <div className={cn("photo-frame relative overflow-hidden bg-[#1a1a1a]", className)}>
      <video
        className={cn("absolute inset-0 h-full w-full object-cover", videoClassName)}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={poster}
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
      </video>
      {veil !== "none" && (
        <div className={cn("pointer-events-none absolute inset-0", veils[veil])} />
      )}
    </div>
  );
}
