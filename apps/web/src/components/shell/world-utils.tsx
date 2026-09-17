"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { X } from "lucide-react";

const CITIES = [
  { id: "london", label: "London", tz: "Europe/London" },
  { id: "dhaka", label: "Dhaka", tz: "Asia/Dhaka" },
  { id: "karachi", label: "Karachi", tz: "Asia/Karachi" },
  { id: "lagos", label: "Lagos", tz: "Africa/Lagos" },
  { id: "warsaw", label: "Warsaw", tz: "Europe/Warsaw" },
  { id: "kyiv", label: "Kyiv", tz: "Europe/Kyiv" },
  { id: "dubai", label: "Dubai", tz: "Asia/Dubai" },
  { id: "beijing", label: "Beijing", tz: "Asia/Shanghai" },
];

const FX_PAIRS = [
  "USD",
  "EUR",
  "PLN",
  "RON",
  "BDT",
  "PKR",
  "INR",
  "NGN",
  "TRY",
  "UAH",
  "CNY",
  "AED",
];

function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Storm";
}

export function WorldUtilsPanel() {
  const { utilsOpen, setUtilsOpen, t } = useApp();
  const [now, setNow] = useState(() => new Date());
  const [amount, setAmount] = useState("100");
  const [to, setTo] = useState("USD");
  const [fx, setFx] = useState<{ result: number; rate: number; offline?: boolean } | null>(null);
  const [weather, setWeather] = useState<{
    days: { date: string; max: number; min: number; precip: number; code: number }[];
    offline?: boolean;
  } | null>(null);

  // The panel is mounted on every page and renders null while closed, but this
  // interval had an empty dep array — so every page in the app scheduled a state
  // update and a reconciliation once per second, forever, for a hidden panel.
  useEffect(() => {
    if (!utilsOpen) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [utilsOpen]);

  useEffect(() => {
    if (!utilsOpen) return;
    fetch("/api/weather")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("weather"))))
      .then(setWeather)
      .catch(() => setWeather(null));
  }, [utilsOpen]);

  useEffect(() => {
    if (!utilsOpen) return;
    const a = Number(amount) || 0;
    fetch(`/api/currency?from=GBP&to=${to}&amount=${a}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fx"))))
      .then(setFx)
      .catch(() => setFx(null));
  }, [utilsOpen, amount, to]);

  if (!utilsOpen) return null;

  return (
    <div className="fixed inset-x-0 top-[4.25rem] z-40 border-b border-[var(--line)] bg-[var(--bg-elevated)]/95 shadow-lg backdrop-blur-md">
      <div className="mx-auto max-w-[1400px] section-pad py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("utils.clocks")} · {t("utils.currency")} · {t("utils.weather")}
          </p>
          <button
            type="button"
            onClick={() => setUtilsOpen(false)}
            className="rounded-full p-1.5 text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <h3 className="text-sm font-medium">{t("utils.clocks")}</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {CITIES.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--line)] px-3 py-2">
                  <div className="text-[11px] text-[var(--muted)]">{c.label}</div>
                  <div className="font-mono text-sm tabular-nums">
                    {now.toLocaleTimeString("en-GB", {
                      timeZone: c.tz,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium">{t("utils.currency")}</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                {t("utils.amount")} (GBP)
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 block h-9 w-28 rounded-lg border border-[var(--line)] bg-transparent px-2 text-sm"
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                {t("utils.to")}
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 block h-9 rounded-lg border border-[var(--line)] bg-transparent px-2 text-sm"
                >
                  {FX_PAIRS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {fx && typeof fx.result === "number" && (
              <p className="mt-3 text-lg font-semibold tabular-nums">
                {fx.result.toLocaleString()} {to}{" "}
                <span className="text-xs font-normal text-[var(--muted)]">
                  (1 GBP ≈ {fx.rate} {to}
                  {fx.offline ? " · offline rate" : ""})
                </span>
              </p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium">{t("utils.weather")}</h3>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {(weather?.days ?? []).map((d) => (
                <div
                  key={d.date}
                  className="min-w-[4.5rem] rounded-lg border border-[var(--line)] px-2 py-2 text-center"
                >
                  <div className="text-[10px] text-[var(--muted)]">
                    {new Date(d.date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="mt-1 text-[11px]">{weatherLabel(d.code)}</div>
                  <div className="mt-1 text-xs font-semibold tabular-nums">
                    {Math.round(d.max)}° / {Math.round(d.min)}°
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">{d.precip}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
