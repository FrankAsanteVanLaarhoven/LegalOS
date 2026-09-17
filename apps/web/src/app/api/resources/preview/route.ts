import { NextRequest, NextResponse } from "next/server";
import { getResourceById } from "@/lib/legal/uk-resources";

/**
 * In-platform preview for legal resources.
 * Official sites often block iframes — we return structured context + source URL.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const resource = getResourceById(id);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  let excerpt = resource.description;
  let fetchOk = false;

  try {
    // Attempt lightweight fetch of public page title context (may fail CORS/bot rules)
    const res = await fetch(resource.url, {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent": "LegalOS/0.2 (resource preview; +https://github.com/FAVL-AI/LegalOS-AI)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
      const desc =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];
      if (title || desc) {
        fetchOk = true;
        excerpt = [title, desc || resource.description].filter(Boolean).join(" — ");
      }
    }
  } catch {
    // keep static description
  }

  return NextResponse.json({
    resource,
    preview: {
      excerpt,
      fetchOk,
      note: fetchOk
        ? "Live page metadata retrieved for in-platform reading."
        : "Live fetch limited; showing LegalOS catalogue description. Open official source to verify.",
      embedBlockedLikely: true,
      viewedInPlatform: true,
      relatedActions: [
        { label: "Set alert for Home Office changes", href: "#alerts" },
        { label: "Open case workspace", href: "/workspace" },
        { label: "Share LegalOS", href: "#share" },
      ],
    },
  });
}
