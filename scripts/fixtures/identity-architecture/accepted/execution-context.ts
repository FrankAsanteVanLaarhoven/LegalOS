// Accepted: the execution-runner context. Shares two fields with a repository
// context and is a different object — its own defect is recorded separately.
export function build(actorId: string, organisationId: string) {
  return { actorId, organisationId, capability: "draft" };
}
