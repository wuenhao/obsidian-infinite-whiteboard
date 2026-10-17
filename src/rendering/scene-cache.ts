import { Camera } from "../model/types";

export interface SceneCacheResult {
  canvas: HTMLCanvasElement;
  reused: boolean;
}

export function sceneCacheKey(width: number, height: number, camera: Camera): string {
  return `${width}x${height}:${camera.x}:${camera.y}:${camera.zoom}`;
}

export function canReuseSceneCache(valid: boolean, cachedKey: string, nextKey: string): boolean {
  return valid && cachedKey === nextKey;
}

export class SceneCache {
  private canvas: HTMLCanvasElement | null = null;
  private valid = false;
  private key = "";

  resolve(source: HTMLCanvasElement, camera: Camera, build: (context: CanvasRenderingContext2D) => void): SceneCacheResult {
    const nextKey = sceneCacheKey(source.width, source.height, camera);
    if (!this.canvas) this.canvas = source.ownerDocument.createElement("canvas");
    if (this.canvas.width !== source.width || this.canvas.height !== source.height) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
      this.valid = false;
    }
    if (canReuseSceneCache(this.valid, this.key, nextKey)) return { canvas: this.canvas, reused: true };

    this.valid = false;
    const context = this.canvas.getContext("2d");
    if (!context) return { canvas: this.canvas, reused: false };
    build(context);
    this.valid = true;
    this.key = nextKey;
    return { canvas: this.canvas, reused: false };
  }

  invalidate(): void {
    this.valid = false;
  }

  release(): void {
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.valid = false;
    this.key = "";
  }
}
