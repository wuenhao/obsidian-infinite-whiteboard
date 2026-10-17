import { BoardImage, ScreenPoint } from "../model/types";
import { extensionForImageMime, looksLikeImage, readImageDimensions } from "./image-assets";

/** Minimal Vault boundary for image import. Obsidian-specific objects stay in the view. */
export interface ImageImportStorage {
  ensureFolder(path: string): Promise<void>;
  writeBinary(path: string, contents: ArrayBuffer): Promise<void>;
}

export interface ImportableImageFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImageImportRequest {
  files: readonly ImportableImageFile[];
  folderPath: string;
  placement: ScreenPoint;
  createId(prefix: string): string;
  now(): string;
  shouldContinue?(): boolean;
}

export interface ImageImportFailure {
  file: ImportableImageFile;
  error: unknown;
}

export interface ImageImportResult {
  images: BoardImage[];
  failures: ImageImportFailure[];
  writtenPaths: string[];
  cancelled: boolean;
}

/**
 * Writes image attachments and produces their persistent board elements.
 * It deliberately does not mutate BoardData, selection, history or UI state.
 */
export class ImageImportService {
  constructor(
    private readonly storage: ImageImportStorage,
    private readonly dimensions: (file: File) => Promise<{ width: number; height: number }> = readImageDimensions
  ) {}

  async import(request: ImageImportRequest): Promise<ImageImportResult> {
    const images: BoardImage[] = [];
    const failures: ImageImportFailure[] = [];
    const writtenPaths: string[] = [];
    const active = (): boolean => request.shouldContinue?.() !== false;
    if (!active()) return { images, failures, writtenPaths, cancelled: true };
    await this.storage.ensureFolder(request.folderPath);
    for (const file of request.files) {
      if (!active()) break;
      try {
        if (!file.type.startsWith("image/") && !looksLikeImage(file.name)) throw new Error(`Unsupported image type: ${file.type}`);
        const extensionFromName = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
        const extension = (extensionFromName || extensionForImageMime(file.type)).replace(/[^a-z0-9]/g, "") || "png";
        const path = `${request.folderPath}/${request.createId("image")}.${extension}`;
        const dimensions = await this.dimensions(file as File);
        await this.storage.writeBinary(path, await file.arrayBuffer());
        writtenPaths.push(path);
        const scale = Math.min(1, 720 / Math.max(1, dimensions.width));
        const offset = images.length * 28;
        const now = request.now();
        images.push({
          id: request.createId("image"), type: "image", createdAt: now, updatedAt: now, path,
          x: request.placement.x - dimensions.width * scale / 2 + offset,
          y: request.placement.y - dimensions.height * scale / 2 + offset,
          width: dimensions.width * scale, height: dimensions.height * scale,
          rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }
        });
      } catch (error) {
        failures.push({ file, error });
      }
    }
    return { images, failures, writtenPaths, cancelled: !active() };
  }
}
