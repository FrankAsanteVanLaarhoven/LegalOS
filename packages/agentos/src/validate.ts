import { AGENTS } from "./registry.ts";
import {
  CAPABILITIES,
  DEPARTMENTS,
  NEVER_GRANTABLE,
  PERMISSIONS,
  type AgentDefinition,
} from "./types.ts";

/**
 * Structural validation of the registry.
 *
 * Defects in the declarations themselves, all of which fail the build. The
 * substantive one is `NEVER_GRANTABLE`: an agent that declares it may submit a
 * filing or delete evidence is not a configuration choice to be reviewed later,
 * it is a defect, because no arrangement of this system should let a machine do
 * either without a named human deciding.
 */

export interface AgentDefect {
  readonly agentId: string;
  readonly problem: string;
}

export function validateAgents(
  agents: readonly AgentDefinition[] = AGENTS
): readonly AgentDefect[] {
  const defects: AgentDefect[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    if (seen.has(agent.id)) defects.push({ agentId: agent.id, problem: "duplicate id" });
    seen.add(agent.id);

    if (!DEPARTMENTS.includes(agent.department)) {
      defects.push({ agentId: agent.id, problem: `unknown department ${agent.department}` });
    }
    if (agent.capabilities.length === 0) {
      defects.push({
        agentId: agent.id,
        problem: "declares no capability, so nothing can route to it",
      });
    }
    for (const capability of agent.capabilities) {
      if (!CAPABILITIES.includes(capability)) {
        defects.push({ agentId: agent.id, problem: `unknown capability ${capability}` });
      }
    }
    for (const permission of agent.permissions) {
      if (!PERMISSIONS.includes(permission)) {
        defects.push({ agentId: agent.id, problem: `unknown permission ${permission}` });
      }
      if (NEVER_GRANTABLE.includes(permission)) {
        defects.push({
          agentId: agent.id,
          problem: `declares ${permission}, which no agent may hold`,
        });
      }
    }
    if (agent.description.trim().length < 30) {
      defects.push({ agentId: agent.id, problem: "description too thin to review" });
    }
    if (agent.observableInvariants.length === 0) {
      defects.push({ agentId: agent.id, problem: "is bound by no invariant" });
    }
    // Every agent reaches a model through the runner, so every agent is bound
    // by AU-005. An entry that omits it is a definition drifting from the rule
    // rather than an agent exempt from it.
    if (!agent.observableInvariants.includes("AU-005")) {
      defects.push({ agentId: agent.id, problem: "does not declare AU-005" });
    }
  }

  return defects;
}
