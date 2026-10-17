import { BoardRevision } from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value && !ids.includes(value)) ids.push(value);
    if (ids.length === 32) break;
  }
  return ids;
}

/** Creates a new independent board lineage. */
export function createBoardRevision(): BoardRevision {
  return { documentId: newId("board"), revisionId: newId("revision"), parentRevisionId: null, ancestors: [], generation: 0 };
}

/** Advances the current lineage without relying on a device clock. */
export function advanceBoardRevision(current: BoardRevision): BoardRevision {
  return {
    documentId: current.documentId,
    revisionId: newId("revision"),
    parentRevisionId: current.revisionId,
    ancestors: [current.revisionId, ...current.ancestors.filter((id) => id !== current.revisionId)].slice(0, 32),
    generation: current.generation + 1
  };
}

export function normalizeBoardRevision(value: unknown): BoardRevision | null {
  if (!isRecord(value) || typeof value.documentId !== "string" || !value.documentId || typeof value.revisionId !== "string" || !value.revisionId) return null;
  const parentRevisionId = typeof value.parentRevisionId === "string" && value.parentRevisionId ? value.parentRevisionId : null;
  const ancestors = uniqueIds(value.ancestors);
  if (parentRevisionId && !ancestors.includes(parentRevisionId)) ancestors.unshift(parentRevisionId);
  return {
    documentId: value.documentId,
    revisionId: value.revisionId,
    parentRevisionId,
    ancestors: ancestors.slice(0, 32),
    generation: typeof value.generation === "number" && Number.isInteger(value.generation) && value.generation >= 0 ? value.generation : 0
  };
}

/** Deterministic fallback for legacy v4 boards. Divergent legacy copies are
 * intentionally treated as unrelated rather than silently merged. */
export function legacyBoardRevision(board: UnknownRecord): BoardRevision {
  const elements = Array.isArray(board.elements) ? board.elements : [];
  const identity = `${typeof board.updatedAt === "string" ? board.updatedAt : ""}|${elements.map((element) => {
    if (!isRecord(element)) return "?";
    return `${String(element.id ?? "")}:${String(element.createdAt ?? "")}`;
  }).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return { documentId: `legacy-board-${suffix}`, revisionId: `legacy-revision-${suffix}`, parentRevisionId: null, ancestors: [], generation: 0 };
}

export type BoardRevisionRelation = "same" | "newer" | "older" | "diverged" | "unrelated";

/** Compares causal ancestry only. Timestamp ordering is deliberately ignored. */
export function compareBoardRevisions(local: BoardRevision, external: BoardRevision): BoardRevisionRelation {
  if (local.documentId !== external.documentId) return "unrelated";
  if (local.revisionId === external.revisionId) return "same";
  if (external.ancestors.includes(local.revisionId)) return "newer";
  if (local.ancestors.includes(external.revisionId)) return "older";
  return "diverged";
}
