// Accepted: a route obtaining its context from the canonical factory and
// passing it straight to a repository.
import { requireRepositoryContext } from "@/lib/auth/repository-context";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
export async function load(caseId: string) {
  const context = await requireRepositoryContext();
  if (!context.ok) return context;
  return { context: context.value, cookie: SESSION_COOKIE, caseId };
}
