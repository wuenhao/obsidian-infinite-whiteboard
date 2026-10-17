import { compareBoardRevisions } from "../model/revision";
import { BoardRevision } from "../model/types";

export type ExternalBoardUpdateDecision = "reload" | "protect-older" | "protect-diverged" | "protect-inconsistent";

/** Maps causal revision ancestry to the only safe action for an external board update. */
export function externalBoardUpdateDecision(local: BoardRevision, external: BoardRevision): ExternalBoardUpdateDecision {
  const relation = compareBoardRevisions(local, external);
  if (relation === "newer") return "reload";
  if (relation === "older") return "protect-older";
  if (relation === "same") return "protect-inconsistent";
  return "protect-diverged";
}
