import assert from "node:assert/strict";
import vm from "node:vm";
import esbuild from "esbuild";

// Exercise the actual FileView adapter with deferred in-memory Vault I/O.
// No Obsidian Vault files or user settings are read or written.
const result = await esbuild.build({
  entryPoints: ["main.ts"], bundle: true, platform: "node", format: "cjs",
  target: "node20", external: ["obsidian"], write: false, logLevel: "silent"
});
const notices = [];
const loggedErrors = [];

class ImageStub {
  naturalWidth = 800;
  naturalHeight = 600;
  set src(_value) { queueMicrotask(() => this.onload?.()); }
}

class FileViewStub {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.file = null; }
  async onOpen() {}
  async onLoadFile(file) { this.file = file; }
  async onUnloadFile(file) { if (this.file === file) this.file = null; }
  registerInterval() {}
  registerDomEvent() {}
  registerEvent() {}
}

const context = {
  module: { exports: {} },
  require(id) {
    assert.equal(id, "obsidian");
    return {
      FileView: FileViewStub, Modal: class {}, Plugin: class {}, Notice: class {
        constructor(message) { notices.push(message); }
      },
      TFile: class {}, TFolder: class {}, Platform: { isIosApp: false },
      normalizePath: (path) => path, setIcon: () => {}
    };
  },
  window: { clearTimeout, setTimeout, setInterval: () => 1, cancelAnimationFrame: () => {}, moment: () => ({ format: () => "test" }) },
  document: { visibilityState: "visible" },
  Image: ImageStub, URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
  performance, crypto: globalThis.crypto, structuredClone,
  console: {
    log: (...args) => console.log(...args),
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => loggedErrors.push(args)
  },
  setTimeout, clearTimeout, queueMicrotask
};
vm.runInNewContext(`${result.outputFiles[0].text}\nmodule.exports.TestView = InfiniteBoardView; module.exports.settings = DEFAULT_SETTINGS;`, context);
const { TestView, settings } = context.module.exports;

function fixture(documentId) {
  return JSON.stringify({
    schemaVersion: 5, updatedAt: "2026-09-23T00:00:00.000Z",
    revision: { documentId, revisionId: `${documentId}-root`, parentRevisionId: null, ancestors: [], generation: 0 },
    camera: { x: 0, y: 0, zoom: 1 }, elements: []
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(promise, label) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function harness() {
  notices.length = 0;
  loggedErrors.length = 0;
  const files = {
    a: { path: "Boards/a.board", basename: "a", parent: { path: "Boards" } },
    b: { path: "Boards/b.board", basename: "b", parent: { path: "Boards" } }
  };
  const contents = new Map([[files.a.path, fixture("a")], [files.b.path, fixture("b")]]);
  const writes = [];
  const created = [];
  const binaryPaths = [];
  let delayedRead = null;
  let delayedWrite = null;
  let delayedBinary = null;
  let activeLeafChanged = null;
  const vault = {
    async read(file) {
      if (file === files.a && delayedRead) return delayedRead.promise;
      return contents.get(file.path);
    },
    async modify(file, content) {
      if (file === files.a && delayedWrite) {
        delayedWrite.started.resolve();
        await delayedWrite.gate.promise;
      }
      contents.set(file.path, content);
      writes.push(file.path);
    },
    async create(path, content) { created.push(path); contents.set(path, content); },
    async createFolder() {},
    async createBinary(path) {
      if (delayedBinary) {
        delayedBinary.started.resolve();
        await delayedBinary.gate.promise;
      }
      binaryPaths.push(path);
    },
    getAbstractFileByPath: () => null,
    on: () => ({})
  };
  const workspace = { on: (name, callback) => {
    if (name === "active-leaf-change") activeLeafChanged = callback;
    return {};
  } };
  const view = new TestView({ app: { vault, workspace } }, { settings: structuredClone(settings) });
  for (const name of ["setSaveState", "traceInput", "scheduleDiagnostics", "scheduleRender", "buildUi", "registerBoardTitleRename"]) {
    view[name] = () => {};
  }
  view.setTool = () => {};
  view.queueSave = () => {};
  view.boardAssets.refresh = () => {};
  return {
    view, files, contents, writes, created, binaryPaths, notices, loggedErrors,
    delayRead: () => (delayedRead = deferred()),
    delayWrite: () => (delayedWrite = { gate: deferred(), started: deferred() }),
    delayBinaryWrite: () => (delayedBinary = { gate: deferred(), started: deferred() }),
    activateOtherLeaf: () => activeLeafChanged?.({})
  };
}

function imageFile(name) {
  return { name, type: "image/png", arrayBuffer: async () => new ArrayBuffer(4) };
}

{
  const { view, files, binaryPaths, notices, delayBinaryWrite, activateOtherLeaf } = harness();
  await view.onOpen();
  await view.onLoadFile(files.a);
  const { gate, started } = delayBinaryWrite();
  const importing = view.importImages([imageFile("one.png"), imageFile("two.png")], { x: 50, y: 60 });
  await waitFor(started.promise, "inactive leaf attachment write");
  activateOtherLeaf();
  gate.resolve();
  await importing;
  assert.equal(view.data.elements.length, 0);
  assert.equal(binaryPaths.length, 1);
  assert.ok(notices.some((message) => message.includes("Boards/a.assets")));
  console.log("✓ switching to another Obsidian tab cancels the old view's import");
}

{
  const { view, files, binaryPaths, notices, loggedErrors } = harness();
  await view.onLoadFile(files.a);
  await view.importImages([
    imageFile("one.png"),
    { name: "notes.txt", type: "text/plain", arrayBuffer: async () => new ArrayBuffer(1) }
  ], { x: 50, y: 60 });
  assert.equal(view.data.elements.length, 1);
  assert.equal(binaryPaths.length, 1);
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][1], "notes.txt");
  assert.ok(notices.some((message) => message.includes("1 张失败")));
  const undone = view.history.undo(view.data);
  assert.equal(undone.elements.length, 0);
  assert.equal(binaryPaths.length, 1, "undo must not delete the attachment");
  console.log("✓ partial batch failure keeps one undoable success and retains its attachment");
}

{
  const { view, files, binaryPaths, notices, delayBinaryWrite } = harness();
  await view.onLoadFile(files.a);
  const { gate, started } = delayBinaryWrite();
  const importing = view.importImages([imageFile("one.png"), imageFile("two.png")], { x: 50, y: 60 });
  await waitFor(started.promise, "switch test attachment write");
  await view.onLoadFile(files.b);
  gate.resolve();
  await importing;
  assert.equal(view.data.revision.documentId, "b");
  assert.equal(view.data.elements.length, 0);
  assert.equal(binaryPaths.length, 1);
  assert.ok(binaryPaths[0].startsWith("Boards/a.assets/"));
  assert.ok(notices.some((message) => message.includes("Boards/a.assets") && message.includes("检查并恢复")));
  console.log("✓ switched-board image import leaves only a recoverable original attachment");
}

{
  const { view, files, binaryPaths, notices, delayBinaryWrite } = harness();
  await view.onLoadFile(files.a);
  const { gate, started } = delayBinaryWrite();
  const importing = view.importImages([imageFile("one.png"), imageFile("two.png")], { x: 50, y: 60 });
  await waitFor(started.promise, "close test attachment write");
  await view.onUnloadFile(files.a);
  assert.equal(view.file, null, "closing the page must not wait for a large image write");
  gate.resolve();
  await importing;
  assert.equal(view.data.elements.length, 0);
  assert.equal(binaryPaths.length, 1);
  assert.ok(notices.some((message) => message.includes("Boards/a.assets")));
  console.log("✓ closing a board stops later images without deleting the in-flight attachment");
}

{
  const { view, files, binaryPaths, notices, delayBinaryWrite } = harness();
  await view.onLoadFile(files.a);
  const { gate, started } = delayBinaryWrite();
  const importing = view.importImages([imageFile("one.png"), imageFile("two.png")], { x: 50, y: 60 });
  await waitFor(started.promise, "rename and close attachment write");
  files.a.path = "Boards/renamed.board";
  files.a.basename = "renamed";
  await view.onUnloadFile(files.a);
  gate.resolve();
  await importing;
  assert.equal(view.data.elements.length, 0);
  assert.equal(binaryPaths.length, 1);
  assert.ok(binaryPaths[0].startsWith("Boards/a.assets/"));
  assert.ok(notices.some((message) => message.includes("Boards/a.assets") && message.includes("旧附件目录")));
  console.log("✓ rename plus close reports the exact old attachment folder");
}

{
  const { view, files, binaryPaths, delayBinaryWrite } = harness();
  await view.onLoadFile(files.a);
  const { gate, started } = delayBinaryWrite();
  const importing = view.importImages([imageFile("one.png")], { x: 50, y: 60 });
  await waitFor(started.promise, "rename test attachment write");
  files.a.path = "Boards/renamed.board";
  files.a.basename = "renamed";
  gate.resolve();
  await importing;
  assert.equal(view.data.elements.length, 1);
  assert.equal(view.data.elements[0].path, binaryPaths[0]);
  assert.ok(binaryPaths[0].startsWith("Boards/a.assets/"));
  console.log("✓ renaming the current board keeps its original attachment reference");
}

{
  const { view, files, contents, created, delayRead } = harness();
  await view.onLoadFile(files.a);
  const token = view.boardSession.currentForFile(files.a);
  const gate = delayRead();
  const oldExternal = view.checkExternalModify(files.a, token);
  await view.onLoadFile(files.b);
  const newer = JSON.parse(contents.get(files.a.path));
  newer.camera.x = 77;
  newer.revision = {
    documentId: "a", revisionId: "a-child", parentRevisionId: "a-root", ancestors: ["a-root"], generation: 1
  };
  gate.resolve(JSON.stringify(newer));
  await oldExternal;
  assert.equal(view.data.revision.documentId, "b");
  assert.equal(view.data.camera.x, 0);
  assert.deepEqual(created, []);
  console.log("✓ delayed external update cannot reload or protect the next board");
}

{
  const { view, files, contents, writes, delayRead } = harness();
  await view.onLoadFile(files.a);
  view.data.camera.x = 12;
  view.markDirty();
  const gate = delayRead();
  const oldSave = view.saveNow();
  await view.onLoadFile(files.b);
  gate.resolve(contents.get(files.a.path));
  await oldSave;
  assert.equal(view.data.revision.documentId, "b");
  assert.equal(view.saveState.lastSavedContent, contents.get(files.b.path));
  assert.deepEqual(writes, []);
  console.log("✓ delayed old-board read cannot save or change the new board");
}

{
  const { view, files, contents, writes, delayWrite } = harness();
  await view.onLoadFile(files.a);
  view.data.camera.x = 12;
  view.markDirty();
  const { gate, started } = delayWrite();
  const oldSave = view.saveNow();
  await waitFor(started.promise, "old-board modify");
  await view.onLoadFile(files.b);
  gate.resolve();
  await oldSave;
  assert.equal(view.data.revision.documentId, "b");
  assert.equal(view.saveState.lastSavedContent, contents.get(files.b.path));
  assert.deepEqual(writes, [files.a.path]);
  console.log("✓ delayed old-board write completes only against its original file");
}

{
  const { view, files, contents, delayWrite } = harness();
  await view.onLoadFile(files.a);
  view.data.camera.x = 12;
  view.markDirty();
  const { gate, started } = delayWrite();
  const save = view.saveNow();
  await waitFor(started.promise, "unload test modify");
  const unload = view.onUnloadFile(files.a);
  await Promise.resolve();
  assert.equal(view.file, files.a, "unload must wait for the active write");
  gate.resolve();
  await Promise.all([save, unload]);
  assert.equal(view.file, null);
  assert.equal(JSON.parse(contents.get(files.a.path)).revision.generation, 1);
  console.log("✓ unload waits for its in-flight write before releasing the file");
}
