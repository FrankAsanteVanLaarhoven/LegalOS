import { DEADLINE_CONTRACT } from "./contracts/deadline.ts";
import { EVIDENCE_CONTRACT } from "./contracts/evidence.ts";
import { GRAPH_CONTRACT } from "./contracts/graph.ts";
import { REVIEW_CONTRACT } from "./contracts/review.ts";
import { SESSION_CONTRACT } from "./contracts/session.ts";
import { TASK_CONTRACT } from "./contracts/task.ts";
import type { RepositoryContract } from "./guarantee.ts";

/**
 * Every repository contract, in the order the repositories were written.
 *
 * Five: the four domains migrated in 0010–0013, plus evidence, which every
 * one of them cites. The repositories that
 * already exist — case and audit — have no contract here yet, and the reason is
 * worth stating rather than leaving as an omission: they live in `apps/web`,
 * which nothing under `packages/` may depend on, so there is currently no place
 * to write a test that imports them. Giving them contracts means either moving
 * them into a package or adding a test runner inside the app. That is a real
 * decision and it is not this one.
 */
export const CONTRACTS: readonly RepositoryContract[] = [
  SESSION_CONTRACT,
  DEADLINE_CONTRACT,
  REVIEW_CONTRACT,
  TASK_CONTRACT,
  GRAPH_CONTRACT,
  EVIDENCE_CONTRACT,
];
