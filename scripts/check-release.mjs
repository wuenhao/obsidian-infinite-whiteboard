import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [manifest, packageJson, packageLock, versions, runtimeSource, main, styles, readme, changelog, license, baseline] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("versions.json"),
  readFile("src/platform/runtime-integrity.ts", "utf8"),
  readFile("main.js", "utf8"),
  readFile("styles.css", "utf8"),
  readFile("README.md", "utf8"),
  readFile("CHANGELOG.md", "utf8"),
  readFile("LICENSE", "utf8"),
  readJson("scripts/release-baseline.json")
]);

const version = manifest.version;
assert.match(version, /^\d+\.\d+\.\d+$/, "manifest version must use semantic versioning");
assert.equal(manifest.id, "infinite-board", "plugin ID must remain stable");
assert.equal(manifest.name, "Infinite Whiteboard", "community display name mismatch");
assert.equal(manifest.author, "贤思齐", "community author mismatch");
assert.ok(manifest.description.length <= 250, "manifest description exceeds the community limit");
assert.ok(manifest.description.endsWith("."), "manifest description must end with a period");
assert.equal(manifest.isDesktopOnly, false, "plugin must remain available on mobile");
assert.equal(packageJson.version, version, "package.json version mismatch");
assert.equal(packageLock.version, version, "package-lock.json version mismatch");
assert.equal(packageLock.packages?.[""]?.version, version, "package-lock root version mismatch");
assert.equal(versions[version], manifest.minAppVersion, "versions.json is missing the release");
assert.match(runtimeSource, new RegExp(`RUNTIME_VERSION = ["']${version.replaceAll(".", "\\.")}["']`), "runtime source version mismatch");
assert.ok(main.includes(version), "production main.js does not contain the release version");
assert.ok(readme.includes("Infinite Whiteboard"), "README display name is missing");
assert.ok(changelog.includes(`## ${version} `), "CHANGELOG release notes are missing");
assert.ok(license.startsWith("MIT License"), "LICENSE must contain the declared MIT license");
assert.equal(main.includes("create-infinite-board"), false, "command ID must not repeat the plugin ID");

for (const artifact of ["manifest.json", "main.js", "styles.css"]) {
  assert.ok((await stat(artifact)).size > 0, `${artifact} is empty`);
}

const forbiddenRuntimeImports = /require\(["'](?:electron|fs|node:fs|path|node:path)["']\)/g;
assert.deepEqual(main.match(forbiddenRuntimeImports) ?? [], [], "runtime bundle contains a desktop-only import");
assert.ok(styles.includes(".infinite-board-view:is(.is-phone, .is-tablet)"), "mobile performance override is missing");
assert.ok(styles.includes("backdrop-filter: none"), "mobile backdrop-filter fallback is missing");

const frozen = baseline.pencilInputBlock;
const frozenStart = main.indexOf(frozen.startMarker);
const frozenEnd = main.indexOf(frozen.endMarker, frozenStart);
assert.ok(frozenStart >= 0 && frozenEnd > frozenStart, "Pencil input freeze markers are missing from main.js");
const frozenHash = createHash("sha256").update(main.slice(frozenStart, frozenEnd), "utf8").digest("hex").toUpperCase();
assert.equal(frozenHash, frozen.sha256, `Pencil input freeze changed since ${frozen.verifiedSince}; physical-iPad review is required`);

console.log(`✓ release contract ${version}: versions, mobile support, runtime imports, artifacts and Pencil freeze`);
