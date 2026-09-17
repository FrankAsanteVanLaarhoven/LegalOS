import type { RepositoryContext } from "@legalos/repositories";
export function bad(): RepositoryContext {
  return { actorId: "a", accountId: "b", organisationId: "c", memberships: [], correlationId: "d" };
}
