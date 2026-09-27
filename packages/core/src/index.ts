export * from "./types";
export * from "./dates";
export * from "./filter";
export * from "./signals";
export * from "./comingUp";
export * from "./briefing";
export * from "./fixtures";

import { detectComingUp } from "./comingUp";
import { detectQuietRelationships, detectThreadSignals } from "./signals";
import type { Interaction, OpportunitySignal, Person, Project } from "./types";

/** Run every deterministic detector. LLM-backed signals are merged in by the caller. */
export function detectAll(input: {
  now: string;
  people: Person[];
  interactions: Interaction[];
  projects: Project[];
}): OpportunitySignal[] {
  const { now, people, interactions } = input;
  return [
    ...detectThreadSignals(interactions, { now }),
    ...detectQuietRelationships(people, interactions, { now }),
    ...detectComingUp(input),
  ];
}
