"use client";

import { useState } from "react";
import { X, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCaseStore } from "./case-store-context";
import type { LegalCase } from "@/lib/types";

export function EditCaseModal({
  isOpen,
  onClose,
  legalCase,
}: {
  isOpen: boolean;
  onClose: () => void;
  legalCase: LegalCase;
}) {
  const { updateCaseDetails, deleteCurrentCase } = useCaseStore();

  const [clientName, setClientName] = useState(legalCase.clientName);
  const [nationality, setNationality] = useState(legalCase.nationality);
  const [languagesStr, setLanguagesStr] = useState(legalCase.languages.join(", "));
  const [matterTypesStr, setMatterTypesStr] = useState(legalCase.matterTypes.join(", "));
  const [summary, setSummary] = useState(legalCase.summary);
  const [assignedSolicitor, setAssignedSolicitor] = useState(legalCase.assignedSolicitor || "");
  const [status, setStatus] = useState(legalCase.status);
  const [riskLevel, setRiskLevel] = useState(legalCase.riskLevel);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCaseDetails((c) => ({
      ...c,
      clientName: clientName.trim(),
      nationality: nationality.trim(),
      languages: languagesStr.split(",").map((s) => s.trim()).filter(Boolean),
      matterTypes: matterTypesStr.split(",").map((s) => s.trim()).filter(Boolean),
      summary: summary.trim(),
      assignedSolicitor: assignedSolicitor.trim(),
      status,
      riskLevel,
    }));
    onClose();
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete case "${legalCase.clientName}"? This cannot be undone.`)) {
      deleteCurrentCase();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl scrollbar-thin">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Edit Case Details
            </h2>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{legalCase.reference}</p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Client Name
              </label>
              <input
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Nationality
              </label>
              <input
                type="text"
                required
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Languages (comma separated)
              </label>
              <input
                type="text"
                value={languagesStr}
                onChange={(e) => setLanguagesStr(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Assigned Solicitor
              </label>
              <input
                type="text"
                value={assignedSolicitor}
                onChange={(e) => setAssignedSolicitor(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Matter Types (comma separated)
            </label>
            <input
              type="text"
              required
              value={matterTypesStr}
              onChange={(e) => setMatterTypesStr(e.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Case Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-900 focus:outline-none"
              >
                <option value="intake">Intake</option>
                <option value="evidence_collection">Evidence collection</option>
                <option value="analysis">Analysis</option>
                <option value="lawyer_review">Lawyer review</option>
                <option value="appeal_pending">Appeal pending</option>
                <option value="submitted">Submitted</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Priority / Handling
              </label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as any)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-zinc-900 focus:outline-none"
              >
                <option value="low">Standard</option>
                <option value="medium">Medium Priority</option>
                <option value="high">Priority Handling</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Case Summary
            </label>
            <textarea
              rows={3}
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
            {!legalCase.isDemo ? (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Case
              </button>
            ) : (
              <div className="text-[11px] text-zinc-400">Demo template case</div>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="dark">
                <Save className="mr-1.5 h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
