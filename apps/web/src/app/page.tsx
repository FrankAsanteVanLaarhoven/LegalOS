import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { Stories } from "@/components/landing/stories";
import { AgentsPreview } from "@/components/landing/agents-preview";
import { Coverage } from "@/components/landing/coverage";
import { Security } from "@/components/landing/security";
import { CTA } from "@/components/landing/cta";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <Stories />
        <AgentsPreview />
        <Coverage />
        <Security />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
