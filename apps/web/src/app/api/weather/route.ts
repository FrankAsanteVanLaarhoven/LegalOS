import { NextResponse } from "next/server";

/** Open-Meteo — free, no key. Default: London. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat") ?? "51.5074";
  const lon = searchParams.get("lon") ?? "-0.1278";

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set(
      "daily",
      "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    );
    url.searchParams.set("timezone", "Europe/London");
    url.searchParams.set("forecast_days", "7");

    const res = await fetch(url.toString(), {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("weather upstream error");
    const data = await res.json();

    const days =
      (data.daily?.time as string[] | undefined)?.map((date, i) => ({
        date,
        code: data.daily.weathercode[i] as number,
        max: data.daily.temperature_2m_max[i] as number,
        min: data.daily.temperature_2m_min[i] as number,
        precip: data.daily.precipitation_probability_max[i] as number,
      })) ?? [];

    return NextResponse.json({
      location: "London, UK",
      units: "°C",
      days,
    });
  } catch {
    // Deterministic fallback so UI still works offline
    const base = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        code: [1, 2, 3, 61, 0, 2, 1][i],
        max: [14, 15, 13, 12, 16, 15, 14][i],
        min: [7, 8, 6, 5, 9, 8, 7][i],
        precip: [10, 20, 40, 60, 15, 25, 10][i],
      };
    });
    return NextResponse.json({
      location: "London, UK",
      units: "°C",
      days,
      offline: true,
    });
  }
}
