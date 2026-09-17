import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Soft UK identity backdrops — never overpower content.
 * Watermarked / stock-marked assets are intentionally excluded.
 */
export type BackdropId =
  "union-jack-wave" | "uk-map-union" | "british-isles-flags" | "union-jack-crown";

const ASSETS: Record<BackdropId, { src: string; alt: string; defaultOpacity: string }> = {
  "union-jack-wave": {
    src: "/images/backdrops/union-jack-wave.png",
    alt: "",
    defaultOpacity: "opacity-[0.18] dark:opacity-[0.26]",
  },
  "uk-map-union": {
    src: "/images/backdrops/uk-map-union.png",
    alt: "",
    defaultOpacity: "opacity-[0.2] dark:opacity-[0.28]",
  },
  "british-isles-flags": {
    src: "/images/backdrops/british-isles-flags.png",
    alt: "",
    defaultOpacity: "opacity-[0.22] dark:opacity-[0.3]",
  },
  "union-jack-crown": {
    src: "/images/backdrops/union-jack-crown.png",
    alt: "",
    defaultOpacity: "opacity-[0.2] dark:opacity-[0.28]",
  },
};

export function PageBackdrop({
  id,
  className,
  position = "center",
  size = "cover",
}: {
  id: BackdropId;
  className?: string;
  position?: "center" | "top" | "bottom" | "right";
  size?: "cover" | "contain";
}) {
  const asset = ASSETS[id];
  const pos =
    position === "top"
      ? "object-top"
      : position === "bottom"
        ? "object-bottom"
        : position === "right"
          ? "object-right"
          : "object-center";

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      <Image
        src={asset.src}
        alt={asset.alt}
        fill
        priority={false}
        className={cn(
          asset.defaultOpacity,
          size === "contain" ? "object-contain" : "object-cover",
          pos,
          "select-none"
        )}
        sizes="100vw"
      />
      {/* Lighter veil — backdrops more visible, type still readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg)]/55 via-[var(--bg)]/40 to-[var(--bg)]/85" />
    </div>
  );
}
