import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { Button } from "@/components/ui/button";
import { VideoMedia } from "@/components/ui/video-media";
import { DEMO_CASES } from "@/lib/data/sapana-case";
import { PLACEMENT } from "@/lib/media/videos";

export const metadata = {
  title: "Workspace",
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
  const demo = DEMO_CASES[0];

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
              Open the Sabinah demo to explore timeline intelligence, evidence orchestration,
              multi-agent analysis, and solicitor approval gates.
            </p>
          </div>

          <div className="mt-12 grid overflow-hidden rounded-sm border border-[var(--line)] bg-white lg:grid-cols-12">
            <div className="relative min-h-[260px] lg:col-span-5 lg:min-h-[360px]">
              <VideoMedia
                src={PLACEMENT.workspaceMain.src}
                poster={PLACEMENT.workspaceMain.poster}
                className="absolute inset-0 h-full w-full rounded-none"
                label={PLACEMENT.workspaceMain.label}
                veil="soft"
              />
            </div>
            <div className="flex flex-col justify-between gap-8 p-8 lg:col-span-7 lg:p-10">
              <div>
                <p className="eyebrow">Demo case</p>
                <h2 className="display mt-3 text-[2rem] tracking-tight">{demo.clientName}</h2>
                <p className="mt-1 font-mono text-[12px] text-[var(--muted)]">
                  {demo.reference} · @sabinahmamood
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {demo.matterTypes.map((m) => (
                    <span
                      key={m}
                      className="border border-[var(--line-strong)] px-2.5 py-1 text-[12px] text-[var(--ink-soft)]"
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--muted)]">
                  {demo.summary}
                </p>
              </div>
              <div>
                <Link href={`/workspace/cases/${demo.id}`}>
                  <Button size="lg" variant="dark">
                    Open Mission Control
                  </Button>
                </Link>
              </div>
            </div>
          </div>

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
