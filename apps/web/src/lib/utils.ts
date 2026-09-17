import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function confidenceLabel(score: number): string {
  if (score >= 0.85) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
}

export function confidenceColor(score: number): string {
  if (score >= 0.85) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 0.6) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}
