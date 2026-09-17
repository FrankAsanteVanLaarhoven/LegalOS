// Accepted: a repository's own typed parameter carrying accountId. `query` is
// not a request; the caller had to construct it legitimately.
export interface CaseQuery { readonly caseId: string; readonly accountId: string }
export function read(query: CaseQuery) { return query.accountId + query.caseId; }
