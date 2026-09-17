"use client";

import { useState } from "react";
import { Plus, X, User, Globe, Briefcase, FileText, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCaseStore } from "./case-store-context";

const COMMON_MATTERS = [
  "Skilled Worker Visa",
  "Family / Spouse Visa",
  "Indefinite Leave to Remain (ILR)",
  "British Citizenship / Naturalisation",
  "Student & Graduate Route",
  "Asylum & Humanitarian Protection",
  "Article 8 ECHR (Private & Family Life)",
  "EU Settlement Scheme (EUSS)",
  "Victims of Modern Slavery / NRM",
  "Visitor / Business Visa",
  "Administrative Review & Tribunal Appeal",
];

const COMMON_LANGUAGES = [
  "English",
  "Urdu",
  "Bengali",
  "Punjabi",
  "Arabic",
  "Hindi",
  "Spanish",
  "French",
  "Farsi / Dari",
  "Yoruba",
  "Mandarin",
  "Turkish",
  "Ukrainian",
  "Portuguese",
];

export function NewCaseModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { createRealCase } = useCaseStore();

  const [clientName, setClientName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [nationality, setNationality] = useState("");
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["English"]);
  const [selectedMatters, setSelectedMatters] = useState<string[]>(["Skilled Worker Visa"]);
  const [summary, setSummary] = useState("");
  const [assignedSolicitor, setAssignedSolicitor] = useState("");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");

  if (!isOpen) return null;

  const toggleMatter = (m: string) => {
    if (selectedMatters.includes(m)) {
      if (selectedMatters.length > 1) {
        setSelectedMatters(selectedMatters.filter((item) => item !== m));
      }
    } else {
      setSelectedMatters([...selectedMatters, m]);
    }
  };

  const toggleLanguage = (l: string) => {
    if (selectedLanguages.includes(l)) {
      if (selectedLanguages.length > 1) {
        setSelectedLanguages(selectedLanguages.filter((item) => item !== l));
      }
    } else {
      setSelectedLanguages([...selectedLanguages, l]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !nationality.trim() || !summary.trim()) {
      alert("Please fill in client name, nationality, and case summary.");
      return;
    }

    createRealCase({
      clientName,
      preferredName: preferredName || clientName.split(" ")[0],
      nationality,
      languages: selectedLanguages,
      matterTypes: selectedMatters,
      summary,
      assignedSolicitor: assignedSolicitor || "Assigned on Intake Queue",
      riskLevel,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl scrollbar-thin">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
          <div>
            <span className="eyebrow text-emerald-700">Real-World Case Intake</span>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Open a New Active Case
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Enter real client details to start an operational file with timeline, evidence, and AI analysis.
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Client Full Name *
              </label>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  required
                  placeholder="e.g. Amara Okafor"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Preferred Name
              </label>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  placeholder="e.g. Amara"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Nationality / Citizenship *
              </label>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  required
                  placeholder="e.g. Nigerian, Ukrainian, Indian..."
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Assigned Solicitor / OISC Adviser
              </label>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  placeholder="e.g. S. Jenkins (OISC Level 2)"
                  value={assignedSolicitor}
                  onChange={(e) => setAssignedSolicitor(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Spoken & Written Languages
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COMMON_LANGUAGES.map((lang) => {
                const active = selectedLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-zinc-900 text-white"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Immigration & Protection Matter Types *
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COMMON_MATTERS.map((matter) => {
                const active = selectedMatters.includes(matter);
                return (
                  <button
                    key={matter}
                    type="button"
                    onClick={() => toggleMatter(matter)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-[var(--accent)] text-white"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {matter}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Case Summary & Context *
            </label>
            <textarea
              required
              rows={3}
              placeholder="Describe the client's current UK immigration journey, dates of arrival, visa expiration, family ties, or any grounds for application/appeal..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Handling Priority:</span>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as "low" | "medium" | "high")}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
              >
                <option value="low">Standard</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High / Expedited</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="dark">
                <Plus className="mr-1.5 h-4 w-4" />
                Create Active Case
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
