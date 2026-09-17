import { SiteHeader } from "@/components/layout/site-header";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { VideoMedia } from "@/components/ui/video-media";
import { DEMO_CASES } from "@/lib/data/sapana-case";
import { PLACEMENT } from "@/lib/media/videos";
import { WorkspaceCaseList } from "@/components/workspace/workspace-case-list";

export const metadata = {
  title: "Workspace & Cases",
};

const personas = [
  {
    title: "Immigration law firms",
    body: "Case mission control, evidence graphs, and solicitor review queues.",
  },
  {
    title: "NGOs & legal aid",
    body: "Multilingual intake and trafficking / asylum workflow support.",
  },
  {
    title: "Universities",
    body: "Student, Graduate, and sponsor-related status guidance.",
  },
  {
    title: "Employers & HR",
    body: "Right to Work, Share Codes, and Skilled Worker compliance.",
  },
];

export default function WorkspacePage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden bg-[var(--bg)]">
        {/* British Isles flags — multi-nation clients & UK-wide practice */}
        <PageBackdrop id="british-isles-flags" position="top" size="contain" />
        <div className="relative z-[1] mx-auto max-w-[1400px] section-pad py-16 lg:py-24">
          <div className="max-w-2xl">
            <p className="eyebrow">Workspace</p>
            <h1 className="display mt-5 text-[clamp(2.2rem,4.5vw,3.5rem)] tracking-tight">
              Cases, agents, and human review
            </h1>
            <p className="mt-5 text-[16px] leading-relaxed text-[var(--muted)]">
              Create and manage active immigration cases or explore the demonstration matter with timeline intelligence,
              evidence orchestration, multi-agent analysis, and solicitor approval gates.
            </p>
          </div>

          {/* Interactive Case Management List */}
          <WorkspaceCaseList defaultCases={DEMO_CASES} />

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <VideoMedia
              src={PLACEMENT.workspaceA.src}
              poster={PLACEMENT.workspaceA.poster}
              className="aspect-video rounded-sm"
              label={PLACEMENT.workspaceA.label}
              veil="soft"
            />
            <VideoMedia
              src={PLACEMENT.workspaceB.src}
              poster={PLACEMENT.workspaceB.poster}
              className="aspect-video rounded-sm"
              label={PLACEMENT.workspaceB.label}
              veil="soft"
            />
          </div>

          <div className="mt-16 grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {personas.map((p) => (
              <div key={p.title} className="border-t border-[var(--line)] py-7 sm:pr-6">
                <h3 className="text-[15px] font-medium tracking-tight">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
