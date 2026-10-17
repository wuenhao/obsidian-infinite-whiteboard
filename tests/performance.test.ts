import assert from "node:assert/strict";
import { parseBoard } from "../src/model/board";
import { serializeBoard } from "../src/persistence/serialization";
import { ElementSpatialIndex } from "../src/rendering/spatial-index";
import { BoardHistory } from "../src/history/board-history";
import { Point, Stroke } from "../src/model/types";
import { smoothCenterline } from "../src/rendering/stroke-geometry";
import { boundsIntersect, elementBounds } from "../src/selection/geometry";
import { DEFAULT_IMAGE_CACHE_LIMITS, ImageAssetCache } from "../src/assets/image-assets";
import { test } from "./test-harness";
import {
  countBoardPoints,
  createLargeBoardFixture,
  LARGE_BOARD_IMAGES,
  LARGE_BOARD_POINTS,
  LARGE_BOARD_STROKES
} from "./fixtures/large-board";

interface PerformanceBaseline {
  elements: number;
  strokes: number;
  images: number;
  points: number;
  serializedBytes: number;
  generateMs: number;
  serializeMs: number;
  parseMs: number;
  indexMs: number;
  queryMs: number;
  queryResults: number;
}

function elapsed(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(1));
}

export function measureLargeBoardBaseline(): PerformanceBaseline {
  let startedAt = performance.now();
  const board = createLargeBoardFixture();
  const generateMs = elapsed(startedAt);

  startedAt = performance.now();
  const serialized = serializeBoard(board);
  const serializeMs = elapsed(startedAt);

  startedAt = performance.now();
  const parsed = parseBoard(serialized);
  const parseMs = elapsed(startedAt);

  startedAt = performance.now();
  const index = new ElementSpatialIndex();
  index.rebuild(parsed.elements);
  const indexMs = elapsed(startedAt);

  startedAt = performance.now();
  const results = index.query(parsed.elements, { minX: 0, minY: 0, maxX: 600, maxY: 500 });
  const queryMs = elapsed(startedAt);

  return {
    elements: parsed.elements.length,
    strokes: parsed.elements.filter((element) => element.type === "stroke").length,
    images: parsed.elements.filter((element) => element.type === "image").length,
    points: countBoardPoints(parsed),
    serializedBytes: Buffer.byteLength(serialized, "utf8"),
    generateMs,
    serializeMs,
    parseMs,
    indexMs,
    queryMs,
    queryResults: results.length
  };
}

test("large-board fixture meets the required performance scale without disk or Vault access", () => {
  const baseline = measureLargeBoardBaseline();
  assert.equal(baseline.strokes, LARGE_BOARD_STROKES);
  assert.equal(baseline.images, LARGE_BOARD_IMAGES);
  assert.equal(baseline.points, LARGE_BOARD_POINTS);
  assert.equal(baseline.elements, LARGE_BOARD_STROKES + LARGE_BOARD_IMAGES);
  assert.ok(baseline.serializedBytes > 1_000_000);
  assert.ok(baseline.queryResults > 0 && baseline.queryResults < baseline.elements);
  // These are regression tripwires, not device performance claims. Physical
  // iPad frame budgets remain governed by IPAD_REGRESSION.md.
  assert.ok(baseline.generateMs < 5000, `fixture generation took ${baseline.generateMs}ms`);
  assert.ok(baseline.serializeMs < 5000, `serialization took ${baseline.serializeMs}ms`);
  assert.ok(baseline.parseMs < 5000, `parsing took ${baseline.parseMs}ms`);
  assert.ok(baseline.indexMs < 5000, `indexing took ${baseline.indexMs}ms`);
  assert.ok(baseline.queryMs < 1000, `viewport query took ${baseline.queryMs}ms`);
  console.log(`PERF_BASELINE ${JSON.stringify(baseline)}`);
});

test("centerline smoothing stays inside the large-stroke geometry budget", () => {
  const points: Point[] = Array.from({ length: 100_000 }, (_, index) => ({
    x: index * 0.75,
    y: Math.sin(index * 0.02) * 0.15 + Math.sin(index * 0.003) * 1.8,
    pressure: 0.5,
    time: index
  }));
  for (let warmup = 0; warmup < 2; warmup += 1) smoothCenterline(points);
  const durations: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const startedAt = performance.now();
    const result = smoothCenterline(points);
    durations.push(elapsed(startedAt));
    assert.equal(result.length, points.length);
  }
  const median = [...durations].sort((left, right) => left - right)[3];
  // Regression tripwire only; physical iPad frame budgets stay in IPAD_REGRESSION.md.
  assert.ok(median < 250, `100,000-point centerline smoothing took ${median}ms`);
  console.log(`INK_GEOMETRY_BASELINE ${JSON.stringify({ points: points.length, medianMs: median })}`);
});

test("element-level eraser history costs less than the compatibility whole-board snapshot", () => {
  const board = createLargeBoardFixture();
  const edited = { ...board, elements: [...board.elements] };
  const stroke = edited.elements[LARGE_BOARD_IMAGES] as Stroke;
  edited.elements[LARGE_BOARD_IMAGES] = { ...stroke, points: stroke.points.slice(0, 10) };
  const timings = { snapshot: [] as number[], incremental: [] as number[] };
  let snapshotBytes = 0;
  let incrementalBytes = 0;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const mode of ["snapshot", "incremental"] as const) {
      const history = new BoardHistory();
      const start = performance.now();
      if (mode === "snapshot") history.begin(board, "erase");
      else history.beginElements(board, "erase");
      history.commit(edited);
      timings[mode].push(performance.now() - start);
      if (mode === "snapshot") snapshotBytes = history.usage.estimatedBytes;
      else incrementalBytes = history.usage.estimatedBytes;
      const restored = history.undo(edited);
      assert.equal((restored.elements[LARGE_BOARD_IMAGES] as Stroke).points.length, stroke.points.length);
      assert.equal(restored.elements.length, board.elements.length);
    }
  }
  const median = (values: number[]): number => Number([...values].sort((left, right) => left - right)[1].toFixed(1));
  assert.ok(incrementalBytes < snapshotBytes / 20, `history footprint ${incrementalBytes} vs ${snapshotBytes}`);
  console.log(`HISTORY_BASELINE ${JSON.stringify({
    elements: board.elements.length, points: LARGE_BOARD_POINTS,
    snapshotMs: median(timings.snapshot), incrementalMs: median(timings.incremental),
    snapshotEstimatedBytes: snapshotBytes, incrementalEstimatedBytes: incrementalBytes
  })}`);
});

test("indexed viewport queries preserve full-scan order while avoiding its repeated bounds work", () => {
  const elements = createLargeBoardFixture().elements;
  const index = new ElementSpatialIndex();
  index.rebuild(elements);
  const viewports = [
    { minX: 0, minY: 0, maxX: 600, maxY: 500 },
    { minX: 500, minY: 200, maxX: 1200, maxY: 720 },
    { minX: -100, minY: -100, maxX: 100, maxY: 100 }
  ];
  const scanTimes: number[] = [];
  const indexTimes: number[] = [];
  for (const viewport of viewports) {
    const expected = elements.filter((element) => boundsIntersect(elementBounds(element), viewport));
    const actual = index.query(elements, viewport);
    assert.deepEqual(actual.map((element) => element.id), expected.map((element) => element.id));
    for (let iteration = 0; iteration < 3; iteration += 1) {
      let started = performance.now();
      for (let repeat = 0; repeat < 10; repeat += 1) {
        elements.filter((element) => boundsIntersect(elementBounds(element), viewport));
      }
      scanTimes.push((performance.now() - started) / 10);
      started = performance.now();
      for (let repeat = 0; repeat < 10; repeat += 1) index.query(elements, viewport);
      indexTimes.push((performance.now() - started) / 10);
    }
  }
  const median = (values: number[]): number => Number([...values].sort((left, right) => left - right)[Math.floor(values.length / 2)].toFixed(2));
  assert.ok(median(indexTimes) < median(scanTimes), `indexed ${median(indexTimes)}ms vs scan ${median(scanTimes)}ms`);
  console.log(`SPATIAL_BASELINE ${JSON.stringify({
    elements: elements.length, points: LARGE_BOARD_POINTS,
    fullScanMs: median(scanTimes), indexedMs: median(indexTimes), viewports: viewports.length
  })}`);
});

test("many original-resolution screenshots remain within the offscreen decoded cache budget", () => {
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; loaded: boolean; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => `resource:${path}`, onReady: () => undefined },
    () => {
      const image = { src: "", naturalWidth: 3000, naturalHeight: 2000, loaded: false, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    }
  );
  const paths = Array.from({ length: 20 }, (_, index) => `screenshot-${index}.png`);
  let peakEstimatedBytes = 0;
  for (let start = 0; start < paths.length; start += 3) {
    const visible = paths.slice(start, start + 3);
    cache.retainVisible(visible);
    for (const image of images) {
      if (image.loaded) continue;
      image.loaded = true;
      image.onload?.();
    }
    peakEstimatedBytes = Math.max(peakEstimatedBytes, cache.stats.estimatedBytes);
    assert.ok(cache.stats.estimatedBytes <= DEFAULT_IMAGE_CACHE_LIMITS.maxDecodedBytes);
    for (const path of visible) {
      assert.equal(cache.get(path)?.naturalWidth, 3000);
      assert.equal(cache.get(path)?.naturalHeight, 2000);
    }
  }
  assert.equal(images.length, 20, "offscreen screenshots should not decode until they enter a viewport");
  console.log(`IMAGE_CACHE_BASELINE ${JSON.stringify({
    screenshots: paths.length, originalWidth: 3000, originalHeight: 2000,
    peakEstimatedBytes, budgetBytes: DEFAULT_IMAGE_CACHE_LIMITS.maxDecodedBytes,
    retainedEntries: cache.stats.entries, visibleEntries: cache.stats.visibleEntries
  })}`);
  cache.release();
  assert.equal(cache.stats.estimatedBytes, 0);
  assert.equal(cache.stats.entries, 0);
});
