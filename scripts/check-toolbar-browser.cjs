// Run after build. NODE_PATH must resolve Playwright; OBSIDIAN_ASAR supplies
// the installed host CSS. Only host APIs are stubbed; UI methods use main.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, webkit } = require('playwright');
const baseline = process.argv.includes('--baseline');
const root = path.resolve(__dirname, '..');
const read = name => baseline ? execFileSync('git', ['show', `v0.4.49:${name}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, name), 'utf8');
const archive = fs.readFileSync(process.env.OBSIDIAN_ASAR || '/Applications/Obsidian.app/Contents/Resources/obsidian.asar');
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
const entry = header.files['app.css'];
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
const hostCSS = archive.subarray(start, start + entry.size).toString();
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'infinite-board-ui-'));

(async () => {
  const engine = process.env.UI_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true } : { headless: true });
  try {
    for (const mode of ['tablet', 'desktop', 'phone']) {
      const context = await browser.newContext({ hasTouch: mode !== 'desktop', isMobile: mode !== 'desktop', deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 1024, height: 820 });
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="infinite-board-view"></div></body>');
      await page.addStyleTag({ content: hostCSS });
      await page.addStyleTag({ content: read('styles.css') });
      await page.addStyleTag({ content: 'html,body{margin:0;width:100%;height:100%}.infinite-board-view{height:100%;background-image:linear-gradient(#e9e9e7 1px,transparent 1px),linear-gradient(90deg,#e9e9e7 1px,transparent 1px);background-size:20px 20px}' });
      await page.evaluate(mode => {
        document.body.className = `theme-light ${mode === 'desktop' ? '' : 'is-mobile'} is-${mode}`;
        const proto = HTMLElement.prototype;
        proto.empty = function () { this.replaceChildren(); };
        proto.addClass = function (name) { this.classList.add(name); };
        proto.removeClass = function (name) { this.classList.remove(name); };
        proto.toggleClass = function (name, on) { this.classList.toggle(name, on); };
        proto.createEl = function (tag, options = {}) {
          const el = document.createElement(tag);
          if (options.cls) el.className = options.cls;
          if (options.text) el.textContent = options.text;
          for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
          this.append(el); return el;
        };
        proto.createDiv = function (options) { return this.createEl('div', options); };
        proto.createSpan = function (options) { return this.createEl('span', options); };
        class Host {
          constructor() { this.contentEl = document.querySelector('.infinite-board-view'); this.app = {}; }
          registerDomEvent(el, type, fn, options) { el.addEventListener(type, fn, options); }
          register() {}
          addAction(icon, label) {
            window.headerActionLabels ??= [];
            window.headerActionLabels.push(label);
            const button = document.createElement('button'); button.title = label; return button;
          }
        }
        window.module = { exports: {} };
        window.require = () => ({
          FileView: Host, Modal: Host, Plugin: Host, Notice: Host, TFile: Host, TFolder: Host,
          Platform: { isDesktop: mode === 'desktop', isTablet: mode === 'tablet', isPhone: mode === 'phone', isIosApp: mode !== 'desktop' },
          normalizePath: p => p,
          setIcon(el, name) {
            const paths = { 'move': 'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4', 'mouse-pointer-2': 'M4 3l7 18 3-7 7-3z', 'chevron-down': 'M6 9l6 6 6-6', 'pen-line': 'M12 20h9M4 16l-1 5 5-1L20 8l-4-4z', 'x': 'M6 6l12 12M6 18L18 6' };
            el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || ''}"/></svg>`;
          }
        });
      }, mode);
      await page.addScriptTag({ content: read('main.js') + '\nwindow.ViewUnderTest=InfiniteBoardView;window.SettingsUnderTest=DEFAULT_SETTINGS;' });
      await page.evaluate(baseline => {
        const view = new window.ViewUnderTest({}, { settings: structuredClone(window.SettingsUnderTest), saveSettings: async () => {} });
        const stubMethods = ['buildDiagnosticsPanel','buildSelectionToolbar','buildPastePanel','scheduleRender','scheduleDiagnostics','cancelSelection','resizeCanvas','updateDiagnostics','setSaveState','markDirty','traceInput'];
        if (baseline) stubMethods.push('buildCanvasPasteMenu');
        for (const name of stubMethods) view[name] = () => {};
        view.buildUi();
        window.statusUnderTest = view.statusEl;
        view.context.fillStyle = '#f7f7f5';
        view.context.fillRect(0,0,view.canvas.width,view.canvas.height);
        window.ui = view; view.setTool('highlighter', false);
      }, baseline);
      if (!baseline) {
        await page.evaluate(() => window.ui.showCanvasPasteMenuAt({ x: 300, y: 250 }));
        const target = page.locator('.infinite-board-canvas-paste-target');
        const actions = page.locator('.infinite-board-canvas-paste-actions');
        assert.equal(await target.isVisible(), false, 'paste editor is hidden until clipboard fallback');
        assert.equal(await actions.isVisible(), true, 'all platforms show the Mac-style paste and close row');
        assert.deepEqual(await page.locator('.infinite-board-canvas-paste-actions').evaluate(el => [...el.children].map(child => child.className)), [
          'infinite-board-canvas-paste-action', 'infinite-board-canvas-paste-target', 'infinite-board-canvas-paste-dismiss'
        ]);
        assert.equal(await page.evaluate(() => window.headerActionLabels.includes('输入诊断')), false, 'diagnostics title action is hidden');
        const menu = await page.locator('.infinite-board-canvas-paste-menu').boundingBox();
        assert.ok(menu.x >= 0 && menu.x + menu.width <= 1024 && menu.y >= 0 && menu.y + menu.height <= 820);
        assert.equal(await page.locator('.infinite-board-paste-panel').count(), 0, 'no second paste overlay');
        await page.screenshot({ path: path.join(output, `${mode}-paste.png`) });
        await page.evaluate(() => window.ui.showNativePasteTarget());
        assert.equal(await target.isVisible(), true, 'clipboard fallback stays in the same contextual control');
        assert.equal(await page.locator('.infinite-board-canvas-paste-action').isVisible(), false, 'fallback keeps the close button and replaces the paste label in place');
        assert.equal(await page.locator('.infinite-board-canvas-paste-dismiss').isVisible(), true);
        assert.equal(await actions.isVisible(), true);
        assert.equal(await page.locator('.infinite-board-canvas-paste-menu').count(), 1);
        await page.evaluate(() => window.ui.hideCanvasPasteMenu());
        await page.evaluate(() => {
          for (let index = 0; index < 4; index += 1) window.statusUnderTest.click();
        });
        assert.equal(await page.locator('.infinite-board-diagnostics').isVisible(), false, 'diagnostics stays closed through four status taps');
        await page.evaluate(() => window.statusUnderTest.click());
        assert.equal(await page.locator('.infinite-board-diagnostics').isVisible(), true, 'fifth rapid status tap opens diagnostics');
        await page.evaluate(() => { for (let index = 0; index < 5; index += 1) window.statusUnderTest.click(); });
        assert.equal(await page.locator('.infinite-board-diagnostics').isVisible(), false, 'another five taps closes diagnostics');
        await page.evaluate(() => window.ui.hideCanvasPasteMenu());
        if (mode === 'tablet') {
          const directPaste = await page.evaluate(async () => {
            const view = window.ui;
            let requests = 0;
            const inputDocument = view.canvas.ownerDocument;
            const original = inputDocument.execCommand;
            inputDocument.execCommand = command => { if (command === 'paste') requests++; return true; };
            const touch = { pointerId: 77, pointerType: 'touch', clientX: 300, clientY: 250 };
            view.beginCanvasLongPress(touch);
            view.finishCanvasLongPress(touch); // a short tap is not paste
            const shortTap = requests;
            view.beginCanvasLongPress(touch);
            await new Promise(resolve => setTimeout(resolve, 575));
            const beforeRelease = requests;
            view.finishCanvasLongPress(touch); // direct request in the gesture
            const longPress = requests;
            view.beginCanvasLongPress(touch);
            view.canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 250 }));
            view.finishCanvasLongPress(touch); // no second request after contextmenu
            const contextMenu = requests;
            view.beginCanvasLongPress({ ...touch, pointerType: 'pen' });
            view.finishCanvasLongPress(touch);
            view.beginCanvasLongPress(touch);
            view.updateCanvasLongPress({ ...touch, clientX: 325 });
            view.finishCanvasLongPress(touch);
            const afterDrag = requests;
            view.touchPointers.set(77, { x: 300, y: 250 });
            view.beginCanvasLongPress({ ...touch, pointerId: 78 }); // second finger cancels
            view.finishCanvasLongPress({ ...touch, pointerId: 78 });
            view.touchPointers.clear();
            view.releaseCanvasPasteProxy();
            inputDocument.execCommand = original;
            return { shortTap, beforeRelease, longPress, contextMenu, afterDrag, afterPinch: requests, menuHidden: view.canvasPasteMenu.hidden };
          });
        assert.deepEqual(directPaste, { shortTap: 0, beforeRelease: 0, longPress: 1, contextMenu: 2, afterDrag: 2, afterPinch: 2, menuHidden: true });
        const toolbarPaste = await page.evaluate(() => {
          const view = window.ui;
          const document = view.contentEl.ownerDocument;
          const original = document.execCommand;
          let requests = 0;
          document.execCommand = command => { if (command === 'paste') requests += 1; return true; };
          view.showCanvasPasteMenuAt({ x: 300, y: 250 });
          view.canvasPasteActions.querySelector('.infinite-board-canvas-paste-action').click();
          const focusedTarget = document.activeElement === view.canvasPasteTarget;
          const targetVisible = !view.canvasPasteTarget.hidden;
          const closeVisible = !view.canvasPasteActions.querySelector('.infinite-board-canvas-paste-dismiss').hidden;
          document.execCommand = original;
          return { requests, focusedTarget, targetVisible, closeVisible };
        });
        assert.deepEqual(toolbarPaste, { requests: 1, focusedTarget: true, targetVisible: true, closeVisible: true }, 'iPad Paste click invokes system paste from the toolbar gesture');
        const importedTypes = await page.evaluate(async () => {
          const view = window.ui;
          const previousImport = view.importImages;
          const hostDocument = view.contentEl.ownerDocument;
          const previousCommand = hostDocument.execCommand;
          let imported = [];
          let releaseImport;
          let menuHiddenWhenImportStarts = false;
          hostDocument.execCommand = command => {
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['image'], 'sample.png', { type: 'image/png' })], items: [] } });
            view.canvasPasteTarget.dispatchEvent(event);
            return command === 'paste';
          };
          view.importImages = files => {
            imported = files.map(file => file.type);
            menuHiddenWhenImportStarts = view.canvasPasteMenu.hidden;
            return new Promise(resolve => { releaseImport = resolve; });
          };
          view.showCanvasPasteMenuAt({ x: 300, y: 250 });
          view.canvasPasteActions.querySelector('.infinite-board-canvas-paste-action').click();
          const hiddenBeforeStorageFinishes = menuHiddenWhenImportStarts;
          releaseImport();
          await new Promise(resolve => setTimeout(resolve, 0));
          view.importImages = previousImport;
          hostDocument.execCommand = previousCommand;
          return { imported, hiddenBeforeStorageFinishes, menuHidden: view.canvasPasteMenu.hidden };
        });
        assert.deepEqual(importedTypes, { imported: ['image/png'], hiddenBeforeStorageFinishes: true, menuHidden: true }, 'confirmed native paste closes the float before asynchronous image import');
          await page.evaluate(() => {
            const view = window.ui;
            const inputDocument = view.canvas.ownerDocument;
            const previousCommand = inputDocument.execCommand;
            inputDocument.execCommand = () => false;
            view.requestCanvasSystemPaste(300, 250);
            inputDocument.execCommand = previousCommand;
          });
          assert.equal(await page.locator('.infinite-board-canvas-paste-target').isVisible(), true, 'rejected command keeps the one-layer fallback');
          await page.evaluate(() => window.ui.hideCanvasPasteMenu());
        }
      }
      const more = page.locator('.infinite-board-more-colors');
      await more.click();
      const colors = await page.locator('.infinite-board-color-cell').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
      const widthRatio = await page.locator('.infinite-board-range').evaluate(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
      console.log(`${mode}: distinct grid colors=${new Set(colors).size}, slider width ratio=${widthRatio.toFixed(2)}`);
      if (!baseline) { assert.equal(new Set(colors).size, 48); assert.ok(widthRatio > .98); }
      await page.screenshot({ path: path.join(output, `${mode}-colors.png`) });
      await page.locator('.infinite-board-color-cell').nth(30).click();
      assert.equal(await more.getAttribute('aria-pressed'), 'true');
      await page.locator('[data-color]').nth(2).click();
      assert.equal(await more.getAttribute('aria-pressed'), 'false');
      await page.locator('button[data-tool="highlighter"]').click();
      if (!baseline) {
        const tipOffset = await page.evaluate(() => {
          const tip = document.querySelector('.infinite-board-stationery-tip').getBoundingClientRect();
          const body = document.querySelector('.infinite-board-stationery-ballpoint .infinite-board-stationery-object').getBoundingClientRect();
          return (tip.left+tip.width/2)-(body.left+body.width/2);
        });
        assert.ok(Math.abs(tipOffset)<.1,'ballpoint tip must be centered');
        const stationeryTops = await page.evaluate(() => [
          '.infinite-board-stationery-tip', '.infinite-board-stationery-nib',
          '.infinite-board-stationery-chisel', '.infinite-board-stationery-lens',
          '.infinite-board-stationery-rubber'
        ].map(selector => {
          const part = document.querySelector(selector);
          return part.getBoundingClientRect().top - part.closest('.infinite-board-stationery-object').getBoundingClientRect().top;
        }));
        assert.ok(Math.max(...stationeryTops)-Math.min(...stationeryTops)<.1,'inactive stationery tops must align');
        if (mode === 'phone') assert.equal(await page.locator('.infinite-board-save-status').evaluate(el=>getComputedStyle(el).top),'94px');
        assert.ok(await page.locator('.infinite-board-brush-panel').evaluate(el => el.getBoundingClientRect().width <= 289));
        for (const slider of await page.locator('.infinite-board-range').all()) assert.ok(await slider.evaluate(el => el.clientWidth / el.parentElement.clientWidth > .98));
        const size = page.getByRole('slider', { name: '粗细', exact: true });
        await size.fill('12');
        assert.equal(await page.locator('.infinite-board-brush-preview-stroke').evaluate(el => el.style.strokeWidth), '12px');
      }
      await page.screenshot({ path: path.join(output, `${mode}-brush.png`) });
      if (!baseline && engine === chromium && mode !== 'desktop') {
        const cdp = await context.newCDPSession(page);
        const slider = await page.getByRole('slider', { name:'粗细', exact:true }).boundingBox();
        const y = slider.y + slider.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:slider.x+20, y, id:1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:slider.x+slider.width-20, y, id:1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
        assert.ok(Number(await page.getByRole('slider',{name:'粗细',exact:true}).inputValue()) > 50, 'finger range drag must update settings');
        await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:slider.x+20,y,button:'left',clickCount:1,pointerType:'pen' });
        await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:slider.x+slider.width/2,y,button:'left',buttons:1,pointerType:'pen' });
        await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:slider.x+slider.width/2,y,button:'left',clickCount:1,pointerType:'pen' });
        const size = Number(await page.getByRole('slider',{name:'粗细',exact:true}).inputValue());
        assert.ok(size > 25 && size < 40, 'pen range drag must update settings');
        if (mode === 'phone') {
          const before = await page.evaluate(() => window.ui.data.camera.zoom);
          await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:150,y:180,id:1},{x:250,y:180,id:2}]});
          await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:100,y:180,id:1},{x:300,y:180,id:2}]});
          await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
          const after = await page.evaluate(() => window.ui.data.camera.zoom);
          assert.ok(after > before * 1.8, `phone pinch: ${before} -> ${after}`);
          assert.equal(await page.locator('.infinite-board-brush-panel').isVisible(),false,'canvas touch closes panel');
          await page.locator('button[data-tool="highlighter"]').click();
          console.log(`phone pinch: ${before} -> ${after}; canvas dismissal passed`);
        }
        console.log(`${mode}: finger and pen slider drag passed`);
        await cdp.detach();
      }
      await page.locator('.infinite-board-panel-close').click();
      if (!baseline) {
        for (const tool of ['pen','ballpoint','laser','eraser','select']) {
          await page.locator(`button[data-tool="${tool}"]`).click();
          await page.locator(`button[data-tool="${tool}"]`).click();
          for (const slider of await page.locator('.infinite-board-range').all()) assert.ok(await slider.evaluate(el => el.clientWidth / el.parentElement.clientWidth > .98));
          await page.screenshot({ path:path.join(output, `${mode}-${tool}-settings.png`) });
          if (mode === 'desktop') await page.locator('canvas.infinite-board-canvas').click({position:{x:30,y:30}});
          else await page.frameLocator('.infinite-board-input-frame').locator('canvas').tap({position:{x:30,y:30}});
          assert.equal(await page.locator('.infinite-board-brush-panel').isVisible(),false,'canvas closes tool settings');
        }
        await page.locator('button[data-tool="highlighter"]').click();
      }
      for (const width of [1024, 610, 390, 320]) {
        await page.setViewportSize({ width, height: 820 });
        const measurements = await page.evaluate(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return [r.width,r.height,r.left,r.right]; };
          const toolbar = document.querySelector('.infinite-board-toolbar');
          const rail = document.querySelector('.infinite-board-instrument-rail');
          return { dock:rect(toolbar), circles:[...document.querySelectorAll('.infinite-board-swatch-fill')].map(rect), controls:[...document.querySelectorAll('.infinite-board-navigation-tool,.infinite-board-toolbar-toggle')].map(rect), rail:[rail.clientWidth,rail.scrollWidth] };
        });
        if (!baseline) {
          assert.ok(measurements.dock[2] >= 0 && measurements.dock[3] <= width);
          assert.equal(measurements.circles.length, 6);
          for (const r of measurements.circles) assert.ok(Math.abs(r[0]-r[1]) < .01);
          for (const r of measurements.controls) for (const side of r.slice(0,2)) assert.ok(Math.abs(side-44*(mode === 'phone' ? .88 : 1)) < .01);
          if (width <= 390) assert.ok(measurements.rail[1] > measurements.rail[0] * 2);
        }
        await page.screenshot({ path:path.join(output, `${mode}-${width}.png`) });
        if (!baseline) {
          await more.click();
          const panel = await page.locator('.infinite-board-brush-panel').boundingBox();
          assert.ok(panel.x >= 0 && panel.x + panel.width <= width);
          await page.locator('.infinite-board-panel-close').click();
        }
      }
      if (!baseline) {
        await page.evaluate(() => document.body.classList.replace('theme-light','theme-dark'));
        assert.equal(await page.locator('.infinite-board-swatch-fill').first().evaluate(el => getComputedStyle(el).outlineWidth),'1px');
        await page.screenshot({path:path.join(output,`${mode}-dark.png`)});
        await page.locator('.infinite-board-toolbar-toggle').click();
        const collapsed = await page.locator('.infinite-board-toolbar').boundingBox();
        assert.ok(Math.abs(collapsed.width-collapsed.height)<.01);
        assert.ok(collapsed.width <= 48);
        assert.deepEqual(errors, []);
      }
      await context.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
