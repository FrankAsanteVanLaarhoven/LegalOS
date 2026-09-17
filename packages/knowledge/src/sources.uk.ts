import type { LegalSource } from "./types.ts";

/**
 * Seed catalogue of UK sources the platform reasons about.
 *
 * Every entry ships as `unverified` with `retrievedAt: null` and `checksum: null`.
 * That is deliberate and load-bearing: nothing in this file has been retrieved
 * from the publisher and hashed inside this repository, so under the registry's
 * default strict mode none of it can back a user-facing legal conclusion.
 *
 * Promoting an entry to `verified` requires, in the same change:
 *   1. retrieving the text from `url`,
 *   2. recording the publisher's `version` and the ISO `retrievedAt` date,
 *   3. storing the sha-256 of the retrieved text in `checksum`.
 *
 * Do not hand-edit `verificationStatus` without doing 1–3.
 */
export const UK_SOURCES: readonly LegalSource[] = [
  {
    id: "uk.legislation.immigration-act-1971",
    kind: "primary_legislation",
    title: "Immigration Act 1971",
    citation: "Immigration Act 1971 (c. 77)",
    publisher: "legislation.gov.uk",
    url: "https://www.legislation.gov.uk/ukpga/1971/77",
    version: null,
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
  {
    id: "uk.legislation.modern-slavery-act-2015",
    kind: "primary_legislation",
    title: "Modern Slavery Act 2015",
    citation: "Modern Slavery Act 2015 (c. 30)",
    publisher: "legislation.gov.uk",
    url: "https://www.legislation.gov.uk/ukpga/2015/30",
    version: null,
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
  {
    id: "uk.legislation.ftt-iac-procedure-rules-2014",
    kind: "tribunal_procedure_rule",
    title: "Tribunal Procedure (First-tier Tribunal) (Immigration and Asylum Chamber) Rules 2014",
    citation: "S.I. 2014/2604",
    publisher: "legislation.gov.uk",
    url: "https://www.legislation.gov.uk/uksi/2014/2604",
    version: null,
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
  {
    id: "uk.immigration-rules.appendix-skilled-worker",
    kind: "immigration_rule",
    title: "Immigration Rules Appendix Skilled Worker",
    citation: "Immigration Rules, Appendix Skilled Worker",
    publisher: "GOV.UK (Home Office)",
    url: "https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-worker",
    version: null,
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
  {
    id: "uk.immigration-rules.appendix-graduate",
    kind: "immigration_rule",
    title: "Immigration Rules Appendix Graduate",
    citation: "Immigration Rules, Appendix Graduate",
    publisher: "GOV.UK (Home Office)",
    url: "https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-graduate",
    version: null,
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
  {
    id: "uk.regulatory.oisc-code-of-standards",
    kind: "home_office_guidance",
    title: "OISC / IAA Code of Standards and Commissioner's Rules",
    citation: "The Code of Standards and The Commissioner's Rules (Immigration and Asylum Act 1999, Sch. 5)",
    publisher: "Immigration Advice Authority / OISC (GOV.UK)",
    url: "https://www.gov.uk/government/publications/oisc-code-of-standards-commissioners-rules-2012",
    version: "2024-09-01",
    retrievedAt: null,
    checksum: null,
    verificationStatus: "unverified",
  },
] as const;
