import { ScreenPoint } from "../model/types";
import { BoardSession, BoardSessionToken } from "../persistence/board-session";

/** Fixed attachment destination and placement, even if the source board is renamed. */
export class ImageImportTask {
  private cancelled = false;
  readonly placement: ScreenPoint;

  constructor(
    private readonly sessions: BoardSession,
    readonly session: BoardSessionToken,
    readonly file: { path: string; basename: string; parent?: { path: string } | null },
    readonly folderPath: string,
    placement: ScreenPoint
  ) {
    this.placement = { ...placement };
  }

  get active(): boolean {
    return !this.cancelled && this.sessions.isCurrent(this.session);
  }

  cancel(): void {
    this.cancelled = true;
  }
}
