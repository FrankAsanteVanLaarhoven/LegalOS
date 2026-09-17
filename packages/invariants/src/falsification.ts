import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Falsification records.
 *
 * The lesson of the authentication milestone, written down as an artefact.
 * Five checks passed while asking nothing: one grepped for an identifier that
 * appeared in an unrelated function, one required a file to exist, one was
 * written `() => null`. Each was caught by a person doubting a good number.
 *
 * What none of them had was any demonstration that they could produce a
 * different answer. A check that has only ever been observed passing is
 * indistinguishable from a check that cannot fail, and the two are worth
 * exactly the same amount.
 *
 * A falsification record says: this observation was deliberately broken in a
 * named way, and it went false. It is written by hand after doing that, and it
 * names the mutation so the next person can repeat it. It is not proof the
 * observation is correct — only that it is capable of answering.
 */

export interface Falsification {
  readonly observationId: string;
  /** What was broken to make it fail, precisely enough to repeat. */
  readonly mutation: string;
  /** What the observation reported under the mutation. */
  readonly observedFalse: true;
  readonly at: string;
  readonly commit: string | null;
  /** Who or what performed it, so a reader can ask. */
  readonly performedBy: string;
}

export function falsificationDirectory(repoRoot: string): string {
  return join(repoRoot, "docs/falsification");
}

/**
 * Reads every falsification record.
 *
 * Unlike integration evidence these do not expire. A demonstration that a check
 * can fail stays true for that version of the check — and when the check is
 * rewritten, the record's commit shows it predates the rewrite, which is the
 * signal to do it again rather than an automatic invalidation.
 */
export async function readFalsifications(
  repoRoot: string
): Promise<ReadonlyMap<string, Falsification>> {
  const dir = falsificationDirectory(repoRoot);
  const found = new Map<string, Falsification>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as Falsification;
      if (parsed.observedFalse === true && typeof parsed.observationId === "string") {
        found.set(parsed.observationId, parsed);
      }
    } catch {
      // An unreadable record is not a falsification. Skipping it means the
      // invariant reports unfalsified, which is the safe direction.
    }
  }
  return found;
}
