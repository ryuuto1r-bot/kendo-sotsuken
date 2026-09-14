const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=|application\/ld\+json/.test(attrs)).map(([, , code]) => code);
blocks.forEach((code, index) => new vm.Script(code, { filename: `inline-${index}.js` }));
// The app is a single IIFE. Extract declarations by their existing indentation.
function declaration(name) {
    const script = blocks.find(code => code.includes(`function ${name}(`) || code.includes(`class ${name} `));
    assert.ok(script, name);
    const start = script.search(new RegExp(`^        (?:async )?(?:function ${name}\\(|class ${name} )`, 'm'));
    const end = script.indexOf('\n        }', start) + '\n        }'.length;
    return script.slice(start, end);
}
const context = vm.createContext({
    Params: { maxReasonableSpeedMps: 35, referenceShoulderMeters: 0.4, targetFps: 60, videoSlowMotionFactor: 8 },
    AppState: {}, console,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    distance2d: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    validateVideoStrikeSummary: s => ({ ok: s.quality !== false, reason: 'quality' }),
    videoFormalMaxDurationMs: () => 2000
});
const names = ['percentile', 'getMetricLandmark', 'VisibilityAdaptiveFilter3D', 'videoSlowMotionFactorForData',
    'videoFrameStepMs', 'videoStrikeValidationTarget', 'normalizeVideoStrikeBuckets', 'toFiniteOrNull', 'averageNumber',
    'interpolateVideoLandmarkSet', 'interpolatedCoarseVideoFrame', 'videoRawMsFromFrame'];
vm.runInContext(names.map(declaration).join('\n') + '\nthis.Filter = VisibilityAdaptiveFilter3D;', context);
const frames = [0, 0, 4.167, 8.334, 12.501, 100].map(timeMs => ({ timeMs }));
assert.ok(Math.abs(context.videoFrameStepMs({ frames }) - 4.167) < 0.001);
assert.equal(context.videoFrameStepMs({ frames: [], fps: 240, slowMotionFactor: 8, webCodecs: { enabled: true } }), 1000 / 240);
assert.equal(context.videoFrameStepMs({ frames: [], fps: 30, slowMotionFactor: 8 }), 1000 / 240);
const landmarks = [];
landmarks[11] = { x: 0.3, y: 0.5 }; landmarks[12] = { x: 0.7, y: 0.5 };
for (const world of [true, false]) {
    const filter = new context.Filter(12);
    for (let i = 0; i <= 5; i++) {
        const p = { x: 0.5, y: 0.3 + i * 0.01, z: 0 };
        const metric = context.getMetricLandmark(p, world ? p : null, landmarks);
        const result = filter.update(metric, i * 16.667, 0.9);
        if (i === 5) assert.ok(result.velocity.y < 0, 'descent must be negative in both coordinate systems');
    }
    assert.equal(filter.update({ x: 10, y: 10, z: 0, unit: world ? 'm' : 'm-est' }, 1000, 0.9).speed, 0);
    assert.equal(filter.update({ x: 20, y: 20, z: 0, unit: world ? 'm-est' : 'm' }, 1016, 0.9).speed, 0);
}
const candidate = { startFrame: 1, peakFrame: 4, endFrame: 8, durationMs: 700 };
const data = { frames: Array(10).fill({}), strikes: [candidate, { ...candidate }], rejectedStrikes: [{ ...candidate, reason: 'duplicate' }] };
context.normalizeVideoStrikeBuckets(data);
assert.equal(data.strikes.length, 1);
assert.equal(data.rejectedStrikes.length, 0);
context.normalizeVideoStrikeBuckets(data);
assert.equal(data.strikes.length, 1, 'normalization is idempotent');
const invalid = { frames: Array(10).fill({}), strikes: [{ ...candidate, quality: false }], rejectedStrikes: [] };
context.normalizeVideoStrikeBuckets(invalid);
assert.equal(invalid.strikes.length, 0);
assert.equal(invalid.rejectedStrikes.length, 1, 'invalid records must remain excluded');
assert.equal(context.averageNumber([{ angle: null }, { angle: '' }, { angle: 0 }, { angle: 20 }], 'angle'), 10);
assert.equal(context.averageNumber([{ angle: null }], 'angle'), null);
const coarse = [
    { rawTimeMs: 0, timeMs: 0, landmarks: [{ x: 0, y: 0, z: 0 }] },
    { rawTimeMs: 800 / 3, timeMs: 100 / 3, landmarks: [{ x: 1, y: 1, z: 1 }] }
];
const interpolated = context.interpolatedCoarseVideoFrame(coarse, 400 / 3);
assert.equal(interpolated.poseInterpolated, true, 'slow-motion interpolation uses physical time');
assert.equal(interpolated.landmarks[0].x, 0.5);
Object.assign(context, {
    isHandSwingMode: () => false, strikeTimingModeOf: d => d.strikeTimingMode || 'full-motion',
    normalizeStrikeTimingMode: value => value || 'full-motion', normalizeShinaiTrackingMode: () => 'tape',
    updateVideoCorrectionAutosaveStatus: () => {},
    VideoEditorRuntime: { correctionDrafts: { load: () => ({ context: { version: 'old' } }), clear: () => { throw new Error('must preserve old draft'); } } }
});
vm.runInContext("const VIDEO_CORRECTION_DRAFT_VERSION = 'timing-v3-20260906';\n" +
    ['videoCorrectionDraftContext', 'videoCorrectionDraftContextMatches', 'videoCorrectionDraftSignature', 'restoreVideoCorrectionDraft'].map(declaration).join('\n'), context);
context.AppState.videoSource = {};
assert.equal(context.restoreVideoCorrectionDraft({ frames: [{}] }), false);
const currentContext = context.videoCorrectionDraftContext({});
assert.equal(context.videoCorrectionDraftContextMatches({ context: currentContext }, {}), true);
assert.equal(context.videoCorrectionDraftContextMatches({ context: currentContext }, { handSwingMode: true }), false);
assert.equal(context.videoCorrectionDraftContextMatches({ context: currentContext }, { strikeTimingMode: 'downswing' }), false);

const runtimeContext = vm.createContext({ console, setTimeout, clearTimeout });
runtimeContext.window = runtimeContext;
const storage = new Map();
runtimeContext.sessionStorage = {
    get length() { return storage.size; }, key: i => [...storage.keys()][i],
    getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)
};
vm.runInContext(fs.readFileSync(path.join(root, 'video-editor-runtime.js'), 'utf8'), runtimeContext);
async function main() {
    let legacyLoaded = 0;
    Object.assign(context, {
        ensureLegacyPoseLibrary: async () => { legacyLoaded++; context.Pose = class {
            setOptions() {} onResults() {} async initialize() {}
        }; },
        isIOSLikeBrowser: () => false, legacyPoseModelLabel: n => `Legacy ${n}`,
        withTimeout: promise => promise
    });
    vm.runInContext(declaration('ensureLegacyVideoPose'), context);
    await context.ensureLegacyVideoPose();
    assert.equal(legacyLoaded, 1, 'fallback loads its own library');
    await context.ensureLegacyVideoPose();
    assert.equal(legacyLoaded, 1, 'ready model is reused');
    const { correctionDrafts, ExactFrameRenderer } = runtimeContext.KendoVideoEditorRuntime;
    const source = { name: 'test.mov', size: 123, lastModified: 456 };
    assert.equal(correctionDrafts.save(source, { current: { startFrame: 12 } }), true);
    assert.equal(correctionDrafts.load(source).current.startFrame, 12);
    runtimeContext.sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.equal(correctionDrafts.save(source, { current: {} }), false);
    assert.equal(await new Promise(resolve => correctionDrafts.schedule(source, { current: {} }, 0, resolve)), false);
    Object.defineProperty(runtimeContext, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
    assert.equal(correctionDrafts.load(source), null);
    assert.equal(correctionDrafts.save(source, {}), false);
    const renderer = new ExactFrameRenderer();
    const pending = [];
    renderer._decodeBitmap = () => new Promise(resolve => pending.push(resolve));
    const oldContext = {}, newContext = {};
    const oldResult = renderer.getBitmap(oldContext, 0);
    const newResult = renderer.getBitmap(newContext, 0);
    let oldClosed = false;
    pending[0]({ close() { oldClosed = true; } });
    assert.equal(await oldResult, null);
    assert.equal(oldClosed, true);
    assert.equal(renderer.pending.size, 1, 'old completion cannot remove new request');
    const bitmap = { close() {} };
    pending[1](bitmap);
    assert.equal(await newResult, bitmap);
    assert.equal(await renderer.getBitmap(newContext, 0), bitmap);
    console.log('PASS: syntax, direction, gap/unit resets, slow-motion timing, deduplication, draft failures, preview race');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
