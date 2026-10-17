import { BoardData, BoardImage, BrushKind, Point, Stroke } from "../../src/model/types";

export const LARGE_BOARD_STROKES = 1500;
export const LARGE_BOARD_POINTS = 100000;
export const LARGE_BOARD_IMAGES = 20;

const FIXED_TIME = "2026-09-15T00:00:00.000Z";
const COLORS = ["#1c1c1e", "#0a84ff", "#ff3b30", "#34c759"] as const;

function strokePoint(strokeIndex: number, pointIndex: number): Point {
  const column = strokeIndex % 50;
  const row = Math.floor(strokeIndex / 50);
  return {
    x: column * 32 + pointIndex * 1.4,
    y: row * 26 + Math.sin((pointIndex + strokeIndex) * 0.18) * 5,
    pressure: 0.18 + ((pointIndex + strokeIndex) % 70) / 100,
    time: strokeIndex * 1000 + pointIndex * 8
  };
}

function createStroke(index: number, pointCount: number): Stroke {
  const kind: BrushKind = index % 5 === 0 ? "highlighter" : index % 2 === 0 ? "ballpoint" : "pen";
  const size = kind === "highlighter" ? 18 : kind === "ballpoint" ? 2.2 : 3.6;
  const opacity = kind === "highlighter" ? 0.32 : 1;
  const color = COLORS[index % COLORS.length];
  return {
    id: `benchmark-stroke-${index}`,
    type: "stroke",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    tool: kind,
    color,
    size,
    opacity,
    brush: { kind, color, size, opacity, pressure: kind === "highlighter" ? "off" : "standard" },
    points: Array.from({ length: pointCount }, (_, pointIndex) => strokePoint(index, pointIndex))
  };
}

function createImage(index: number): BoardImage {
  return {
    id: `benchmark-image-${index}`,
    type: "image",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    path: `Performance Fixtures/image-${String(index + 1).padStart(2, "0")}.png`,
    x: (index % 5) * 360,
    y: Math.floor(index / 5) * 280,
    width: 320,
    height: 220,
    rotation: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 }
  };
}

export function createLargeBoardFixture(): BoardData {
  const basePoints = Math.floor(LARGE_BOARD_POINTS / LARGE_BOARD_STROKES);
  const remainder = LARGE_BOARD_POINTS % LARGE_BOARD_STROKES;
  const strokes = Array.from({ length: LARGE_BOARD_STROKES }, (_, index) => createStroke(index, basePoints + (index < remainder ? 1 : 0)));
  const images = Array.from({ length: LARGE_BOARD_IMAGES }, (_, index) => createImage(index));
  return {
    schemaVersion: 5,
    updatedAt: FIXED_TIME,
    revision: { documentId: "performance-board", revisionId: "performance-revision", parentRevisionId: null, ancestors: [], generation: 0 },
    camera: { x: 0, y: 0, zoom: 1 },
    elements: [...images, ...strokes]
  };
}

export function countBoardPoints(board: BoardData): number {
  return board.elements.reduce((total, element) => total + (element.type === "stroke" ? element.points.length : 0), 0);
}
