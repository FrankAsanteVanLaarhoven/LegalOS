/**
 * @legalos/identity — identity by context.
 *
 * Two separate things, deliberately not one:
 *
 *  - Platform identity secures access. It needs a name to greet someone by and
 *    a way to reach them. It does not need their legal name, and requiring one
 *    would exclude the people this platform exists for: someone fleeing
 *    domestic abuse, or a trafficking survivor whose safety depends on their
 *    legal identity not being in a system they do not yet trust.
 *
 *  - Case identity is legal work. It arrives when a case is opened, and it is
 *    plural by nature. A person's passport, birth certificate, Home Office
 *    records and university records routinely disagree about spelling,
 *    transliteration and date of birth. Modelling one canonical "legal name"
 *    turns an ordinary feature of these files into a data error, and then into
 *    a discrepancy someone has to explain.
 *
 * So `CaseIdentity` holds a set of identity records, each traced to the
 * document it came from. Variation is the expected state, not a fault.
 */

/* ------------------------------------------------------------------ */
/* Platform identity — the minimum to secure an account                */
/* ------------------------------------------------------------------ */

export type ContactChannel = "email" | "phone";

export interface PlatformIdentity {
  readonly userId: string;
  /** What to call them. Never required to be a legal name. */
  readonly preferredName: string;
  /** Email or phone — one is enough to open an account. */
  readonly contact: { readonly channel: ContactChannel; readonly value: string };
  readonly contactVerified: boolean;
}

export type AuthFactor =
  "passkey" | "authenticator_app" | "email_code" | "sms_code" | "whatsapp_code" | "recovery_codes";

/** Ordered by strength. Passkeys first; SMS is a fallback, not a default. */
export const FACTOR_STRENGTH: readonly AuthFactor[] = [
  "passkey",
  "authenticator_app",
  "recovery_codes",
  "authenticator_app",
  "email_code",
  "whatsapp_code",
  "sms_code",
];

export interface FactorEnrolment {
  readonly factor: AuthFactor;
  readonly enrolledAt: string;
  /** Contact value this factor depends on, where it depends on one. */
  readonly boundTo: string | null;
}

export type RecoveryProblem =
  "SINGLE_FACTOR" | "RECOVERY_DEPENDS_ON_ONE_NUMBER" | "NO_OFFLINE_RECOVERY";

export interface RecoveryAssessment {
  readonly adequate: boolean;
  readonly problems: readonly RecoveryProblem[];
  readonly advice: readonly string[];
}

/**
 * Checks that a person can still get back in after losing a phone.
 *
 * This population changes numbers often and shares handsets. An account locked
 * behind a number that no longer works may contain the only copy of someone's
 * asylum evidence, so recovery is a safety property rather than a convenience.
 */
export function assessRecovery(factors: readonly FactorEnrolment[]): RecoveryAssessment {
  const problems: RecoveryProblem[] = [];
  const advice: string[] = [];

  if (factors.length < 2) {
    problems.push("SINGLE_FACTOR");
    advice.push("Add a second way to sign in, so losing one does not lock you out.");
  }

  const bindings = new Set(factors.map((f) => f.boundTo).filter((v): v is string => v !== null));
  const allPhoneBound =
    factors.length > 0 && factors.every((f) => f.boundTo !== null) && bindings.size === 1;
  if (allPhoneBound) {
    problems.push("RECOVERY_DEPENDS_ON_ONE_NUMBER");
    advice.push(
      "Every way of signing in currently depends on the same number. If you lose it, nobody can restore this account for you."
    );
  }

  const hasOffline = factors.some(
    (f) =>
      f.factor === "recovery_codes" || f.factor === "passkey" || f.factor === "authenticator_app"
  );
  if (!hasOffline) {
    problems.push("NO_OFFLINE_RECOVERY");
    advice.push("Save recovery codes, or add a passkey, so you can get back in without a message.");
  }

  return { adequate: problems.length === 0, problems, advice };
}

/* ------------------------------------------------------------------ */
/* Case identity — plural by design                                    */
/* ------------------------------------------------------------------ */

export type IdentityField =
  | "name"
  | "date_of_birth"
  | "nationality"
  | "passport_number"
  | "home_office_reference"
  | "nrm_reference";

export type IdentitySourceKind =
  | "passport"
  | "brp_or_evisa"
  | "birth_certificate"
  | "marriage_certificate"
  | "home_office_record"
  | "university_record"
  | "client_stated"
  | "other";

/**
 * One value, as it appears in one document.
 *
 * There is deliberately no confidence score and no "correct" flag. Which value
 * is right is a legal determination, and a system that marks one as canonical
 * has made it — usually in favour of whichever document was uploaded first.
 */
export interface IdentityRecord {
  readonly id: string;
  readonly field: IdentityField;
  /** Exactly as written in the source, including transliteration. */
  readonly value: string;
  readonly source: IdentitySourceKind;
  /** Evidence artefact this was read from, where there is one. */
  readonly evidenceId: string | null;
  /** Period this value was used or valid, where known. */
  readonly validFrom: string | null;
  readonly validTo: string | null;
  /** The person's own account of why this value differs, in their words. */
  readonly explanation: string | null;
}

export interface CaseIdentity {
  readonly caseId: string;
  readonly records: readonly IdentityRecord[];
}

/** Distinct values recorded for a field, in the order first seen. */
export function variantsOf(identity: CaseIdentity, field: IdentityField): readonly string[] {
  const seen: string[] = [];
  for (const record of identity.records) {
    if (record.field === field) if (!seen.includes(record.value)) seen.push(record.value);
  }
  return seen;
}

export interface VariantGroup {
  readonly field: IdentityField;
  readonly values: readonly string[];
  /** Records carrying each value, so a reviewer can see the sources. */
  readonly records: readonly IdentityRecord[];
  /** True when at least one record explains the variation. */
  readonly explained: boolean;
}

/**
 * Fields recorded with more than one value.
 *
 * Returned as groups to review, never as errors to resolve. The wording matters
 * downstream: `@legalos/evidence-review` will put these to a person, and it
 * refuses to do so without offering the ordinary reasons documents differ.
 */
export function variantGroups(identity: CaseIdentity): readonly VariantGroup[] {
  const fields = [...new Set(identity.records.map((r) => r.field))];
  const groups: VariantGroup[] = [];

  for (const field of fields) {
    const records = identity.records.filter((r) => r.field === field);
    const values = variantsOf(identity, field);
    if (values.length < 2) continue;
    groups.push({
      field,
      values,
      records,
      explained: records.some((r) => (r.explanation ?? "").trim() !== ""),
    });
  }

  return groups;
}

/**
 * Adds a record.
 *
 * Never deduplicates and never overwrites: two documents saying different
 * things is the information, and collapsing them loses the fact that they
 * disagree — which is precisely what a caseworker needs to see.
 */
export function addRecord(identity: CaseIdentity, record: IdentityRecord): CaseIdentity {
  if (identity.records.some((r) => r.id === record.id)) {
    throw new Error(`duplicate identity record id: ${record.id}`);
  }
  return { caseId: identity.caseId, records: [...identity.records, record] };
}

/* ------------------------------------------------------------------ */
/* Progressive assurance                                               */
/* ------------------------------------------------------------------ */

export type AssuranceLevel =
  | "visitor" // no account
  | "account" // contact recorded, unverified
  | "verified_account" // contact verified
  | "multi_factor" // a second factor enrolled
  | "case_identity_provided" // identity documents on file
  | "organisation_verified"; // domain-verified organisation

export const ASSURANCE_ORDER: readonly AssuranceLevel[] = [
  "visitor",
  "account",
  "verified_account",
  "multi_factor",
  "case_identity_provided",
  "organisation_verified",
];

export function assuranceRank(level: AssuranceLevel): number {
  return ASSURANCE_ORDER.indexOf(level);
}

/**
 * The assurance an action needs.
 *
 * Nothing here demands identity documents to use the platform. Reading legal
 * information needs no account at all; identity is required only where the
 * action itself concerns identity or affects other people.
 */
export const REQUIRED_ASSURANCE: Readonly<Record<string, AssuranceLevel>> = {
  read_public_legal_information: "visitor",
  ask_general_question: "visitor",
  save_work: "account",
  upload_evidence: "verified_account",
  open_case: "verified_account",
  invite_team_member: "multi_factor",
  export_all_case_data: "multi_factor",
  transfer_case_to_professional: "case_identity_provided",
  change_organisation_billing: "organisation_verified",
};

export function isPermitted(action: string, held: AssuranceLevel): boolean {
  const required = REQUIRED_ASSURANCE[action];
  // Fail closed: an unknown action is not permitted at any level.
  if (required === undefined) return false;
  return assuranceRank(held) >= assuranceRank(required);
}
