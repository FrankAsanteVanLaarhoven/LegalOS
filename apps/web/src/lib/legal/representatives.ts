export interface LegalRepresentative {
  id: string;
  name: string;
  role: string;
  organisation: string;
  domains: string[];
  languages: string[];
  regulated: string;
  location: string;
  bio: string;
  accepting: boolean;
  /** Public path under /images/reps */
  image: string;
  imageAlt: string;
}

/**
 * Demo enterprise partner profiles for the platform.
 * Illustrative partner slots — not an endorsement of any real firm.
 */
export const LEGAL_REPRESENTATIVES: LegalRepresentative[] = [
  {
    id: "rep-1",
    name: "Amina Rahman",
    role: "Solicitor (Immigration & Asylum)",
    organisation: "Northbridge Legal Aid Partnership",
    domains: ["Asylum", "Human rights", "Appeals", "NRM"],
    languages: ["English", "Bengali", "Sylheti"],
    regulated: "SRA regulated · England & Wales",
    location: "London & remote",
    bio: "Focuses on protection claims, trafficking survivors, and First-tier Tribunal appeals. Uses LegalOS for chronology and evidence completeness before hearings.",
    accepting: true,
    image: "/images/reps/amina-rahman.jpg",
    imageAlt: "Portrait of Amina Rahman, solicitor",
  },
  {
    id: "rep-2",
    name: "James Okafor",
    role: "Solicitor (Business Immigration)",
    organisation: "Okafor & Co. Immigration",
    domains: ["Skilled Worker", "Sponsor licence", "ILR", "Global Talent"],
    languages: ["English", "Yoruba"],
    regulated: "SRA regulated · England & Wales",
    location: "Manchester & remote",
    bio: "Advises employers and skilled workers on sponsorship compliance and settlement routes with rapid document packs from LegalOS.",
    accepting: true,
    image: "/images/reps/james-okafor.jpg",
    imageAlt: "Portrait of James Okafor, solicitor",
  },
  {
    id: "rep-3",
    name: "Dr. Marta Kowalska",
    role: "IAA Level 3 Adviser",
    organisation: "Midlands Rights Centre",
    domains: ["Family visas", "EUSS residual", "Administrative review"],
    languages: ["English", "Polish", "Ukrainian"],
    regulated: "IAA Level 3 (formerly OISC)",
    location: "Birmingham",
    bio: "Community-facing advice with strong Polish and Ukrainian language support; uses Mission Control for multilingual intake handoff.",
    accepting: true,
    image: "/images/reps/marta-kowalska.jpg",
    imageAlt: "Illustrative portrait of a fictional IAA-regulated adviser",
  },
  {
    id: "rep-4",
    name: "Samira Al-Hassan",
    role: "Solicitor (Public Law & JR)",
    organisation: "Harbour Chambers",
    domains: ["Judicial review", "Detention", "Age assessment"],
    languages: ["English", "Arabic"],
    regulated: "SRA regulated · England & Wales",
    location: "Leeds & London",
    bio: "Urgent public law challenges. LegalOS drafts and audit logs speed counsel instruction packs under solicitor control.",
    accepting: false,
    image: "/images/reps/samira-al-hassan.jpg",
    imageAlt: "Portrait of Samira Al-Hassan, solicitor",
  },
  {
    id: "rep-5",
    name: "Priya Natarajan",
    role: "Solicitor (Students & Universities)",
    organisation: "Campus Immigration Counsel",
    domains: ["Student visa", "Graduate route", "CAS compliance"],
    languages: ["English", "Tamil", "Hindi"],
    regulated: "SRA regulated · England & Wales",
    location: "Remote-first (UK)",
    bio: "Embedded with university international offices. Turns complex CAS and switching questions into structured LegalOS workspaces.",
    accepting: true,
    image: "/images/reps/priya-natarajan.jpg",
    imageAlt: "Portrait of Priya Natarajan, solicitor",
  },
  {
    id: "rep-6",
    name: "Daniel Mensah",
    role: "Barrister (Immigration)",
    organisation: "Independent immigration chambers (illustrative)",
    domains: ["Advocacy", "Skeleton arguments", "Upper Tribunal"],
    languages: ["English", "Twi"],
    regulated: "Bar Standards Board",
    location: "London",
    bio: "Instructed on complex appeals. Consumes LegalOS evidence graphs and chronologies settled by solicitors.",
    accepting: true,
    image: "/images/reps/daniel-mensah.jpg",
    imageAlt: "Portrait of Daniel Mensah, barrister",
  },
];
