const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function declaration(name) {
    const start = html.search(new RegExp(`^        (?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n        }', start) + '\n        }'.length);
}

async function main() {
    const runtimeContext = vm.createContext({
        console, setTimeout, clearTimeout,
        requestAnimationFrame: callback => queueMicrotask(callback)
    });
    runtimeContext.window = runtimeContext;
    vm.runInContext(fs.readFileSync(path.join(root, 'video-editor-runtime.js'), 'utf8'), runtimeContext);
    const seek = runtimeContext.KendoVideoEditorRuntime.seekVideoTo;
    const video = Object.assign(new EventTarget(), { readyState: 1, currentTime: 0, seeking: false, error: null });
    let settled = false;
    const firstFrame = seek(video, 0).then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, 'metadata is not a decoded image');
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    await firstFrame;

    video.seeking = true;
    settled = false;
    const seeking = seek(video, 0).then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, 'pending seeks must not use the previous frame');
    video.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    await seeking;

    const targetFrame = seek(video, 0.5);
    assert.equal(video.currentTime, 0.5);
    video.dispatchEvent(new Event('seeked'));
    await targetFrame;
    video.readyState = 1;
    video.error = { message: 'decode failed' };
    await assert.rejects(seek(video, 0), /decode failed/);

    class Script extends EventTarget {
        constructor(src = '') { super(); this.src = src; this.dataset = {}; }
        getAttribute(name) { return name === 'src' ? this.src : null; }
        remove() {}
    }
    let attempts = 0;
    const staticScript = new Script('./video-editor-runtime.js?v=20261005');
    const loaderContext = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, console, window: {} });
    loaderContext.document = {
        scripts: [staticScript], createElement: () => new Script(),
        head: { appendChild(script) {
            attempts += 1;
            queueMicrotask(() => {
                loaderContext.window.KendoVideoEditorRuntime = { ready: true };
                script.dispatchEvent(new Event('load'));
            });
        } }
    };
    vm.runInContext(declaration('loadScriptAsset'), loaderContext);
    await loaderContext.loadScriptAsset('./video-editor-runtime.js?v=20261005', () => !!loaderContext.window.KendoVideoEditorRuntime, 100);
    assert.equal(attempts, 1, 'a failed static script can be retried');
    await loaderContext.loadScriptAsset('./video-editor-runtime.js?v=20261005', () => true, 100);
    assert.equal(attempts, 1, 'already loaded runtime is not loaded twice');
    loaderContext.document.scripts = [];
    loaderContext.document.head.appendChild = script => queueMicrotask(() => script.dispatchEvent(new Event('error')));
    await assert.rejects(loaderContext.loadScriptAsset('./missing.js', () => false, 100), /load failed/);

    const elements = Object.fromEntries(['videoAnalysisProgress', 'videoAnalysisProgressText', 'videoAnalysisStatus', 'videoContextActionText', 'videoContextNextBtn']
        .map(id => [id, { textContent: '', dataset: {} }]));
    const uiContext = vm.createContext({
        AppState: { videoAnalysisBusy: true },
        clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
        document: { body: { dataset: { videoStep: 'mark' } }, getElementById: id => elements[id] },
        safeText: (id, value) => { elements[id].textContent = value; }
    });
    vm.runInContext(declaration('setVideoAnalysisProgress') + declaration('updateVideoContextAction'), uiContext);
    uiContext.setVideoAnalysisProgress(65, 'Frame analysis');
    assert.equal(elements.videoAnalysisProgress.value, 65);
    assert.equal(elements.videoContextActionText.textContent, 'Frame analysis (65%)');
    uiContext.updateVideoContextAction('mark');
    assert.equal(elements.videoContextNextBtn.disabled, true, 'metadata or tab updates cannot re-enable analysis while busy');
    assert.equal(elements.videoContextNextBtn.dataset.contextStep, 'analyze');
    assert.match(html, /video\.onloadedmetadata = \(\) => \{\s*video\.onloadedmetadata = null;/);
    assert.match(html, /if \(!AppState\.videoAnalysisBusy\) switchVideoStep\('mark'\)/);
    console.log('PASS: startup retry, metadata/decoded-frame readiness, seek ownership, progress and busy-state lifecycle');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
