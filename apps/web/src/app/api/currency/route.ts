import { NextResponse } from "next/server";

/** Frankfurter (ECB) free FX API */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get("from") ?? "GBP").toUpperCase();
  const to = (searchParams.get("to") ?? "USD").toUpperCase();
  const amount = Number(searchParams.get("amount") ?? "1");

  // NaN and Infinity both serialise to JSON `null`, and the client called
  // `.toLocaleString()` on the result — so `?amount=1e999` or `?amount=abc`
  // crashed the panel during render.
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "amount must be a finite, non-negative number" },
      { status: 400 }
    );
  }

  try {
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("fx error");
    const data = await res.json();
    const rate = data.rates?.[to] as number | undefined;
    if (!rate) throw new Error("pair missing");
    return NextResponse.json({
      from,
      to,
      amount,
      rate,
      result: Math.round(amount * rate * 100) / 100,
      date: data.date,
    });
  } catch {
    const fallback: Record<string, number> = {
      USD: 1.27,
      EUR: 1.17,
      PLN: 5.05,
      RON: 5.85,
      BDT: 150,
      PKR: 350,
      INR: 105,
      NGN: 1600,
      TRY: 41,
      UAH: 52,
      CNY: 9.2,
      AED: 4.66,
    };
    // The old fallback returned `rate: 1` for any pair it did not know —
    // including every non-GBP base — presenting an unconverted amount as a
    // conversion. A missing rate is now reported as missing.
    const rate = from === "GBP" ? fallback[to] : undefined;
    if (rate === undefined) {
      return NextResponse.json(
        { from, to, error: "No rate available for this pair.", offline: true },
        { status: 503 }
      );
    }
    return NextResponse.json({
      from,
      to,
      amount,
      rate,
      result: Math.round(amount * rate * 100) / 100,
      offline: true,
    });
  }
}
