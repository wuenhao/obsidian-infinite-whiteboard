import { SCHEMA_VERSION } from "./types";
import { legacyBoardRevision } from "./revision";

export type BoardRecord = Record<string, unknown>;
type Migration = (board: BoardRecord) => BoardRecord;

const migrations: Record<number, Migration> = {
  1: (board) => ({ ...board, schemaVersion: 2 }),
  2: (board) => {
    const { strokes, images, ...rest } = board;
    if (strokes !== undefined && !Array.isArray(strokes)) throw new Error("Schema 2 strokes must be an array");
    if (images !== undefined && !Array.isArray(images)) throw new Error("Schema 2 images must be an array");
    const updatedAt = typeof board.updatedAt === "string" ? board.updatedAt : new Date().toISOString();
    const prepare = (value: unknown): unknown => typeof value === "object" && value !== null
      ? { createdAt: updatedAt, updatedAt, ...value }
      : value;
    return {
      ...rest,
      schemaVersion: 3,
      elements: [
        ...(images ?? []).map(prepare),
        ...(strokes ?? []).map(prepare)
      ]
    };
  },
  3: (board) => {
    if (!Array.isArray(board.elements)) throw new Error("Schema 3 elements must be an array");
    return {
      ...board,
      schemaVersion: 4,
      elements: board.elements.map((value) => value && typeof value === "object" && (value as BoardRecord).type === "image"
        ? { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, ...value }
        : value)
    };
  },
  4: (board) => ({
    ...board,
    schemaVersion: 5,
    revision: legacyBoardRevision(board)
  })
};

export function migrateBoard(source: BoardRecord): BoardRecord {
  const rawVersion = source.schemaVersion;
  let version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1;
  if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid board schema ${String(rawVersion)}`);
  if (version > SCHEMA_VERSION) throw new Error(`Unsupported board schema ${version}`);
  let board = { ...source };
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`Missing board migration from schema ${version}`);
    board = migrate(board);
    version += 1;
  }
  return board;
}
