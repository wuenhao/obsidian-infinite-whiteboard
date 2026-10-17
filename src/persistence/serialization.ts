import { BoardData, BoardElement } from "../model/types";

function persistentElement(element: BoardElement): BoardElement {
  const base = {
    id: element.id,
    type: element.type,
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
    locked: element.locked
  };
  if (element.type === "image") {
    return {
      ...base,
      type: "image",
      path: element.path,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      crop: { ...element.crop }
    };
  }
  return {
    ...base,
    type: "stroke",
    tool: element.tool,
    color: element.color,
    size: element.size,
    opacity: element.opacity,
    brush: element.brush ? { ...element.brush } : undefined,
    points: element.points.map((point) => ({ ...point }))
  };
}

export function serializeBoard(board: BoardData): string {
  const persistent: BoardData = {
    schemaVersion: board.schemaVersion,
    updatedAt: board.updatedAt,
    revision: {
      documentId: board.revision.documentId,
      revisionId: board.revision.revisionId,
      parentRevisionId: board.revision.parentRevisionId,
      ancestors: [...board.revision.ancestors],
      generation: board.revision.generation
    },
    camera: board.camera,
    elements: board.elements.map(persistentElement)
  };
  return JSON.stringify(persistent);
}

export function isExternalContent(current: string, lastSaved: string, pendingWrite: string): boolean {
  return current !== lastSaved && current !== pendingWrite;
}
