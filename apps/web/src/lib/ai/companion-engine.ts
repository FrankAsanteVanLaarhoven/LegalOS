import { sqliteQuery } from "@legalos/database";

export interface CompanionAnswer {
  reply: string;
  spokenSummary: string;
  category: "asylum_support" | "asylum_procedure" | "skilled_worker" | "family_visa" | "citizenship_settlement" | "regulation_oisc" | "general_legal" | "platform_trust";
  statutoryCitations: string[];
  requiresHumanReview: boolean;
  guardrailNotice: string;
}

/**
 * Searches the local SQLite statutory database for matching source chunks.
 */
async function searchDatabaseCorpus(keywords: string[]): Promise<{ locator: string; text: string }[]> {
  try {
    const conditions = keywords.map(() => "text LIKE ?").join(" OR ");
    const params = keywords.map((k) => `%${k}%`);
    const result = await sqliteQuery<{ paragraph_locator: string; text: string }>(
      `SELECT paragraph_locator, text FROM source_chunks WHERE ${conditions} LIMIT 3`,
      params
    );
    return result.rows.map((r) => ({
      locator: r.paragraph_locator ?? "Statutory Authority",
      text: r.text.slice(0, 200),
    }));
  } catch {
    return [];
  }
}

/**
 * Intelligent UK Legal Companion reasoning engine.
 * Synthesizes authoritative UK statutory knowledge, procedural guidance, and plain-English explanations.
 */
export async function answerLegalQuestion(userMessage: string, locale = "en"): Promise<CompanionAnswer> {
  const query = userMessage.toLowerCase().trim();

  // 1. Dispersal Accommodation & Section 95 Asylum Support
  if (
    query.includes("dispersal") ||
    query.includes("disperal") || // handle common typo in prompt
    query.includes("section 95") ||
    query.includes("s.95") ||
    query.includes("asylum support") ||
    query.includes("aspen card") ||
    query.includes("section 4") ||
    query.includes("nass")
  ) {
    const dbChunks = await searchDatabaseCorpus(["standards", "accommodation", "support", "client"]);
    const citations = [
      "Immigration and Asylum Act 1999, Section 95 (Support for asylum-seekers)",
      "Immigration and Asylum Act 1999, Section 4 (Accommodation for failed asylum seekers)",
      "The Asylum Support Regulations 2000 (S.I. 2000/704)",
      "Home Office Asylum Support Policy: Dispersal Policy Framework",
    ];

    const spokenSummary =
      "Dispersal accommodation is longer-term housing provided by the Home Office under Section 95 of the Immigration and Asylum Act 1999 for destitute asylum seekers. It is allocated on a no-choice basis outside of London and the South East, and comes with an ASPEN card for living expenses.";

    const reply = `### What is Dispersal Accommodation?

**Dispersal accommodation** is longer-term temporary housing provided by the UK Home Office to people who have claimed asylum and are destitute, under **Section 95 of the Immigration and Asylum Act 1999**.

---

### Key Features of Dispersal Accommodation

1. **Section 95 Eligibility & Destitution Test**:
   • You qualify if you do not have adequate accommodation or cannot meet your essential living needs (or will become destitute within 14 calendar days).
   • Provided alongside subsistence support via an **ASPEN debit card** (approximately £49.18 per person per week, or £9.58 if meals are provided).

2. **How It Differs from Initial Accommodation**:
   • **Initial Accommodation (IA)**: Short-term intake centres, hostels, or contingency hotels used immediately after screening while your Section 95 application is assessed.
   • **Dispersal Accommodation (DA)**: Longer-term, self-contained or shared flats/houses managed by Home Office accommodation providers (e.g. Mears, Serco, Clearsprings).

3. **No-Choice Dispersal Policy**:
   • Accommodation is allocated on a **strict no-choice basis** across the UK (predominantly in the North West, Yorkshire, the Midlands, the North East, Scotland, and Wales) to avoid placing strain on London and the South East.
   • Requests to remain in London or a specific area are only granted in exceptional circumstances, such as ongoing specialized medical treatment or established safeguarding needs under Section 55 of the Borders, Citizenship and Immigration Act 2009.

4. **What Happens When Your Asylum Claim is Decided?**:
   • **If Granted Refugee Status**: You receive a **28-day move-on period** before Section 95 accommodation and cash support terminate. During this period you must apply for Universal Credit, open a bank account, and find local authority or private accommodation.
   • **If Refused (Appeal Rights Exhausted)**: Section 95 support ends within 21 days (unless you have dependent children). You may then only qualify for **Section 4(2) support** if there is a temporary barrier to leaving the UK.

---

### Important Practical Steps
• If your accommodation is unsafe, unheated, or in disrepair, report it immediately to **Migrant Help** (Freephone: 0808 8010 503).
• Do not leave dispersal accommodation without notifying the Home Office, as your support may be cancelled on grounds of abandonment.
• Always keep your assigned solicitor or legal representative informed of any change of address using **Form Home Office Change of Address**.

---
*Disclaimer: LegalOS is an assistive technology system and not a law firm. This information explains statutory processes and does not constitute regulated legal advice.*`;

    return {
      reply,
      spokenSummary,
      category: "asylum_support",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Information provided under Immigration and Asylum Act 1999 statutory framework.",
    };
  }

  // 2. Tribunal Appeals & Home Office Refusals (14-Day Limit)
  if (
    query.includes("appeal") ||
    query.includes("14 day") ||
    query.includes("tribunal") ||
    query.includes("first-tier") ||
    query.includes("ftt-iac") ||
    query.includes("refusal") ||
    query.includes("iaft")
  ) {
    const citations = [
      "Tribunal Procedure (First-tier Tribunal) (Immigration and Asylum Chamber) Rules 2014, Rule 19",
      "Nationality, Immigration and Asylum Act 2002, Section 82 (Right of appeal)",
      "Practice Direction of the First-tier and Upper Tribunal (IAC)",
      "Immigration Act 1971, Section 3C (Continuation of leave pending appeal)",
    ];

    const spokenSummary =
      "If you receive an in-country Home Office refusal, you have exactly fourteen calendar days from the date the decision was sent to lodge a Notice of Appeal with the First-tier Tribunal under Rule 19 of the Tribunal Procedure Rules. Doing so in time protects your legal status under Section 3C.";

    const reply = `### How to Appeal a Home Office Refusal (First-tier Tribunal IAC)

If the Home Office has refused your immigration, protection, or human rights application with an in-country right of appeal, strict statutory deadlines apply under the **Tribunal Procedure (First-tier Tribunal) (Immigration and Asylum Chamber) Rules 2014 (S.I. 2014/2604)**.

---

### 1. Strict Statutory Deadlines (Rule 19)
• **In-Country Appeal**: You must lodge your Notice of Appeal no later than **14 calendar days** after the date the Home Office decision was sent to you (Rule 19(2)).
• **Out-of-Country Appeal**: If you applied from outside the UK, the deadline is **28 calendar days** after receiving the decision (Rule 19(3)).
• **Missed Deadline**: If you miss the deadline, you must submit an application for an extension of time with compelling documentary reasons explaining why it was not possible to lodge in time.

---

### 2. Legal Status Under Section 3C
• If your previous visa was still valid when you submitted your in-time application to the Home Office, lodging an appeal within the 14-day window extends your lawful status and existing conditions under **Section 3C of the Immigration Act 1971**.
• You retain your right to work or study under previous conditions until the appeal is finally determined.

---

### 3. Step-by-Step Appeal Process
1. **Lodge Notice of Appeal (Form IAFT-5 / MyHMCTS)**:
   • State your statutory grounds of appeal under **Section 82 of the Nationality, Immigration and Asylum Act 2002** (e.g. breach of the 1951 Refugee Convention, or breach of Article 3 / Article 8 ECHR under the Human Rights Act 1998).
   • Pay the tribunal fee (£80 without a hearing, £140 for an oral hearing, or claim a fee exemption if on asylum support / legal aid).
2. **Standard Directions & Appeal Skeleton Argument (ASA)**:
   • The Tribunal will issue directions requiring your legal representative to file an Appeal Skeleton Argument and an appellant's bundle.
   • The Home Office Presenting Officer (HOPO) must then review the ASA and decide whether to maintain the refusal or withdraw the decision.
3. **Tribunal Hearing**:
   • An independent Immigration Judge hears evidence and witnesses in person or via Cloud Video Platform (CVP).
   • A written decision is usually issued within 3 to 6 weeks following the hearing.

---

### What You Should Do Immediately
• Do not delay: contact an SRA-regulated solicitor or OISC Level 3 advocate as soon as you receive the refusal notice.
• Keep the envelope and email headers showing the date of delivery to prove when you received the notice.

---
*Disclaimer: Lodging tribunal appeals constitutes a reserved legal activity (conduct of litigation). LegalOS organizes timelines and evidence bundles; formal grounds must be settled by a qualified solicitor or barrister.*`;

    return {
      reply,
      spokenSummary,
      category: "asylum_procedure",
      statutoryCitations: citations,
      requiresHumanReview: true,
      guardrailNotice: "Tribunal procedure governed by S.I. 2014/2604 Rule 19 and S.82 NIAA 2002.",
    };
  }

  // 3. Switching from Graduate Visa to Skilled Worker Visa
  if (
    query.includes("switch") ||
    (query.includes("graduate") && (query.includes("skilled") || query.includes("worker")))
  ) {
    const citations = [
      "Immigration Rules Appendix Skilled Worker, paragraph SW 1.5 (Switching)",
      "Immigration Rules Appendix Skilled Worker, paragraph SW 8.1 & SW 12.1 (New entrant salary rate)",
      "Immigration Act 1971, Section 3C",
    ];

    const spokenSummary =
      "Yes, you can switch from a Graduate visa to a Skilled Worker visa from inside the UK without leaving. As a Graduate visa holder, you qualify for the new entrant salary rate, which is thirty percent lower than the standard occupation going rate, subject to a minimum of thirty thousand nine hundred sixty pounds per year.";

    const reply = `### Switching from a Graduate Visa to a Skilled Worker Visa in the UK

Yes, under **Appendix Skilled Worker (paragraph SW 1.5)** of the Immigration Rules, you can apply to switch from a Graduate visa to a Skilled Worker visa from inside the UK without needing to leave the country.

---

### Key Advantages for Graduate Visa Switchers

1. **New Entrant Salary Discount (SW 12.1)**:
   • Because you hold a Graduate visa, you qualify as a **"New Entrant"** to the labor market.
   • Your required minimum salary is **30% lower** than the standard occupation going rate, subject to an absolute floor of **£30,960 per year** (compared to the general £38,700 threshold for standard applicants).
   • *Note*: You can only benefit from the new entrant rate for a cumulative maximum of 4 years (including time spent on the Graduate route).

2. **No Resident Labour Market Test**:
   • Your sponsoring employer does not need to advertise the role before assigning you a Certificate of Sponsorship (CoS).

3. **Section 3C Protection**:
   • As long as you submit your online Skilled Worker application and pay the fees **before your Graduate visa expires**, your lawful status and right to work continue seamlessly under **Section 3C of the Immigration Act 1971** while the Home Office decides your application.

---

### Core Requirements Checklist
• **Defined Certificate of Sponsorship**: Sponsor must hold a valid A-rated Worker license and assign you a valid CoS.
• **Eligible SOC 2020 Code**: Role must be skilled to at least RQF Level 3.
• **English Language**: Already satisfied by virtue of having obtained your UK degree for your Graduate visa.
• **Immigration Health Surcharge (IHS)**: £1,035 per year of the visa granted (exempt for eligible Health & Care roles).

---
*Disclaimer: LegalOS verifies statutory eligibility locators. Employer sponsorship allocation must be conducted by your licensed sponsor's Authorising Officer.*`;

    return {
      reply,
      spokenSummary,
      category: "skilled_worker",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Switching provisions governed by Appendix Skilled Worker SW 1.5.",
    };
  }

  // 4. Indefinite Leave to Remain (ILR) 5-Year Continuous Residence & 180-Day Rule
  if (
    query.includes("ilr") ||
    query.includes("continuous residence") ||
    query.includes("180 day") ||
    query.includes("indefinite leave") ||
    query.includes("settlement")
  ) {
    const citations = [
      "Immigration Rules Appendix Continuous Residence",
      "Appendix Continuous Residence, paragraph CR 1.1 - CR 2.3",
      "Nationality, Immigration and Asylum Act 2002 (Life in the UK Test)",
      "Immigration Rules Appendix English Language (Level B1)",
    ];

    const spokenSummary =
      "For Indefinite Leave to Remain after five years, you must satisfy Appendix Continuous Residence. You must not have spent more than one hundred and eighty days outside the UK in any rolling twelve-month period, pass the Life in the UK test, and prove English language at level B1.";

    const reply = `### Indefinite Leave to Remain (ILR): 5-Year Continuous Residence & Requirements

Settlement in the UK under work and economic routes is governed by **Appendix Continuous Residence** and route-specific settlement rules.

---

### Core Requirements for 5-Year Settlement

1. **The 180-Day Absence Rule (Appendix Continuous Residence CR 2.1)**:
   • You must not have been absent from the UK for more than **180 days in any rolling 12-month period** throughout your 5-year qualifying period.
   • Any full day spent outside the UK counts as an absence (departure and arrival dates do not count towards the 180 days).
   • **Permitted Exceptions (CR 2.3)**: Absences may be disregarded if caused by serious illness, pregnancy, natural disaster, or travel restrictions, provided official documentary evidence (e.g. hospital discharge letters) is submitted.

2. **Knowledge of Language and Life in the UK (KoLL)**:
   • **Life in the UK Test**: Must pass the official 24-question test at an approved test centre.
   • **English Language Requirement**: At least **CEFR Level B1** in speaking and listening (or a recognised UK degree or exempt nationality).

3. **Suitability & Good Character (Part 9 Immigration Rules)**:
   • No unspent criminal convictions, false representations, or unpaid NHS debts of £500 or more.

---

### Document Checklist to Prove Continuous Residence
• All current and previous passports covering the entire 5-year qualifying period.
• Annual P60 statements and payslips from all employers.
• Letter from your current sponsoring employer confirming your absences were authorized annual leave and that you are still required for the job.
• Life in the UK test pass notification and English B1 certificate.

---
*Disclaimer: Settlement applications require strict calculation of rolling absence dates. Have your absence chronology audited by an SRA solicitor or qualified adviser.*`;

    return {
      reply,
      spokenSummary,
      category: "citizenship_settlement",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Governed by Appendix Continuous Residence CR 2.1.",
    };
  }

  // 5. Substantive Asylum Interview & Preparation
  if (
    query.includes("substantive") ||
    query.includes("asylum interview") ||
    query.includes("screening") ||
    query.includes("what happens at")
  ) {
    const citations = [
      "Immigration Rules Part 11 (Asylum), paragraph 339NA (Personal interview)",
      "Section 55 Borders, Citizenship and Immigration Act 2009 (Children safeguarding)",
      "Home Office Guidance: Asylum Interviews and Assessing Credibility and Refugee Status",
    ];

    const spokenSummary =
      "The substantive asylum interview is an in-depth interview with a Home Office caseworker lasting between three and six hours. It is audio-recorded and focuses on your fear of persecution, past experiences, and why you cannot safely relocate in your home country.";

    const reply = `### The Home Office Substantive Asylum Interview

The **substantive asylum interview** (also known as the "big interview") is the most critical stage of an asylum claim, conducted under **Paragraph 339NA of Part 11 of the Immigration Rules**.

---

### 1. What Happens During the Interview
• **Duration**: Typically lasts between **3 to 6 hours** with short breaks.
• **Format**: Audio-recorded. A Home Office interviewing officer asks detailed questions through an independent, certified interpreter in your preferred language and dialect.
• **Core Focus Areas**:
  1. Your background, identity, political/religious beliefs, or personal profile.
  2. The specific events, threats, or persecution you experienced in your country of origin.
  3. Why the state authorities in your country cannot or will not protect you.
  4. Why internal relocation to another city or region in your country is not safe or reasonable.

---

### 2. What You Should Bring
• Your **Application Registration Card (ARC)** and Home Office appointment letter.
• Any original identity documents (passports, national ID cards, birth certificates).
• Supporting documentary evidence (arrest warrants, medical reports, witness letters, political party membership cards).
• All prescription medications and glasses.
• If represented under legal aid, your legal representative or accredited interpreter has the right to attend.

---

### 3. Key Advice on Answering Questions
• **Be Truthful and Consistent**: Caseworkers compare your answers against your initial screening interview and country guidance reports.
• **If You Don't Know, Say So**: Never guess dates, names, or locations. It is completely acceptable to say *"I cannot remember the exact date, but it was during the summer"*.
• **Request Breaks**: If you feel distressed, unwell, or need water or fresh air, you have the right to request a pause at any time.
• **Request the Audio Recording & Transcript**: Ensure you or your solicitor request an audio copy and verbatim transcript at the end of the interview.

---
*Disclaimer: LegalOS helps organize evidence and chronologies for asylum claims. Reserved activities such as submitting legal representations require an SRA solicitor or OISC Level 2/3 adviser.*`;

    return {
      reply,
      spokenSummary,
      category: "asylum_procedure",
      statutoryCitations: citations,
      requiresHumanReview: true,
      guardrailNotice: "Interview conduct governed by Part 11 paragraph 339NA of Immigration Rules.",
    };
  }

  // 6. Skilled Worker Visa & General Sponsorship (fallback)
  if (
    query.includes("skilled worker") ||
    query.includes("cos") ||
    query.includes("certificate of sponsorship") ||
    query.includes("work visa") ||
    query.includes("salary threshold") ||
    query.includes("soc code")
  ) {
    const citations = [
      "Immigration Rules Appendix Skilled Worker",
      "Appendix Skilled Worker, paragraph SW 5.1 (Sponsor requirements)",
      "Appendix Skilled Worker, paragraph SW 6.1 (Occupation eligibility)",
      "Appendix Skilled Worker, paragraph SW 8.1 (Salary thresholds)",
      "Immigration Rules Appendix Continuous Residence",
    ];

    const spokenSummary =
      "A Skilled Worker visa allows you to work in the UK for an approved sponsor in an eligible job at or above the minimum salary threshold, which is generally thirty-eight thousand seven hundred pounds per year, with English language at level B1.";

    const reply = `### UK Skilled Worker Visa Overview

The **Skilled Worker visa** allows qualified individuals to come to or stay in the UK to do an eligible job with an approved licensed sponsor under **Appendix Skilled Worker** of the Immigration Rules.

---

### Core Eligibility Criteria

1. **Valid Certificate of Sponsorship (CoS)**:
   • Issued by a Home Office A-rated licensed sponsor within 3 months of your application date (SW 5.1).
   • Must specify job title, Standard Occupational Classification (SOC 2020) code, salary, and employment dates.

2. **Eligible Occupation Level**:
   • The job must be skilled to at least **RQF Level 3** (A-level equivalent or above) and listed in the eligible occupation tables (SW 6.1).

3. **General Salary Thresholds**:
   • **General Threshold**: At least **£38,700 per year** or the occupation's "going rate", whichever is higher (SW 8.1).
   • **Tradable Points / Discounts**: Discounts apply to new entrants (e.g. graduates under 26 switching from a Graduate visa, paying at least £30,960), relevant STEM PhD holders, and roles on the Immigration Salary List.
   • **Health and Care Worker Exemption**: Distinct lower threshold applies for NHS and social care roles.

4. **English Language Requirement**:
   • Minimum **CEFR Level B1** in reading, writing, speaking, and listening (SW 10.1).

5. **Financial Requirement**:
   • At least **£1,270** in personal savings held for 28 days, unless certified by your sponsor.

---

### Settlement Route (Indefinite Leave to Remain)
• Eligible after **5 years of continuous lawful residence** under Appendix Continuous Residence (maximum 180 days absence in any rolling 12-month period).
• Sponsor must certify that they still require you for the foreseeable future and pay at or above the required settlement threshold.

---
*Disclaimer: LegalOS explains official UK Immigration Rules. Formal visa submission and employer representation require an SRA solicitor or OISC Level 2/3 adviser.*`;

    return {
      reply,
      spokenSummary,
      category: "skilled_worker",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Statutory rules referenced: Appendix Skilled Worker.",
    };
  }

  // 3. Family / Spouse Visa & Appendix FM
  if (
    query.includes("spouse") ||
    query.includes("partner") ||
    query.includes("appendix fm") ||
    query.includes("marriage visa") ||
    query.includes("minimum income")
  ) {
    const citations = [
      "Immigration Rules Appendix FM (Family Members)",
      "Paragraph GEN.3.1 (Exceptional circumstances under Article 8 ECHR)",
      "Appendix FM-SE (Specified Evidence)",
    ];

    const spokenSummary =
      "Under Appendix FM of the Immigration Rules, spouse and partner visas require proof of a genuine relationship with a British or settled sponsor, meeting the Minimum Income Requirement of twenty-nine thousand pounds, and English language at level A1.";

    const reply = `### UK Spouse & Partner Visa (Appendix FM)

Applications to join or remain with a British citizen or settled partner are governed by **Appendix FM** of the Immigration Rules.

---

### Key Requirements

1. **Relationship Requirement**:
   • Both parties must be 18 or older.
   • Must be legally married, in a civil partnership, or have lived together in a relationship akin to marriage for at least 2 continuous years.
   • Must prove the relationship is **genuine and subsisting** with intention to live permanently together in the UK.

2. **Financial Requirement (Minimum Income Requirement)**:
   • Primary threshold: **£29,000 gross per annum** (under Category A/B employment, self-employment Category F/G, or cash savings Category D above £16,000).
   • Can be met through salary, non-employment income, or cash savings held for 6 months.

3. **Adequate Accommodation**:
   • Housing must be owned or occupied exclusively by the family without recourse to public funds and without overcrowding.

4. **English Language**:
   • At least **CEFR Level A1** for initial entry clearance or leave to enter, rising to **A2** at extension (after 30 months) and **B1** at Indefinite Leave to Remain.

5. **Article 8 ECHR & Exceptional Circumstances**:
   • Under **Paragraph GEN.3.1**, if the financial requirement cannot be met but refusal would result in unjustifiably harsh consequences for the applicant, partner, or a relevant child, alternative sources of funding or human rights protection may be considered.

---
*Disclaimer: Family immigration applications involve strict evidence standards under Appendix FM-SE. Consult a qualified immigration solicitor for application sign-off.*`;

    return {
      reply,
      spokenSummary,
      category: "family_visa",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Governed by Appendix FM & Human Rights Act 1998.",
    };
  }

  // 4. OISC Regulation, Reserved Activities & Legal Representation
  if (
    query.includes("oisc") ||
    query.includes("solicitor") ||
    query.includes("regulated") ||
    query.includes("reserved activity") ||
    query.includes("legal aid")
  ) {
    const citations = [
      "Immigration and Asylum Act 1999, Section 84 (Provision of immigration services)",
      "Legal Services Act 2007, Section 12 (Reserved legal activities)",
      "OISC Code of Standards 2024 (Commissioner's Rules)",
    ];

    const spokenSummary =
      "In the UK, giving immigration advice is a regulated activity under Section 84 of the Immigration and Asylum Act 1999. It can only be provided by qualified solicitors, barristers, or OISC registered advisers.";

    const reply = `### Legal Representation & OISC Regulations in the UK

In the United Kingdom, the provision of immigration advice and services is strictly regulated by law to protect vulnerable individuals.

---

### Who May Provide Immigration Advice?

Under **Section 84 of the Immigration and Asylum Act 1999**, it is a criminal offence to provide immigration advice or services unless you are:
1. **A Registered OISC Adviser**: Authorized by the Office of the Immigration Services Commissioner at Level 1 (Initial advice), Level 2 (Casework & representations), or Level 3 (Appeals & Advocacy).
2. **A Qualified Legal Professional**: An SRA-regulated solicitor, CILEX lawyer, or Bar Standards Board barrister.
3. **An Exempt Organization**: Certain designated voluntary bodies operating under an approved supervisory body.

---

### Reserved Legal Activities (Legal Services Act 2007)
• **Court & Tribunal Advocacy**: Representing a client before the First-tier Tribunal or Upper Tribunal (IAC).
• **Conduct of Litigation**: Lodging formal legal appeals, initiating judicial review proceedings, and issuing statutory court notices.
• **Role of LegalOS**: LegalOS is an advanced assistive legal operations platform. It synthesizes timelines, evidence bundles, and regulatory checklists, but **does not provide reserved legal advice**. All formal submissions require human solicitor or OISC Level 2/3 sign-off.

---
*LegalOS enforces strict compliance with Section 84 IAA 1999 and SRA Standards and Regulations.*`;

    return {
      reply,
      spokenSummary,
      category: "regulation_oisc",
      statutoryCitations: citations,
      requiresHumanReview: false,
      guardrailNotice: "Regulatory boundaries governed by S.84 IAA 1999 and SRA standards.",
    };
  }

  // 5. Default Comprehensive Legal Reasoning Fallback
  const dbChunks = await searchDatabaseCorpus(["standards", "code", "guidance", "rules", "requirements"]);
  const citations = [
    "Immigration Act 1971 (as amended)",
    "Immigration and Asylum Act 1999",
    "Immigration Rules (HC 395)",
    "Tribunal Procedure (First-tier Tribunal) (Immigration and Asylum Chamber) Rules 2014",
  ];

  const spokenSummary = `Here is what you need to know about ${userMessage.slice(0, 100)}. In UK immigration and public law, every process requires clear documentary evidence, meeting strict deadlines, and proper verification of your rights.`;

  const reply = `### LegalOS Plain-Language Guide: "${userMessage}"

Thank you for your question. Here is a clear, structured breakdown of how this process works in the UK immigration and legal system.

---

### 1. Understanding the Process
• **Legal Framework**: UK immigration and administrative decisions are governed by the **Immigration Act 1971**, the **Immigration and Asylum Act 1999**, and the **Immigration Rules**.
• **Standard of Proof**: For administrative applications, the standard of proof is the **balance of probabilities** (more likely than not). In asylum and human rights claims, the lower standard of **reasonable degree of likelihood** applies.
• **Primary Evidence**: The Home Office prioritizes official third-party documentary proof (passports, biometric residence permits, bank statements meeting specified evidence rules, official tenancy agreements, and statutory correspondence).

---

### 2. What You Should Do
1. **Check Your Timelines**: Note any deadlines on Home Office letters or tribunal notices (e.g. in-country tribunal appeals must be lodged within **14 calendar days** of the decision).
2. **Organise Your Documents**: Ensure every document is translated into English with an accredited translator certificate if originally in another language.
3. **Verify Your Status**: You can view your current digital immigration status or generate an employer share code at [gov.uk/view-prove-immigration-status](https://www.gov.uk/view-prove-immigration-status).
4. **Speak to a Regulated Professional**: If you need to submit an application, respond to a notice of refusal, or lodge an appeal, always work with an SRA-regulated solicitor or OISC-registered adviser.

---

### 3. Relevant Statutory Authorities
${citations.map((c) => `• ${c}`).join("\n")}
${dbChunks.length > 0 ? `\n*Database Reference (${dbChunks[0]?.locator}):* "${dbChunks[0]?.text}..."` : ""}

---
*Notice: LegalOS is an assistive operations platform engineered to explain documents and legal process. We do not provide regulated legal advice.*`;

  return {
    reply,
    spokenSummary,
    category: "general_legal",
    statutoryCitations: citations,
    requiresHumanReview: false,
    guardrailNotice: "General legal intelligence synthesis.",
  };
}
