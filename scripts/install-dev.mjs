import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";

const target = process.argv[2] ? resolve(process.argv[2]) : "";
assert.ok(target, "usage: npm run dev:install -- <absolute infinite-board-dev directory>");
assert.equal(basename(target).toLowerCase(), "infinite-board-dev", "target must be the infinite-board-dev directory");
assert.match(
  normalize(target).toLowerCase(),
  /[\\/]\.obsidian[\\/]plugins[\\/]infinite-board-dev$/,
  "target must be inside .obsidian/plugins"
);

await mkdir(target, { recursive: true });
assert.equal((await stat(target)).isDirectory(), true, "target plugin directory is unavailable");

async function hash(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
  } catch (error) {
    if (error?.code === "ENOENT") return "NO_DATA_JSON";
    throw error;
  }
}

const sourceManifest = JSON.parse(await readFile("manifest.json", "utf8"));
const devManifest = {
  ...sourceManifest,
  id: "infinite-board-dev",
  name: "Infinite Whiteboard Dev"
};
const targetManifest = `${JSON.stringify(devManifest, null, 2)}\n`;
const dataPath = join(target, "data.json");
const dataBefore = await hash(dataPath);

for (const name of ["main.js", "styles.css"]) {
  await copyFile(name, join(target, name));
}
await writeFile(join(target, "manifest.json"), targetManifest, "utf8");

assert.equal(await hash(dataPath), dataBefore, "data.json changed during development installation");
for (const name of ["main.js", "styles.css"]) {
  assert.equal(await hash(join(target, name)), await hash(name), `${name} hash mismatch after installation`);
}

console.log(
  `✓ installed ${sourceManifest.version} as infinite-board-dev; data.json=${dataBefore}`
);
