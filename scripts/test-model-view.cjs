const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function declaration(name) {
    const start = html.search(new RegExp(`^        (?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n        }', start) + 10);
}
const nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, dataset: {}, textContent: '', setAttribute() {}, classList: { toggle() {} } });
    return nodes.get(id);
};
const state = { records: [], modelSourceMode: 'video', modelViewPreset: 'front', modelViewZoom: 1 };
const noop = () => {};
const context = vm.createContext({
    AppState: state, document: { getElementById: node, querySelectorAll: () => [] },
    visibilityOf: p => p?.visibility ?? 1,
    clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
    renderAngleModel: noop, safeText: noop, showToast: noop, clearTimeout, console,
    isHandSwingMode: () => false, recordMeasurementKind: r => r.kind,
    MODEL_CAMERA_DIRECTION_LABELS: { front: 'front', auto: 'auto' },
    MODEL_PIVOT_LABELS: { center: 'center' }, MODEL_CAMERA_DIRECTION_YAW: { front: 0 },
    videoSourceSecondForFrame: (data, f) => f.rawTimeMs / 1000 + (data.sourceStartSec || 0)
});
const names = ['clonePoseSnapshot', 'neutralPoseSnapshot', 'modelPoseSource', 'getRawModelLandmarkPoint',
    'getModelPoseTransform', 'rotateModelPointAroundY', 'getModelLandmarkPoint', 'modelAngleValuesForDisplay',
    'modelMeasurementIsHand', 'modelValueText', 'rateText', 'videoFrameAngleValue', 'setVideoModelSnapshotFromFrame',
    'getModelViewState', 'syncModelViewControls', 'setModelViewPreset', 'setModelViewZoom',
    'beginAngleModelViewDrag', 'handleAngleModelViewPointerMove', 'stopAngleModelViewDrag',
    'setModelSourceMode', 'setModelPlaybackPlaying', 'stopModelPlayback', 'startModelPlayback', 'setModelVideoFrame'];
vm.runInContext(names.map(declaration).join('\n'), context);

async function main() {
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=|type=["'](?:module|application\/)/i.test(match[1])) new vm.Script(match[2]);
    }
    const THREE = await import(pathToFileURL(path.join(root, 'vendor/three/three.module.min.js')));
    const pose = Array.from({ length: 33 }, (_, i) => ({ x: .4 + i / 100, y: .3, z: .02, visibility: .95 }));
    const world = pose.map(p => ({ ...p, x: p.x - .5, y: p.y - .5 }));
    world[12] = { x: -.2, y: -.5, z: .15 };
    world[14] = { x: -.45, y: -.25, z: -.08 };
    world[16] = { x: -.18, y: -.1, z: -.6 };
    const frame = { landmarks: pose, worldLandmarks: world, rightAng: 123, torsoAng: 0, hasuji: null, timeMs: 0, rawTimeMs: 0 };
    state.videoAnalysis = { frames: [frame], startFrame: 0, endFrame: 0 };
    context.setVideoModelSnapshotFromFrame(frame, 0);
    node('analysisVideoElement').videoWidth = 1080;
    node('analysisVideoElement').videoHeight = 1920;
    const source = context.modelPoseSource();
    assert.equal(source.pose.modelSpace, 'world');
    const p = i => context.getRawModelLandmarkPoint(source.pose, i, THREE);
    const originalAngle = new THREE.Vector3().subVectors(new THREE.Vector3(world[12].x, world[12].y, world[12].z), new THREE.Vector3(world[14].x, world[14].y, world[14].z))
        .angleTo(new THREE.Vector3().subVectors(new THREE.Vector3(world[16].x, world[16].y, world[16].z), new THREE.Vector3(world[14].x, world[14].y, world[14].z)));
    assert.ok(Math.abs(p(12).sub(p(14)).angleTo(p(16).sub(p(14))) - originalAngle) < 1e-12, 'world geometry preserves elbow angle');
    assert.equal(context.modelValueText(context.modelAngleValuesForDisplay().torsoAng), '0.0°');
    assert.equal(context.modelValueText(null), '---');
    assert.equal(context.rateText(null), '---');
    assert.ok(Number.isNaN(context.videoFrameAngleValue(frame, 'hasuji')));
    assert.equal(world[12].visibility, undefined, 'no mutation of input');
    frame.worldLandmarks = null;
    const flat = context.modelPoseSource().pose;
    assert.equal(flat.modelSpace, 'image');
    assert.equal(context.getRawModelLandmarkPoint(flat, 12, THREE).z, 0);
    assert.ok(Math.abs(flat.modelAspect - 1080 / 1920) < 1e-12);
    state.records = [{ id: 8, modelPose: pose, modelAngleValues: { rightAng: 175 } }];
    frame.landmarks = null;
    assert.equal(context.modelAngleValuesForDisplay().rightAng, null, 'missing video must not display latest record');
    assert.equal(context.modelPoseSource().pose.modelSpace, 'sample');
    state.modelSourceMode = 'live';
    state.modelPoseSnapshot = pose;
    state.modelAngleValues = { rightAng: 91 };
    assert.equal(context.modelAngleValuesForDisplay().rightAng, 91, 'live never borrows record angles');

    context.setModelViewPreset('side');
    assert.equal(state.modelViewYaw, -Math.PI / 2);
    const event = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, button: 0, preventDefault() {}, currentTarget: { style: {}, setPointerCapture() {} } });
    context.beginAngleModelViewDrag(event(1, 0, 0));
    context.handleAngleModelViewPointerMove(event(1, 30, 10));
    assert.equal(state.modelViewPreset, 'free');
    context.stopAngleModelViewDrag(event(1, 30, 10));
    context.beginAngleModelViewDrag(event(1, 0, 0));
    context.beginAngleModelViewDrag(event(2, 100, 0));
    context.handleAngleModelViewPointerMove(event(2, 150, 0));
    assert.equal(state.modelViewZoom, 1.5, 'pinch zoom');
    context.stopAngleModelViewDrag(event(2, 150, 0));
    const yaw = state.modelViewYaw;
    context.handleAngleModelViewPointerMove(event(1, 0, 0));
    assert.equal(state.modelViewYaw, yaw, 'no rotation jump after pinch release');
    context.stopAngleModelViewDrag(event(1, 0, 0));
    assert.equal(state.modelViewDrag, null);

    state.videoAnalysis = { frames: [{ timeMs: 100, rawTimeMs: 800 }, { timeMs: 104.1667, rawTimeMs: 833.333 }], startFrame: 0, endFrame: 1 };
    context.stopVideoSlowPlayback = () => { state.videoPlaybackGeneration = (state.videoPlaybackGeneration || 0) + 1; state.modelPlaybackPlaying = false; };
    let seek, framesStarted = 0;
    context.syncCorrectionVideoSource = time => { seek = time; };
    context.beginNativeVideoPreviewControl = noop;
    context.startNativePreviewFrameSync = () => framesStarted++;
    node('videoCorrectionElement').play = async () => {};
    node('modelPlayRateSelect').value = '0.5';
    await context.startModelPlayback();
    assert.equal(seek, .8, 'uses source timestamp, not 0.1s physical time');
    assert.equal(framesStarted, 1);
    assert.equal(state.modelPlaybackPlaying, true);
    context.stopModelPlayback();
    assert.equal(state.modelPlaybackPlaying, false);

    const pending = [];
    context.drawVideoAnalysisFrame = () => new Promise(resolve => pending.push(resolve));
    context.drawModelVideoFramePreview = noop;
    context.drawModelAngleTimeline = noop;
    context.syncModelFrameControls = noop;
    context.updateModelAnalysisLabels = noop;
    context.updateVideoVerificationChecklist = noop;
    context.initAngleModelView = async () => null;
    const first = context.setModelVideoFrame(0);
    const second = context.setModelVideoFrame(1);
    pending[1](true);
    assert.equal(await second, true);
    pending[0](true);
    assert.equal(await first, false);
    assert.equal(state.videoModelAngleValues.frameIndex, 1, 'late scrub cannot overwrite newer frame');
    console.log('PASS: model world geometry, missing values, source isolation, view controls, pinch, native clock, seek race and syntax');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
