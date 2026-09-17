import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { Footer } from "@/components/layout/footer";
import { DevSessionButton } from "@/components/auth/dev-session-button";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in.
 *
 * Honest about the state rather than showing a form that cannot work: account
 * creation, passkey enrolment and recovery exist as domain logic in
 * @legalos/auth, but nothing connects them to a browser yet.
 */
export default function SignInPage() {
  const isDevelopment = process.env.NODE_ENV !== "production";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[42rem] section-pad py-16 lg:py-24">
        <p className="eyebrow">Account</p>
        <h1 className="display mt-4 text-[clamp(2rem,4vw,3rem)] tracking-tight">Sign in</h1>

        <p className="mt-5 text-[16px] leading-relaxed text-[var(--muted)]">
          Sign-in is being built. Sessions, passkey enrolment and account recovery exist and are
          tested, but nothing connects them to this page yet — so there is no form here rather than
          one that cannot work.
        </p>

        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] px-4 py-3 text-[13px] leading-relaxed text-[var(--muted)]">
          <strong className="font-medium text-[var(--ink)]">Recovery comes first.</strong> An
          account will not become usable until there is a way back into it that does not depend on a
          single phone number. Phones get lost, shared and changed, and an account may hold the only
          copy of evidence somebody needs on a fixed date.
        </div>

        {isDevelopment && (
          <div className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4">
            <p className="text-[13px] font-semibold text-amber-950">Development build</p>
            <p className="mt-1 text-[13px] leading-relaxed text-amber-900">
              This button issues a session with no account behind it, so the workspace stays
              reachable while sign-in is built. It does not exist in a production build.
            </p>
            <DevSessionButton />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
