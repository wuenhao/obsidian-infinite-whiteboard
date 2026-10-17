export interface ImageResourceAdapter {
  resourceUrl(path: string): string | null;
  onReady(): void;
}

export interface ImageRetryScheduler {
  schedule(callback: () => void, delayMs: number): number;
  cancel(timer: number): void;
}

export interface ImageCacheLimits {
  maxImages: number;
  maxDecodedBytes: number;
}

export interface ImageCacheStats {
  entries: number;
  estimatedBytes: number;
  visibleEntries: number;
  pendingRetries: number;
}

export const DEFAULT_IMAGE_CACHE_LIMITS: Readonly<ImageCacheLimits> = {
  maxImages: 24,
  maxDecodedBytes: 96 * 1024 * 1024
};

const RETRY_DELAYS_MS = [250, 1000, 3000, 10000, 30000, 60000] as const;

export interface ImagePathElement {
  type: string;
  path?: string;
}

/** The small, cross-browser subset of DataTransfer used by image import. */
export interface ImageTransferItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

export interface ImageTransfer {
  files?: ArrayLike<File>;
  items?: ArrayLike<ImageTransferItem>;
  types?: ArrayLike<string>;
}

export function referencesImagePath(elements: readonly ImagePathElement[], path: string): boolean {
  return elements.some((element) => element.type === "image" && element.path === path);
}

export function unreferencedImagePaths(elements: readonly ImagePathElement[], candidates: readonly string[]): string[] {
  const referenced = new Set(elements.filter((element) => element.type === "image" && element.path).map((element) => element.path as string));
  return candidates.filter((path) => looksLikeImage(path) && !referenced.has(path));
}

export function extensionForImageMime(mime: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif"
  };
  return extensions[mime.toLowerCase()] ?? "png";
}

export function looksLikeImage(name: string): boolean {
  return /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
}

export function imageFilesFromTransfer(transfer: ImageTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const candidates = [
    ...Array.from(transfer.files ?? []),
    ...Array.from(transfer.items ?? []).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => file !== null)
  ];
  const unique = new Map<string, File>();
  for (const file of candidates) {
    if (file.type.startsWith("image/") || looksLikeImage(file.name)) unique.set(`${file.name}:${file.size}:${file.type}`, file);
  }
  return [...unique.values()];
}

/**
 * iOS may withhold the File object until drop. Accept its image-flavoured
 * dragover event so that the later drop is still delivered to the board.
 */
export function acceptsImageTransfer(transfer: ImageTransfer | null | undefined): boolean {
  if (imageFilesFromTransfer(transfer).length > 0) return true;
  return Array.from(transfer?.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}

/**
 * iPadOS split view commonly exposes only the generic Files marker during
 * dragover, then supplies the image MIME and File object at drop time.
 */
export function acceptsFileTransfer(transfer: ImageTransfer | null | undefined): boolean {
  if (!transfer) return false;
  if (Array.from(transfer.types ?? []).includes("Files")) return true;
  if ((transfer.files?.length ?? 0) > 0) return true;
  return Array.from(transfer.items ?? []).some((item) => item.kind === "file");
}

export function readImageDimensions(file: File, fallback = { width: 800, height: 600 }): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const finish = (dimensions: { width: number; height: number }): void => {
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onload = () => finish({ width: image.naturalWidth || fallback.width, height: image.naturalHeight || fallback.height });
    image.onerror = () => finish(fallback);
    image.src = url;
  });
}

export function readImageUrlDimensions(url: string, fallback = { width: 800, height: 600 }): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || fallback.width, height: image.naturalHeight || fallback.height });
    image.onerror = () => resolve(fallback);
    image.src = url;
  });
}

/** Owns decoded browser images without retaining duplicate resources. */
export class ImageAssetCache {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly estimatedBytes = new Map<string, number>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, number>();
  private visible = new Set<string>();
  private visibilityManaged = false;
  private decodedBytes = 0;

  constructor(
    private readonly adapter: ImageResourceAdapter,
    private readonly createImage: () => HTMLImageElement = () => new Image(),
    private readonly scheduler: ImageRetryScheduler = {
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer)
    },
    private readonly limits: ImageCacheLimits = DEFAULT_IMAGE_CACHE_LIMITS
  ) {}

  get stats(): Readonly<ImageCacheStats> {
    return {
      entries: this.images.size,
      estimatedBytes: this.decodedBytes,
      visibleEntries: [...this.visible].filter((path) => this.images.has(path)).length,
      pendingRetries: this.retryTimers.size
    };
  }

  isVisible(path: string): boolean {
    return !this.visibilityManaged || this.visible.has(path);
  }

  retainVisible(paths: Iterable<string>): void {
    this.visibilityManaged = true;
    this.visible = new Set(paths);
    for (const path of this.retryTimers.keys()) {
      if (!this.visible.has(path)) this.clearRetry(path);
    }
    for (const path of this.visible) this.load(path);
    this.enforceBudget();
  }

  get(path: string): HTMLImageElement | undefined {
    const image = this.images.get(path);
    if (image) {
      this.images.delete(path);
      this.images.set(path, image);
    }
    return image;
  }

  load(path: string): void {
    if (this.images.has(path) || this.retryTimers.has(path)) return;
    const resourceUrl = this.adapter.resourceUrl(path);
    if (!resourceUrl) {
      this.scheduleRetry(path);
      return;
    }
    const image = this.createImage();
    image.onload = () => {
      if (this.images.get(path) !== image) return;
      const size = image.naturalWidth * image.naturalHeight * 4;
      const bytes = Number.isFinite(size) ? Math.max(0, size) : 0;
      this.decodedBytes += bytes - (this.estimatedBytes.get(path) ?? 0);
      this.estimatedBytes.set(path, bytes);
      this.clearRetry(path);
      this.enforceBudget();
      this.adapter.onReady();
    };
    image.onerror = () => {
      if (this.images.get(path) !== image) return;
      image.onload = null;
      image.onerror = null;
      this.images.delete(path);
      this.decodedBytes -= this.estimatedBytes.get(path) ?? 0;
      this.estimatedBytes.delete(path);
      this.scheduleRetry(path);
    };
    this.images.set(path, image);
    image.src = resourceUrl;
    this.enforceBudget();
  }

  delete(path: string): void {
    const image = this.images.get(path);
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
    this.images.delete(path);
    this.decodedBytes -= this.estimatedBytes.get(path) ?? 0;
    this.estimatedBytes.delete(path);
    this.clearRetry(path);
  }

  release(): void {
    for (const path of [...this.images.keys()]) this.delete(path);
    for (const timer of this.retryTimers.values()) this.scheduler.cancel(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();
    this.visible.clear();
    this.visibilityManaged = false;
    this.decodedBytes = 0;
  }

  private clearRetry(path: string): void {
    const timer = this.retryTimers.get(path);
    if (timer !== undefined) this.scheduler.cancel(timer);
    this.retryTimers.delete(path);
    this.retryAttempts.delete(path);
  }

  private scheduleRetry(path: string): void {
    if (this.visibilityManaged && !this.visible.has(path)) return;
    if (this.retryTimers.has(path)) return;
    const attempt = this.retryAttempts.get(path) ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length) return;
    this.retryAttempts.set(path, attempt + 1);
    const timer = this.scheduler.schedule(() => {
      this.retryTimers.delete(path);
      if (this.isVisible(path)) this.load(path);
    }, RETRY_DELAYS_MS[attempt]);
    this.retryTimers.set(path, timer);
  }

  private enforceBudget(): void {
    while (this.images.size > this.limits.maxImages || this.decodedBytes > this.limits.maxDecodedBytes) {
      const offscreen = [...this.images.keys()].find((path) => !this.visible.has(path));
      if (!offscreen) break; // Visible images retain their original resolution even over budget.
      this.delete(offscreen);
    }
  }
}
