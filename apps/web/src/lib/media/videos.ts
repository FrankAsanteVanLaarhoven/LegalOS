/**
 * LegalOS film library — one unique file path per placement.
 * Build fails if any `src` is assigned twice.
 */

export type Film = {
  id: string;
  src: string;
  poster: string;
  label: string;
  origin: "initial" | "desktop-new" | "batch4";
  /**
   * Text burned into the footage itself, if any.
   *
   * Ten of these clips carry generation-prompt words rendered into the frame —
   * "asylum" across a woman in bed, "study" over a barbershop, a garbled
   * "fiark" behind a barista. page-backdrop.tsx states that watermarked assets
   * are excluded, but nothing enforced it and the uniqueness check compares
   * only paths, so they shipped. Recording it here makes the problem visible
   * in code and lets `pnpm check:videos` report it.
   *
   * `null` means the frame is clean.
   */
  textOverlay: string | null;
};

export const FILMS = {
  // ── Initial library (kept on the platform) ────────────────────
  sudanHero: {
    id: "sudanHero",
    src: "/videos/hero-sudan-loop.mp4",
    poster: "/images/video-posters/hero-sudan.jpg",
    label: "Sudan displacement → UK protection journey",
    textOverlay: null,
    origin: "initial",
  },
  studentLife: {
    id: "studentLife",
    src: "/videos/hero-student-life.mp4",
    poster: "/images/video-posters/legacy-student-life.jpg",
    label: "UK student life — study, work, pressure",
    textOverlay: null,
    origin: "initial",
  },
  storyFinance: {
    id: "storyFinance",
    src: "/videos/story-01.mp4",
    poster: "/images/video-posters/financial.jpg",
    label: "Financial pressure",
    textOverlay: "Study & Work",
    origin: "initial",
  },
  storyWork: {
    id: "storyWork",
    src: "/videos/story-02.mp4",
    poster: "/images/video-posters/work-docs.jpg",
    label: "Work status and documents",
    textOverlay: "asylum",
    origin: "initial",
  },
  storyStudent: {
    id: "storyStudent",
    src: "/videos/story-03.mp4",
    poster: "/images/video-posters/work-student.jpg",
    label: "Student paperwork",
    textOverlay: "asylum",
    origin: "initial",
  },
  boatJourney: {
    id: "boatJourney",
    src: "/videos/hero-journey-loop.mp4",
    poster: "/images/video-posters/hero-journey.jpg",
    label: "Family journey toward safety",
    textOverlay: null,
    origin: "desktop-new",
  },
  themeFamily: {
    id: "themeFamily",
    src: "/videos/theme-family.mp4",
    poster: "/images/video-posters/theme-family.jpg",
    label: "Family visas and shared uncertainty",
    textOverlay: null,
    origin: "desktop-new",
  },
  themeWork: {
    id: "themeWork",
    src: "/videos/theme-work.mp4",
    poster: "/images/video-posters/theme-work.jpg",
    label: "Work while status is uncertain",
    textOverlay: null,
    origin: "desktop-new",
  },
  themeFinance: {
    id: "themeFinance",
    src: "/videos/theme-finance.mp4",
    poster: "/images/video-posters/theme-finance.jpg",
    label: "Study, work and financial pressure",
    textOverlay: null,
    origin: "desktop-new",
  },
  themeStudent: {
    id: "themeStudent",
    src: "/videos/theme-student.mp4",
    poster: "/images/video-posters/theme-student.jpg",
    label: "Students balancing study and shifts",
    textOverlay: "study (plus a garbled word)",
    origin: "desktop-new",
  },
  themeVocational: {
    id: "themeVocational",
    src: "/videos/theme-vocational.mp4",
    poster: "/images/video-posters/theme-vocational.jpg",
    label: "Vocational study and skill routes",
    textOverlay: "study",
    origin: "desktop-new",
  },

  // ── Batch 4 (videosite folder 4) — replace prior duplicates ───
  asylumWoman: {
    id: "asylumWoman",
    src: "/videos/batch4-asylum-woman.mp4",
    poster: "/images/video-posters/batch4-asylum-woman.jpg",
    label: "Asylum — sleepless nights and fear",
    textOverlay: "asylum",
    origin: "batch4",
  },
  sleepless: {
    id: "sleepless",
    src: "/videos/batch4-sleepless.mp4",
    poster: "/images/video-posters/batch4-sleepless.jpg",
    label: "Sleepless nights while status is pending",
    textOverlay: "asylum",
    origin: "batch4",
  },
  asylumYouth: {
    id: "asylumYouth",
    src: "/videos/batch4-asylum-youth.mp4",
    poster: "/images/video-posters/batch4-asylum-youth.jpg",
    label: "Young people seeking protection",
    textOverlay: "asylum",
    origin: "batch4",
  },
  campusIlr: {
    id: "campusIlr",
    src: "/videos/batch4-campus-ilr.mp4",
    poster: "/images/video-posters/batch4-campus-ilr.jpg",
    label: "Campus life to settlement / ILR pathway",
    textOverlay: "What's there",
    origin: "batch4",
  },
  uncertainty: {
    id: "uncertainty",
    src: "/videos/batch4-uncertainty.mp4",
    poster: "/images/video-posters/batch4-uncertainty.jpg",
    label: "Uncertainty while a case is pending",
    textOverlay: "Uncertainty",
    origin: "batch4",
  },
  retailWork: {
    id: "retailWork",
    src: "/videos/batch4-retail-work.mp4",
    poster: "/images/video-posters/batch4-retail-work.jpg",
    label: "Professional work and employer compliance",
    textOverlay: null,
    origin: "batch4",
  },
} as const satisfies Record<string, Film>;

/**
 * Exactly one surface per film. Never reuse a `src`.
 */
export const PLACEMENT = {
  hero: FILMS.sudanHero,
  features: FILMS.campusIlr,
  storyAsylum: FILMS.asylumWoman,
  // "Papers on the table. Future on the line." — this section is about right to
  // work, visa conditions and sponsor letters, and it was showing a dim bedroom
  // clip with "asylum" burned across it: wrong subject, and a word that
  // contradicts the section on a legal platform. studentLife is documents, a
  // BRP and a phone on a table — the literal subject of the copy, and clean.
  storyWork: FILMS.studentLife,
  storyFinance: FILMS.storyFinance,
  // "Study hard. Work the hours. Watch the clock." — this was the third of the
  // near-identical bedroom clips reading "asylum", which is both the wrong
  // subject for Student and Graduate routes and the wrong word. themeFinance is
  // a desk with books, a laptop and cleaning kit beside it: studying and working
  // the hours, which is the copy, and the frame is clean.
  storyStudent: FILMS.themeFinance,
  storyFamily: FILMS.themeFamily,
  storyCrossing: FILMS.boatJourney,
  agents: FILMS.uncertainty,
  coverageImmigration: FILMS.themeVocational,
  coverageEmployment: FILMS.themeWork,
  cta: FILMS.sleepless,
  // Takes the displaced clip. Its "asylum" overlay is at least consistent here:
  // the demo matter behind this surface is an asylum and trafficking case. It
  // still needs replacing — see textOverlay.
  workspaceMain: FILMS.storyWork,
  workspaceA: FILMS.themeStudent,
  // Takes the displaced clip, as with workspaceMain: its "asylum" overlay is
  // consistent with the demo matter behind this surface. Still needs replacing.
  workspaceB: FILMS.storyStudent,
  enterpriseHero: FILMS.retailWork,
  enterpriseLower: FILMS.asylumYouth,
} as const;

function assertUniquePlacements() {
  const seen = new Map<string, string>();
  for (const [slot, film] of Object.entries(PLACEMENT)) {
    const prev = seen.get(film.src);
    if (prev) {
      throw new Error(
        `Video used twice: ${film.src} in "${prev}" and "${slot}". Never reuse a video.`
      );
    }
    seen.set(film.src, slot);
  }
}
assertUniquePlacements();

export const VIDEOS = PLACEMENT;
