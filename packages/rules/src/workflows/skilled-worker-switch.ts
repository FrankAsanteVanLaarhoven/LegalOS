import type { Trivalent } from "../trivalent.ts";
import { fromBoolean } from "../trivalent.ts";
import type { LegalWorkflow, ResolvedFacts } from "../types.ts";

/**
 * Graduate → Skilled Worker in-country switch, expressed as executable law.
 *
 * This is the "legal engineering" shape: instead of asking a model "can I
 * switch?", the platform evaluates named requirements against evidenced facts
 * and reports which are met, which are not, and what is still missing.
 *
 * Two deliberate constraints:
 *
 *  1. No policy number is hardcoded. Salary thresholds and eligible occupation
 *     codes change with the Immigration Rules; a constant baked into this file
 *     would be a fabricated legal figure the moment it drifts. Those values must
 *     arrive as evidenced facts sourced from a verified publication, and their
 *     absence yields `insufficient_evidence` rather than a guess.
 *
 *  2. `locator` is null on every requirement. Nothing here has been checked
 *     against the published rule text, so the engine marks results unreleasable.
 *     Filling these in is a sourcing task, not a coding task.
 */

const SOURCE_SKILLED_WORKER = "uk.immigration-rules.appendix-skilled-worker";
const SOURCE_GRADUATE = "uk.immigration-rules.appendix-graduate";

/** Compares two ISO dates without pulling in a date library. */
function isOnOrBefore(a: string, b: string): boolean {
  return Date.parse(a) <= Date.parse(b);
}

export const SKILLED_WORKER_SWITCH: LegalWorkflow = {
  id: "uk.switch.graduate-to-skilled-worker",
  title: "Switch from Graduate to Skilled Worker",
  description:
    "Evaluates whether an in-country switch from Graduate permission to Skilled Worker permission is supported by the evidence on file.",
  combine: "all",
  requirements: [
    {
      id: "SW-CURRENT-PERMISSION",
      sourceId: SOURCE_GRADUATE,
      locator: null,
      description: "Applicant currently holds Graduate permission.",
      requires: ["currentPermission"],
      evidenceRequired: ["eVisa share code", "BRP or decision letter"],
      evaluate: (facts: ResolvedFacts): Trivalent =>
        fromBoolean(facts.string("currentPermission") === "graduate"),
    },
    {
      id: "SW-PERMISSION-UNEXPIRED",
      sourceId: SOURCE_SKILLED_WORKER,
      locator: null,
      description: "Existing permission has not expired on the date of application.",
      requires: ["permissionExpiryDate", "applicationDate"],
      evidenceRequired: ["eVisa share code", "BRP or decision letter"],
      evaluate: (facts: ResolvedFacts): Trivalent => {
        const expiry = facts.string("permissionExpiryDate");
        const applied = facts.string("applicationDate");
        if (!expiry || !applied) return "insufficient_evidence";
        if (Number.isNaN(Date.parse(expiry)) || Number.isNaN(Date.parse(applied))) {
          return "insufficient_evidence";
        }
        return fromBoolean(isOnOrBefore(applied, expiry));
      },
    },
    {
      id: "SW-SPONSOR-LICENSED",
      sourceId: SOURCE_SKILLED_WORKER,
      locator: null,
      description: "Applicant holds a Certificate of Sponsorship from a licensed sponsor.",
      requires: ["sponsorLicensed", "certificateOfSponsorshipRef"],
      evidenceRequired: ["Certificate of Sponsorship", "Sponsor licence check"],
      evaluate: (facts: ResolvedFacts): Trivalent => {
        const licensed = facts.boolean("sponsorLicensed");
        const ref = facts.string("certificateOfSponsorshipRef");
        if (licensed === undefined) return "insufficient_evidence";
        if (!ref || ref.trim() === "") return "insufficient_evidence";
        return fromBoolean(licensed);
      },
    },
    {
      id: "SW-OCCUPATION-ELIGIBLE",
      sourceId: SOURCE_SKILLED_WORKER,
      locator: null,
      description: "The job's occupation code appears on the eligible occupations table in force.",
      // `eligibleOccupationCodes` must be supplied from a verified source.
      requires: ["occupationCode", "eligibleOccupationCodes"],
      evidenceRequired: [
        "Certificate of Sponsorship",
        "Eligible occupations table (verified source)",
      ],
      evaluate: (facts: ResolvedFacts): Trivalent => {
        const code = facts.string("occupationCode");
        const table = facts.string("eligibleOccupationCodes");
        if (!code || !table) return "insufficient_evidence";
        const codes = table
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (codes.length === 0) return "insufficient_evidence";
        return fromBoolean(codes.includes(code));
      },
    },
    {
      id: "SW-SALARY-THRESHOLD",
      sourceId: SOURCE_SKILLED_WORKER,
      locator: null,
      description: "Salary meets the applicable threshold for the occupation and route.",
      // `applicableSalaryThreshold` must be supplied from a verified source.
      requires: ["annualSalary", "applicableSalaryThreshold"],
      evidenceRequired: [
        "Certificate of Sponsorship",
        "Employment contract or payslips",
        "Salary threshold (verified source)",
      ],
      evaluate: (facts: ResolvedFacts): Trivalent => {
        const salary = facts.number("annualSalary");
        const threshold = facts.number("applicableSalaryThreshold");
        if (salary === undefined || threshold === undefined) {
          return "insufficient_evidence";
        }
        return fromBoolean(salary >= threshold);
      },
    },
    {
      id: "SW-ENGLISH-LANGUAGE",
      sourceId: SOURCE_SKILLED_WORKER,
      locator: null,
      description: "English language requirement is met.",
      requires: ["englishRequirementMet"],
      evidenceRequired: [
        "Approved English test certificate, degree certificate, or exemption evidence",
      ],
      evaluate: (facts: ResolvedFacts): Trivalent => {
        const met = facts.boolean("englishRequirementMet");
        if (met === undefined) return "insufficient_evidence";
        return fromBoolean(met);
      },
    },
  ],
};
