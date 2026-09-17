/**
 * Three-valued logic for legal requirements.
 *
 * The third value is the point of this module. In law, "we do not have the
 * evidence" is categorically different from "the requirement is not met", and
 * collapsing the two is how a system ends up telling someone they are ineligible
 * when in fact nobody has asked them for a payslip yet.
 */

export type Trivalent = "satisfied" | "not_satisfied" | "insufficient_evidence";

/** Kleene conjunction: a single failure decides; otherwise ignorance dominates. */
export function and(values: readonly Trivalent[]): Trivalent {
  if (values.length === 0) return "satisfied";
  if (values.includes("not_satisfied")) return "not_satisfied";
  if (values.includes("insufficient_evidence")) return "insufficient_evidence";
  return "satisfied";
}

/** Kleene disjunction: a single success decides; otherwise ignorance dominates. */
export function or(values: readonly Trivalent[]): Trivalent {
  if (values.length === 0) return "not_satisfied";
  if (values.includes("satisfied")) return "satisfied";
  if (values.includes("insufficient_evidence")) return "insufficient_evidence";
  return "not_satisfied";
}

/** Negation leaves ignorance untouched — not knowing X is not knowing not-X. */
export function not(value: Trivalent): Trivalent {
  if (value === "satisfied") return "not_satisfied";
  if (value === "not_satisfied") return "satisfied";
  return "insufficient_evidence";
}

export function fromBoolean(value: boolean): Trivalent {
  return value ? "satisfied" : "not_satisfied";
}
