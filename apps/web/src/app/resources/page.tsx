import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { ResourcesHub } from "@/components/resources/resources-hub";

export const metadata = {
  title: "Legal resources",
  description:
    "Public UK legal resources, live feeds, gov change alerts, and share tools — inside LegalOS.",
};

export default function ResourcesPage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden bg-[var(--bg)]">
        {/* Crown + Union Jack — institutional / official sources */}
        <PageBackdrop id="union-jack-crown" position="top" size="contain" />
        <div className="relative z-[1]">
          <ResourcesHub />
        </div>
      </main>
      <Footer />
    </>
  );
}
