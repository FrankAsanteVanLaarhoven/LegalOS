/**
 * Public UK government and respected legal resources.
 * Always verify the live page — rules change.
 */
export interface LegalResource {
  id: string;
  title: string;
  description: string;
  url: string;
  publisher: string;
  category:
    | "immigration"
    | "asylum"
    | "employment"
    | "tribunal"
    | "modern_slavery"
    | "guidance"
    | "rights"
    | "cases"
    | "news";
}

export const UK_LEGAL_RESOURCES: LegalResource[] = [
  {
    id: "gov-visa-immigration",
    title: "Visas and immigration",
    description: "Official GOV.UK hub for visas, immigration status and applications.",
    url: "https://www.gov.uk/browse/visas-immigration",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-immigration-rules",
    title: "Immigration Rules",
    description: "The Immigration Rules as published and updated by the Home Office.",
    url: "https://www.gov.uk/guidance/immigration-rules",
    publisher: "GOV.UK / Home Office",
    category: "immigration",
  },
  {
    id: "gov-asylum",
    title: "Claim asylum in the UK",
    description: "How the asylum process works and what support may be available.",
    url: "https://www.gov.uk/claim-asylum",
    publisher: "GOV.UK",
    category: "asylum",
  },
  {
    id: "gov-asylum-support",
    title: "Asylum support",
    description: "Housing and financial support while an asylum claim is considered.",
    url: "https://www.gov.uk/asylum-support",
    publisher: "GOV.UK",
    category: "asylum",
  },
  {
    id: "gov-right-to-work",
    title: "Check a job applicant’s right to work",
    description: "Employer guidance and Right to Work checks / share codes.",
    url: "https://www.gov.uk/check-job-applicant-right-to-work",
    publisher: "GOV.UK",
    category: "employment",
  },
  {
    id: "gov-view-prove-status",
    title: "View and prove your immigration status",
    description: "eVisa / online status and share code for work or rent.",
    url: "https://www.gov.uk/view-prove-immigration-status",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-skilled-worker",
    title: "Skilled Worker visa",
    description: "Eligibility, sponsorship and application overview.",
    url: "https://www.gov.uk/skilled-worker-visa",
    publisher: "GOV.UK",
    category: "employment",
  },
  {
    id: "gov-student-visa",
    title: "Student visa",
    description: "Study in the UK — eligibility and application steps.",
    url: "https://www.gov.uk/student-visa",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-graduate-visa",
    title: "Graduate visa",
    description: "Post-study work route after eligible UK study.",
    url: "https://www.gov.uk/graduate-visa",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-ilr",
    title: "Indefinite leave to remain",
    description: "Settlement routes and eligibility overviews.",
    url: "https://www.gov.uk/indefinite-leave-to-remain",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-british-citizenship",
    title: "British citizenship",
    description: "Ways to apply for British citizenship.",
    url: "https://www.gov.uk/british-citizenship",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-nrm",
    title: "National Referral Mechanism guidance",
    description: "Modern slavery / human trafficking identification and NRM process.",
    url: "https://www.gov.uk/government/publications/human-trafficking-victims-referral-and-assessment-forms",
    publisher: "GOV.UK",
    category: "modern_slavery",
  },
  {
    id: "gov-modern-slavery",
    title: "Modern slavery",
    description: "Government modern slavery information and reporting.",
    url: "https://www.gov.uk/government/collections/modern-slavery",
    publisher: "GOV.UK",
    category: "modern_slavery",
  },
  {
    id: "gov-appeal-immigration",
    title: "Appeal against a visa or immigration decision",
    description: "How appeals work when you have a right of appeal.",
    url: "https://www.gov.uk/immigration-asylum-tribunal",
    publisher: "GOV.UK / HMCTS",
    category: "tribunal",
  },
  {
    id: "gov-hmcts-iac",
    title: "Immigration and Asylum Chamber",
    description: "Tribunal information for immigration and asylum appeals.",
    url: "https://www.gov.uk/courts-tribunals/first-tier-tribunal-immigration-and-asylum",
    publisher: "GOV.UK / HMCTS",
    category: "tribunal",
  },
  {
    id: "legislation-nia",
    title: "Nationality, Immigration and Asylum Act 2002",
    description: "Primary legislation available on legislation.gov.uk.",
    url: "https://www.legislation.gov.uk/ukpga/2002/41/contents",
    publisher: "legislation.gov.uk",
    category: "guidance",
  },
  {
    id: "legislation-immigration-1971",
    title: "Immigration Act 1971",
    description: "Foundational immigration statute text.",
    url: "https://www.legislation.gov.uk/ukpga/1971/77/contents",
    publisher: "legislation.gov.uk",
    category: "guidance",
  },
  {
    id: "legislation-modern-slavery-2015",
    title: "Modern Slavery Act 2015",
    description: "Modern slavery offences and related provisions.",
    url: "https://www.legislation.gov.uk/ukpga/2015/30/contents",
    publisher: "legislation.gov.uk",
    category: "modern_slavery",
  },
  {
    id: "legislation-hra",
    title: "Human Rights Act 1998",
    description: "Incorporates ECHR rights into UK law.",
    url: "https://www.legislation.gov.uk/ukpga/1998/42/contents",
    publisher: "legislation.gov.uk",
    category: "rights",
  },
  {
    id: "bailii",
    title: "BAILII — case law search",
    description: "Public database of UK and Irish case law judgments.",
    url: "https://www.bailii.org/",
    publisher: "BAILII",
    category: "guidance",
  },
  {
    id: "rightsnet",
    title: "Rightsnet",
    description: "Welfare rights and related practice resources for advisers.",
    url: "https://www.rightsnet.org.uk/",
    publisher: "Rightsnet",
    category: "rights",
  },
  {
    id: "citizens-advice-immigration",
    title: "Citizens Advice — immigration",
    description: "Independent practical guidance on immigration issues.",
    url: "https://www.citizensadvice.org.uk/immigration/",
    publisher: "Citizens Advice",
    category: "rights",
  },
  {
    id: "refugee-council",
    title: "Refugee Council",
    description: "Support and information for refugees and people seeking asylum.",
    url: "https://www.refugeecouncil.org.uk/",
    publisher: "Refugee Council",
    category: "asylum",
  },
  {
    id: "iaa",
    // The Office of the Immigration Services Commissioner was replaced by the
    // Immigration Advice Authority. Sending someone to check the "OISC register"
    // points them at a body that no longer operates under that name — and
    // checking an adviser is regulated is the most protective single step this
    // cohort can take.
    title: "Immigration Advice Authority (IAA) — regulated immigration advice",
    description:
      "Find regulated immigration advisers and understand advice levels. The IAA replaced the OISC.",
    url: "https://www.gov.uk/find-an-immigration-adviser",
    publisher: "GOV.UK / Immigration Advice Authority",
    category: "guidance",
  },
  {
    id: "sra",
    title: "Solicitors Regulation Authority",
    description: "Check a solicitor or firm is regulated in England and Wales.",
    url: "https://www.sra.org.uk/consumers/register/",
    publisher: "SRA",
    category: "guidance",
  },
  {
    id: "law-society",
    title: "The Law Society — find a solicitor",
    description: "Directory to find solicitors in England and Wales.",
    url: "https://solicitors.lawsociety.org.uk/",
    publisher: "The Law Society",
    category: "guidance",
  },
  {
    id: "acas",
    title: "Acas — work rights advice",
    description: "Independent advice on employment rights and workplace issues.",
    url: "https://www.acas.org.uk/",
    publisher: "Acas",
    category: "employment",
  },
  {
    id: "ico",
    title: "Information Commissioner’s Office",
    description: "Data protection and privacy rights (UK GDPR).",
    url: "https://ico.org.uk/",
    publisher: "ICO",
    category: "rights",
  },
  {
    id: "gov-news-home-office",
    title: "Home Office news and communications",
    description: "Official announcements that may affect policy, guidance, and practice.",
    url: "https://www.gov.uk/search/news-and-communications?organisations%5B%5D=home-office",
    publisher: "GOV.UK",
    category: "news",
  },
  {
    id: "gov-immigration-rules-changes",
    title: "Statement of changes to the Immigration Rules",
    description: "Track published statements of changes to the Immigration Rules.",
    url: "https://www.gov.uk/government/collections/immigration-rules-statement-of-changes",
    publisher: "GOV.UK / Home Office",
    category: "news",
  },
  {
    id: "parliament-home-affairs",
    title: "UK Parliament — Home Affairs",
    description: "Debates, committees, and legislation tracking relevant to immigration policy.",
    url: "https://committees.parliament.uk/committee/83/home-affairs-committee/",
    publisher: "UK Parliament",
    category: "news",
  },
  {
    id: "caselaw-national-archives",
    title: "Find Case Law (National Archives)",
    description: "Official judgments from UK courts and tribunals (public).",
    url: "https://caselaw.nationalarchives.gov.uk/",
    publisher: "The National Archives",
    category: "cases",
  },
  {
    id: "bailii-ew",
    title: "BAILII — England & Wales cases",
    description: "Browse England and Wales judgments relevant to immigration and human rights.",
    url: "https://www.bailii.org/ew/cases/",
    publisher: "BAILII",
    category: "cases",
  },
  {
    id: "freemovement",
    title: "Free Movement",
    description: "Specialist commentary on UK immigration law and practice (public articles).",
    url: "https://freemovement.org.uk/",
    publisher: "Free Movement",
    category: "news",
  },
  {
    id: "ilpa",
    title: "ILPA — Immigration Law Practitioners’ Association",
    description: "Professional association resources and public information for practitioners.",
    url: "https://ilpa.org.uk/",
    publisher: "ILPA",
    category: "guidance",
  },
  {
    id: "unhcr-uk",
    title: "UNHCR UK",
    description: "Refugee protection information and UK-relevant materials.",
    url: "https://www.unhcr.org/uk/",
    publisher: "UNHCR",
    category: "asylum",
  },
  {
    id: "equality-human-rights",
    title: "Equality and Human Rights Commission",
    description: "Equality and human rights guidance for England and Wales.",
    url: "https://www.equalityhumanrights.com/",
    publisher: "EHRC",
    category: "rights",
  },
  {
    id: "gov-right-to-rent",
    title: "Right to Rent checks",
    description: "Landlord and agent checks on immigration status for housing.",
    url: "https://www.gov.uk/check-tenant-right-to-rent-documents",
    publisher: "GOV.UK",
    category: "immigration",
  },
  {
    id: "gov-eu-settlement",
    title: "EU Settlement Scheme",
    description: "Status and guidance for EU, EEA and Swiss citizens.",
    url: "https://www.gov.uk/settled-status-eu-citizens-families",
    publisher: "GOV.UK",
    category: "immigration",
  },
];

export function getResourceById(id: string): LegalResource | undefined {
  return UK_LEGAL_RESOURCES.find((r) => r.id === id);
}
