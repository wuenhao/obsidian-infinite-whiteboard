import { BoardAssetHealth } from "./board-asset-coordinator";

/** Stable, display-neutral board and attachment health data for UI and diagnostics. */
export interface BoardHealthSnapshot {
  boardBytes: number;
  referencedImages: number;
  missingImages: number;
  unlinkedPaths: readonly string[];
}

export function boardHealthSnapshot(boardBytes: number, assets: BoardAssetHealth): BoardHealthSnapshot {
  return {
    boardBytes: Math.max(0, Math.floor(boardBytes)),
    referencedImages: assets.referencedPaths.length,
    missingImages: assets.missing,
    unlinkedPaths: [...assets.unlinkedPaths]
  };
}
