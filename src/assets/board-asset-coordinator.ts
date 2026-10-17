import { ImageAssetCache, ImageCacheLimits, ImageCacheStats, ImagePathElement, ImageRetryScheduler, referencesImagePath, unreferencedImagePaths } from "./image-assets";

export interface BoardAssetCoordinatorOptions {
  resourceUrl(path: string): string | null;
  onImageReady(): void;
  createImage?: () => HTMLImageElement;
  scheduler?: ImageRetryScheduler;
  cacheLimits?: ImageCacheLimits;
}

export interface BoardAssetHealth {
  referencedPaths: string[];
  missing: number;
  unlinkedPaths: string[];
}

/**
 * Coordinates board image references with decoded resources and Vault events.
 * Vault file lookup remains in the Obsidian view adapter.
 */
export class BoardAssetCoordinator {
  private readonly cache: ImageAssetCache;

  constructor(options: BoardAssetCoordinatorOptions) {
    this.cache = new ImageAssetCache(
      { resourceUrl: options.resourceUrl, onReady: options.onImageReady },
      options.createImage,
      options.scheduler,
      options.cacheLimits
    );
  }

  get(path: string): HTMLImageElement | undefined {
    return this.cache.get(path);
  }

  load(path: string): void {
    this.cache.load(path);
  }

  updateVisible(elements: readonly ImagePathElement[]): void {
    this.cache.retainVisible(elements
      .filter((element) => element.type === "image" && element.path)
      .map((element) => element.path as string));
  }

  refresh(path: string): void {
    this.cache.delete(path);
    if (this.cache.isVisible(path)) this.cache.load(path);
  }

  /** Returns whether an arriving Vault file is relevant to the open board. */
  onVaultFile(path: string, elements: readonly ImagePathElement[]): boolean {
    if (!referencesImagePath(elements, path)) return false;
    if (this.cache.isVisible(path)) this.refresh(path);
    else this.cache.delete(path);
    return true;
  }

  get cacheStats(): Readonly<ImageCacheStats> {
    return this.cache.stats;
  }

  inspect(elements: readonly ImagePathElement[], candidates: readonly string[], exists: (path: string) => boolean): BoardAssetHealth {
    const referencedPaths = elements
      .filter((element): element is ImagePathElement & { path: string } => element.type === "image" && typeof element.path === "string")
      .map((element) => element.path);
    return {
      referencedPaths,
      missing: referencedPaths.filter((path) => !exists(path)).length,
      unlinkedPaths: unreferencedImagePaths(elements, candidates)
    };
  }

  release(): void {
    this.cache.release();
  }
}
