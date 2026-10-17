import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

const artifacts = ["manifest.json", "main.js", "styles.css"];
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const output = `infinite-board-${manifest.version}.zip`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const localParts = [];
const centralParts = [];
let offset = 0;
for (const name of artifacts) {
  const nameBytes = Buffer.from(name, "utf8");
  const content = await readFile(name);
  const compressed = deflateRawSync(content, { level: 9 });
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  localParts.push(local, nameBytes, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBytes);
  offset += local.length + nameBytes.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(artifacts.length, 8);
end.writeUInt16LE(artifacts.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...localParts, centralDirectory, end]);
assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
assert.equal(archive.readUInt16LE(archive.length - 12), artifacts.length);
let existing = null;
try {
  existing = await readFile(output);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (existing) {
  assert.deepEqual(existing, archive, `${output} already exists with different content; refusing to overwrite a published package`);
  console.log(`✓ verified existing ${output}: ${artifacts.join(", ")} (${archive.length} bytes)`);
} else {
  await writeFile(output, archive, { flag: "wx" });
  console.log(`✓ packaged ${output}: ${artifacts.join(", ")} (${archive.length} bytes)`);
}
