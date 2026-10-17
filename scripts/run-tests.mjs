import esbuild from "esbuild";
import { rm } from "node:fs/promises";

const performanceOnly = process.argv[2] === "performance";
const outfile = performanceOnly ? ".test-dist/performance.test.cjs" : ".test-dist/all.test.cjs";
try {
  await esbuild.build({
    entryPoints: [performanceOnly ? "tests/performance.test.ts" : "tests/all.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile,
    logLevel: "silent"
  });
  await import(new URL(`../${outfile}`, import.meta.url));
} finally {
  await rm(".test-dist", { recursive: true, force: true });
}
