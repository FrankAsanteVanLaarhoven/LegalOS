import { NextResponse } from "next/server";

export type FeedItem = {
  id: string;
  source: "govuk" | "reddit" | "x" | "politics" | "linkedin" | "caselaw" | "news";
  title: string;
  summary: string;
  url: string;
  publishedAt?: string;
  tags: string[];
};

async function fetchGovUkNews(): Promise<FeedItem[]> {
  try {
    const res = await fetch(
      "https://www.gov.uk/search/news-and-communications.json?organisations%5B%5D=home-office&order=updated-newest",
      {
        signal: AbortSignal.timeout(5000),
        next: { revalidate: 900 },
        headers: { Accept: "application/json" },
      }
    );
    if (!res.ok) throw new Error("govuk");
    const data = (await res.json()) as {
      results?: {
        title?: string;
        description?: string;
        link?: string;
        public_timestamp?: string;
      }[];
    };
    return (data.results ?? []).slice(0, 8).map((r, i) => ({
      id: `gov-${i}-${r.link ?? i}`,
      source: "govuk" as const,
      title: r.title ?? "Home Office update",
      summary: r.description ?? "Official GOV.UK communication.",
      url: r.link?.startsWith("http") ? r.link! : `https://www.gov.uk${r.link ?? ""}`,
      publishedAt: r.public_timestamp,
      tags: ["Home Office", "GOV.UK", "official"],
    }));
  } catch {
    return [];
  }
}

async function fetchReddit(sub: string, source: FeedItem["source"]): Promise<FeedItem[]> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=8`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 900 },
      headers: { "User-Agent": "LegalOS/0.2 (public research feed)" },
    });
    if (!res.ok) throw new Error("reddit");
    const data = (await res.json()) as {
      data?: {
        children?: {
          data?: {
            id?: string;
            title?: string;
            selftext?: string;
            url?: string;
            permalink?: string;
            created_utc?: number;
          };
        }[];
      };
    };
    return (data.data?.children ?? []).map((c, i) => {
      const d = c.data ?? {};
      return {
        id: `reddit-${sub}-${d.id ?? i}`,
        source,
        title: d.title ?? "Discussion",
        summary:
          (d.selftext || "").slice(0, 220) || `Public discussion on r/${sub}. Not legal advice.`,
        url: d.permalink
          ? `https://www.reddit.com${d.permalink}`
          : (d.url ?? `https://www.reddit.com/r/${sub}`),
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
        tags: [`r/${sub}`, "public", "discussion"],
      };
    });
  } catch {
    return [];
  }
}

function curatedXAndLinkedIn(): FeedItem[] {
  // Public link-outs for trending topics — live X/LinkedIn APIs need keys.
  return [
    {
      id: "x-homeoffice",
      source: "x",
      title: "Follow: UK Home Office on X",
      summary:
        "Official announcements and operational updates. Open inside LegalOS viewer for context + alerts.",
      url: "https://x.com/ukhomeoffice",
      tags: ["X", "Home Office", "official"],
    },
    {
      id: "x-ukgov",
      source: "x",
      title: "Follow: GOV.UK on X",
      summary: "Cross-government communications including immigration-related posts.",
      url: "https://x.com/GOVUK",
      tags: ["X", "GOV.UK"],
    },
    {
      id: "linkedin-homeoffice",
      source: "linkedin",
      title: "Home Office on LinkedIn",
      summary: "Institutional updates useful for employers, universities, and practitioners.",
      url: "https://www.linkedin.com/company/home-office",
      tags: ["LinkedIn", "institutions"],
    },
    {
      id: "caselaw-nta",
      source: "caselaw",
      title: "Find Case Law — latest judgments",
      summary: "Search publicly available UK court and tribunal judgments (National Archives).",
      url: "https://caselaw.nationalarchives.gov.uk/",
      tags: ["case law", "public judgments"],
    },
    {
      id: "politics-parliament",
      source: "politics",
      title: "Parliament TV & Hansard",
      summary: "Live and archived parliamentary proceedings affecting immigration policy.",
      url: "https://www.parliamentlive.tv/",
      tags: ["politics", "Parliament"],
    },
  ];
}

function fallbackGov(): FeedItem[] {
  return [
    {
      id: "fb-rules",
      source: "govuk",
      title: "Immigration Rules (always verify live page)",
      summary: "Core rules text and structure on GOV.UK. Changes appear via Statements of Changes.",
      url: "https://www.gov.uk/guidance/immigration-rules",
      tags: ["rules", "GOV.UK"],
    },
    {
      id: "fb-asylum",
      source: "govuk",
      title: "Claim asylum in the UK",
      summary: "Process overview and support pathways for people seeking protection.",
      url: "https://www.gov.uk/claim-asylum",
      tags: ["asylum", "GOV.UK"],
    },
  ];
}

export async function GET() {
  const [gov, redditUk, redditImm, redditPol] = await Promise.all([
    fetchGovUkNews(),
    fetchReddit("ukpolitics", "politics"),
    fetchReddit("ukvisa", "reddit"),
    fetchReddit("immigration", "reddit"),
  ]);

  const items = [
    ...gov,
    ...curatedXAndLinkedIn(),
    ...redditImm.slice(0, 5),
    ...redditUk.slice(0, 4),
    ...redditPol.slice(0, 3),
  ];

  // `items` always contains the hardcoded curated entries, so `items.length`
  // was never zero and fallbackGov() was unreachable — a GOV.UK outage produced
  // a "live feed" consisting only of promo cards, with counts.govuk: 0.
  const upstreamReturnedNothing =
    gov.length === 0 && redditImm.length === 0 && redditUk.length === 0 && redditPol.length === 0;
  const finalItems = upstreamReturnedNothing ? [...fallbackGov(), ...curatedXAndLinkedIn()] : items;

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    disclaimer:
      "Feeds are for situational awareness only — not legal advice. Always verify primary GOV.UK / legislation sources. Social posts can be incomplete or wrong.",
    counts: {
      govuk: gov.length,
      reddit: redditImm.length + redditUk.length + redditPol.length,
      curated: curatedXAndLinkedIn().length,
    },
    items: finalItems,
  });
}
