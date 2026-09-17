"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type {
  CaseTask,
  Deadline,
  EvidenceItem,
  LegalCase,
  TimelineEvent,
} from "@/lib/types";
import {
  addDeadline,
  addEvidenceItem,
  addTask,
  addTimelineEvent,
  createCase,
  CreateCaseInput,
  deleteCase,
  deleteEvidenceItem,
  deleteTimelineEvent,
  getCases,
  getCase,
  toggleEvidenceStatus,
  toggleTaskStatus,
  triggerAIAnalysis,
  updateCase,
} from "@/lib/data/case-store";
import { useRouter } from "next/navigation";

interface CaseStoreContextType {
  legalCase: LegalCase;
  allCases: LegalCase[];
  switchCase: (caseId: string) => void;
  createRealCase: (input: CreateCaseInput) => LegalCase;
  updateCaseDetails: (updater: (c: LegalCase) => LegalCase) => void;
  addTimeline: (event: Omit<TimelineEvent, "id">) => void;
  removeTimeline: (eventId: string) => void;
  addEvidence: (item: Omit<EvidenceItem, "id">) => void;
  changeEvidenceStatus: (
    evidenceId: string,
    status: "received" | "missing" | "requested" | "expired"
  ) => void;
  removeEvidence: (evidenceId: string) => void;
  createTask: (task: Omit<CaseTask, "id">) => void;
  toggleTask: (taskId: string) => void;
  createDeadline: (dl: Omit<Deadline, "id">) => void;
  runAnalysis: () => void;
  deleteCurrentCase: () => void;
}

const CaseStoreContext = createContext<CaseStoreContextType | null>(null);

export function CaseStoreProvider({
  initialCase,
  children,
}: {
  initialCase: LegalCase;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [activeCase, setActiveCase] = useState<LegalCase>(initialCase);
  const [allCases, setAllCases] = useState<LegalCase[]>([]);

  const refresh = useCallback(() => {
    const list = getCases();
    setAllCases(list);
    const existing = list.find((c) => c.id === activeCase.id);
    if (existing) {
      setActiveCase(existing);
    }
  }, [activeCase.id]);

  useEffect(() => {
    const list = getCases();
    setAllCases(list);
    const existing = list.find((c) => c.id === initialCase.id);
    if (existing) {
      setActiveCase(existing);
    }

    const handleUpdate = () => {
      const updatedList = getCases();
      setAllCases(updatedList);
      const match = updatedList.find((c) => c.id === activeCase.id);
      if (match) {
        setActiveCase(match);
      }
    };

    window.addEventListener("legalos_cases_updated", handleUpdate);
    return () => {
      window.removeEventListener("legalos_cases_updated", handleUpdate);
    };
  }, [initialCase.id, activeCase.id]);

  const switchCase = (caseId: string) => {
    const target = getCase(caseId);
    if (target) {
      setActiveCase(target);
      router.push(`/workspace/cases/${target.id}`);
    }
  };

  const createRealCase = (input: CreateCaseInput): LegalCase => {
    const created = createCase(input);
    setActiveCase(created);
    refresh();
    router.push(`/workspace/cases/${created.id}`);
    return created;
  };

  const updateCaseDetails = (updater: (c: LegalCase) => LegalCase) => {
    const updated = updateCase(activeCase.id, updater);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const addTimeline = (event: Omit<TimelineEvent, "id">) => {
    const updated = addTimelineEvent(activeCase.id, event);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const removeTimeline = (eventId: string) => {
    const updated = deleteTimelineEvent(activeCase.id, eventId);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const addEvidence = (item: Omit<EvidenceItem, "id">) => {
    const updated = addEvidenceItem(activeCase.id, item);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const changeEvidenceStatus = (
    evidenceId: string,
    status: "received" | "missing" | "requested" | "expired"
  ) => {
    const updated = toggleEvidenceStatus(activeCase.id, evidenceId, status);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const removeEvidence = (evidenceId: string) => {
    const updated = deleteEvidenceItem(activeCase.id, evidenceId);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const createTask = (task: Omit<CaseTask, "id">) => {
    const updated = addTask(activeCase.id, task);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const toggleTask = (taskId: string) => {
    const updated = toggleTaskStatus(activeCase.id, taskId);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const createDeadline = (dl: Omit<Deadline, "id">) => {
    const updated = addDeadline(activeCase.id, dl);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const runAnalysis = () => {
    const updated = triggerAIAnalysis(activeCase.id);
    if (updated) {
      setActiveCase(updated);
      refresh();
    }
  };

  const deleteCurrentCase = () => {
    deleteCase(activeCase.id);
    refresh();
    router.push("/workspace");
  };

  return (
    <CaseStoreContext.Provider
      value={{
        legalCase: activeCase,
        allCases,
        switchCase,
        createRealCase,
        updateCaseDetails,
        addTimeline,
        removeTimeline,
        addEvidence,
        changeEvidenceStatus,
        removeEvidence,
        createTask,
        toggleTask,
        createDeadline,
        runAnalysis,
        deleteCurrentCase,
      }}
    >
      {children}
    </CaseStoreContext.Provider>
  );
}

export function useCaseStore(): CaseStoreContextType {
  const ctx = useContext(CaseStoreContext);
  const router = useRouter();

  if (ctx) {
    return ctx;
  }

  // Graceful fallback when rendered on standalone pages like /workspace
  const all = getCases();
  const fallbackCase = all[0] ?? ({
    id: "case-sabinah-001",
    reference: "LOS-2026-00481",
    clientName: "Sabinah Mamood",
    preferredName: "Sabinah",
    nationality: "Bangladeshi",
    languages: ["Bengali", "English"],
    status: "appeal_pending",
    matterTypes: ["Asylum"],
    summary: "Demonstration matter.",
    disclaimer: "LegalOS is not a solicitor.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDemo: true,
    riskLevel: "high",
    activeAgents: [],
    timeline: [],
    evidence: [],
    evidenceGraph: [],
    analyses: [],
    tasks: [],
    deadlines: [],
    reviews: [],
  } as LegalCase);

  return {
    legalCase: fallbackCase,
    allCases: all,
    switchCase: (caseId: string) => {
      const target = getCase(caseId);
      if (target) router.push(`/workspace/cases/${target.id}`);
    },
    createRealCase: (input: CreateCaseInput) => {
      const created = createCase(input);
      router.push(`/workspace/cases/${created.id}`);
      return created;
    },
    updateCaseDetails: () => {},
    addTimeline: () => {},
    removeTimeline: () => {},
    addEvidence: () => {},
    changeEvidenceStatus: () => {},
    removeEvidence: () => {},
    createTask: () => {},
    toggleTask: () => {},
    createDeadline: () => {},
    runAnalysis: () => {},
    deleteCurrentCase: () => {},
  };
}
