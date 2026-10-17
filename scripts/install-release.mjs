import assert from "node:assert/strict";
import { copyFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, normalize, resolve } from "node:path";

const target = process.argv[2] ? resolve(process.argv[2]) : "";
assert.ok(target, "usage: npm run release:install -- <absolute plugin directory>");
assert.equal(basename(target).toLowerCase(), "infinite-board", "target must be the infinite-board plugin directory");
assert.match(normalize(target).toLowerCase(), /[\\/]\.obsidian[\\/]plugins[\\/]infinite-board$/, "target must be inside .obsidian/plugins");
assert.equal((await stat(target)).isDirectory(), true, "target plugin directory does not exist");

async function hash(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
  } catch (error) {
    if (error?.code === "ENOENT") return "NO_DATA_JSON";
    throw error;
  }
}

const dataPath = join(target, "data.json");
const dataBefore = await hash(dataPath);
for (const name of ["main.js", "styles.css", "manifest.json"]) await copyFile(name, join(target, name));
const dataAfter = await hash(dataPath);
assert.equal(dataAfter, dataBefore, "data.json changed during installation");
for (const name of ["main.js", "styles.css", "manifest.json"]) {
  assert.equal(await hash(join(target, name)), await hash(name), `${name} hash mismatch after installation`);
}
console.log(`✓ installed ${JSON.parse(await readFile("manifest.json", "utf8")).version} with matching artifacts; data.json=${dataAfter}`);
