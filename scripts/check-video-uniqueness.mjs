#!/usr/bin/env node
/**
 * Ensures each video src appears at most once in PLACEMENT, and reports any
 * placement whose footage has text burned into the frame.
 *
 * Path uniqueness alone was not enough: ten of the seventeen films carry
 * generation-prompt words rendered into the video ("asylum" over a bedroom,
 * "study" over a barbershop), and one of them was serving the Employment /
 * Right to Work section — a word that contradicts the section it illustrates.
 * Distinct paths, identical-looking clips, no signal.
 *
 * Set STRICT_MEDIA=1 to make a flagged placement fail the build. It reports
 * without failing by default, because clearing it needs replacement footage
 * rather than a code change.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const candidates = [
  path.join(root, "apps/web/src/lib/media/videos.ts"),
  path.join(root, "src/lib/media/videos.ts"),
];
const file = candidates.find((p) => fs.existsSync(p));
if (!file) {
  console.error("videos.ts not found");
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
const placementBlock = text.split("export const PLACEMENT")[1] ?? "";
const srcs = [...placementBlock.matchAll(/src:\s*"([^"]+)"/g)].map((m) => m[1]);

// Also read FILMS referenced only via PLACEMENT object — parse src from whole file
// and ensure public files exist for PLACEMENT films by reading film definitions used
const allSrcs = [...text.matchAll(/src:\s*"(\/videos\/[^"]+)"/g)].map((m) => m[1]);
const unique = new Set(allSrcs);

// Check PLACEMENT uniqueness by counting FILMS keys assigned in PLACEMENT
const placementKeys = [...placementBlock.matchAll(/FILMS\.(\w+)/g)].map((m) => m[1]);
const keyCounts = {};
for (const k of placementKeys) keyCounts[k] = (keyCounts[k] || 0) + 1;
const dups = Object.entries(keyCounts).filter(([, n]) => n > 1);
if (dups.length) {
  console.error("Duplicate film placements:", dups);
  process.exit(1);
}

// File existence
const missing = [];
for (const s of unique) {
  const p = path.join(root, "apps/web/public" + s);
  const p2 = path.join(root, "public" + s);
  if (!fs.existsSync(p) && !fs.existsSync(p2)) missing.push(s);
}
if (missing.length) {
  console.error("Missing video files:", missing);
  process.exit(1);
}

// Report placements whose footage has burned-in text.
const overlayByKey = {};
for (const m of text.matchAll(
  /(\w+): \{[^}]*?textOverlay: (null|"[^"]*")[^}]*?\}/gs
)) {
  overlayByKey[m[1]] = m[2] === "null" ? null : JSON.parse(m[2]);
}

const flagged = placementKeys
  .map((key) => ({ key, overlay: overlayByKey[key] }))
  .filter((entry) => entry.overlay);

if (flagged.length) {
  console.warn(
    `\n${flagged.length} of ${placementKeys.length} placements use footage with text burned into the frame:`
  );
  for (const { key, overlay } of flagged) {
    console.warn(`  - FILMS.${key} — reads "${overlay}"`);
  }
  console.warn(
    "  These need replacement footage; the text is in the video file, not the markup.\n"
  );
  if (process.env.STRICT_MEDIA === "1") {
    console.error("STRICT_MEDIA=1: failing on flagged placements.");
    process.exit(1);
  }
}

console.log(
  `OK: ${placementKeys.length} unique placements, ${unique.size} film files referenced` +
    (flagged.length ? ` (${flagged.length} with burned-in text)` : "")
);
