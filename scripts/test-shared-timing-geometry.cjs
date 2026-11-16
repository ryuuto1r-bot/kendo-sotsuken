const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadTimingCore } = require('./test-tape-timing.cjs');
const core = loadTimingCore();
const functions = ['imagePlaneAspect', 'imagePlaneDistance', 'videoImageAspect', 'getMetricLandmark',
    'metricFromFramePoint', 'stableVideoPixelScale', 'realtimePixelScale', 'calculateJointAngle',
    'calculateJointAngle3d', 'calculateBestJointAngle', 'calculateLineTilt', 'bodyAxisVector',
    'calculateTorsoAxis2d', 'calculateTorsoAxis3d', 'rightArmViewQuality', 'upperBodyVisibility',
    'refreshVideoPoseMetrics', 'confirmedRealtimeTapeStrike', 'usesSharedTapeTiming',
    'appendRealtimeTapeFrame', 'processRealtimeTapeTiming', 'calculateHasuji', 'axisTiltFromVertical',
    'shinaiAxisFromLandmarks', 'angleBetweenVectors2d', 'calculateShinaiHasuji', 'calculateBodyReferencedHasuji',
    'researchAnglesFromLandmarks'];
vm.runInContext(functions.map(name => core.declaration(`function ${name}(`)).join('\n'), core);
core.canvasElement = { width: 1280, height: 720 };
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);
const points = [[300, 200], [400, 300], [500, 200]];
for (const [width, height] of [[1920, 1080], [1080, 1920], [1000, 1000]]) {
    const aspect = height / width;
    const [a, b, c] = points.map(([x, y]) => ({ x: x / width, y: y / height, visibility: 1 }));
    near(core.calculateJointAngle(a, b, c, aspect), 90, '2D angle retains pixel geometry');
    near(core.calculateBestJointAngle(a, b, c, null, null, null, aspect), 90, '2D fallback');
    const world = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }];
    near(core.calculateBestJointAngle(a, b, c, ...world, aspect), 90, '3D is independent of image aspect');
    const lm = Array.from({ length: 33 }, () => ({ x: 400 / width, y: 600 / height, visibility: 1 }));
    lm[11] = { x: 300 / width, y: 300 / height, visibility: 1 };
    lm[12] = { x: 600 / width, y: 400 / height, visibility: 1 };
    lm[14] = b; lm[16] = c;
    const expectedScale = core.Params.referenceShoulderMeters / Math.hypot(300, 100);
    near(core.stableVideoPixelScale([{ landmarks: lm }], width, height), expectedScale, 'shoulder pixel scale');
    core.AppState.realtimePxToMeters = 0;
    core.AppState.realtimeShoulderWidthSamples = [];
    near(core.realtimePixelScale(lm, width, height), expectedScale, 'live shoulder pixel scale');
    const p1 = core.getMetricLandmark(a, null, lm, null, aspect);
    const p2 = core.getMetricLandmark(b, null, lm, null, aspect);
    near(Math.hypot(p1.x - p2.x, p1.y - p2.y), Math.sqrt(20000) * expectedScale, 'fallback metric displacement');
    const f = core.refreshVideoPoseMetrics({ landmarks: lm }, aspect);
    near(f.rightAng, core.calculateJointAngle(lm[12], b, c, aspect), 'decoded frame geometry');
    const summary = core.researchAnglesFromLandmarks(lm, aspect);
    near(summary.rightElbow, f.rightAng, 'research fallback uses the source frame aspect');
    near(summary.torso, core.calculateTorsoAxis2d(lm, aspect), 'research torso fallback');
    near(core.calculateLineTilt(lm[11], lm[12], aspect), Math.atan2(100, 300) * 180 / Math.PI, 'shoulder line');
}
near(core.videoImageAspect({}), 1, 'unknown video dimensions do not inherit the live canvas');

function makeData(fps, width = 1000, height = 1000) {
    let y = 100;
    return { fps, slowMotionFactor: 1, strikeTimingMode: 'downswing', diagnostics: { width, height },
        frames: Array.from({ length: fps * 3 }, (_, i) => {
            const timeMs = i * 1000 / fps;
            const phase = ((timeMs / 1000 - 0.2) % 0.9 + 0.9) % 0.9;
            const v = phase < 0.5 ? Math.sin(phase / 0.5 * Math.PI) ** 2 : 0;
            y += v * 720 / fps;
            const landmarks = Array.from({ length: 33 }, () => ({ x: 400 / width, y: 400 / height, visibility: 1 }));
            landmarks[11] = { x: 300 / width, y: 300 / height, visibility: 1 };
            landmarks[12] = { x: 600 / width, y: 400 / height, visibility: 1 };
            return { timeMs, presentedFrame: i, landmarks, poseConfidence: 1, viewQuality: 1,
                rightAng: 130, torsoAng: 5, tapeConfidence: 1, shinaiSource: 'tape',
                tapePoint: { x: 600 / width, y: y / height, quality: 1, source: 'tape' } };
        }) };
}
core.Params.officialSpeedSource = 'tape';
core.Params.strikeTimingMode = 'downswing';
for (const fps of [30, 60, 120, 240]) {
    const data = makeData(fps);
    const offline = core.detectVideoStrikes(data, { timingOnly: true });
    assert.equal(offline.length, 3, `${fps} fps: three strokes`);
    let lastEnd = -Infinity;
    const live = [];
    for (let n = 16; n <= data.frames.length; n++) {
        const prefix = { ...data, frames: data.frames.slice(0, n) };
        const strike = core.confirmedRealtimeTapeStrike(prefix, lastEnd);
        if (!strike) continue;
        assert.ok(strike.endFrame + 10 < n, 'wait for all seven settled samples and centered filtering');
        live.push(strike);
        lastEnd = data.frames[strike.endFrame].timeMs;
    }
    assert.equal(JSON.stringify(live.map(s => [s.startFrame, s.peakFrame, s.endFrame])),
        JSON.stringify(offline.map(s => [s.startFrame, s.peakFrame, s.endFrame])), `${fps} fps: streaming and offline boundaries`);
    const unfinished = { ...data, frames: data.frames.slice(0, offline[0].endFrame + 6) };
    assert.equal(core.confirmedRealtimeTapeStrike(unfinished), null, 'six low frames cannot finalize');
    const missing = makeData(fps);
    missing.frames.slice(offline[0].peakFrame, offline[0].endFrame + 2).forEach(f => { f.tapePoint = null; });
    assert.ok(!core.detectVideoStrikes(missing, { timingOnly: true }).some(s => s.peakFrame === offline[0].peakFrame),
        'missing detections cannot become zero-speed confirmations');
}
const wide = makeData(240, 1920, 1080), tall = makeData(240, 1080, 1920);
const wideSignal = core.buildTapeTimingSeries(wide), tallSignal = core.buildTapeTimingSeries(tall);
wideSignal.speeds.forEach((v, i) => {
    if (Number.isFinite(v)) near(v, tallSignal.speeds[i], 'speed invariant to image padding/aspect');
});

const saved = [];
Object.assign(core, {
    clonePoseSnapshot: x => x ? x.map(p => ({ ...p })) : null,
    setTimingStatus: () => {}, msLabel: String,
    beginSwing: time => { core.AppState.swingStartTime = time; },
    saveRecord: (...args) => { saved.push(args); return true; }
});
core.canvasElement = { width: 1000, height: 1000 };
Object.assign(core.AppState, { swingState: 'IDLE', frameFps: 60, currentViewQuality: 1, realtimeTapeLastEndMs: -Infinity });
for (const frame of makeData(60).frames) {
    core.AppState.currentPresentedFrame = frame.presentedFrame;
    core.appendRealtimeTapeFrame(frame.timeMs, frame.landmarks, null, frame.tapePoint, { rightAng: 130, torsoAng: 5 });
    core.processRealtimeTapeTiming(frame.timeMs);
}
assert.equal(saved.length, 3, 'live path saves each confirmed strike once');
for (const args of saved) {
    const meta = args[9];
    assert.equal(meta.startConfirmationFrames, 4);
    assert.equal(meta.endConfirmationFrames, 7);
    assert.equal(meta.timingRule, 'tip-peak-3x4-2.5x7-v1');
    near(args[0], Math.round((meta.endTimeMs - meta.startTimeMs) * 10) / 10, 'saved interval excludes confirmation delay');
}
assert.ok(core.AppState.realtimeTapeFrames.length <= 1440);

saved.length = 0;
core.Params.signalMode = true;
Object.assign(core.AppState, { realtimeTapeFrames: makeData(60).frames, realtimeTapeCheckedAt: 0,
    realtimeTapeLastEndMs: -Infinity, signalTime: 1000, swingState: 'SIGNAL_WAIT' });
core.processRealtimeTapeTiming(3000);
assert.equal(saved.length, 0, 'no timing result before the reaction cue');
core.AppState.swingState = 'SIGNAL_GO';
core.processRealtimeTapeTiming(3050);
assert.equal(saved.length, 1);
assert.ok(saved[0][9].startTimeMs > 1000, 'reaction mode excludes a movement before the cue');
const count = saved.length;
core.AppState.swingState = 'ZANSHIN';
core.processRealtimeTapeTiming(3100);
assert.equal(saved.length, count, 'rearm period cannot create duplicate records');
core.Params.signalMode = false;
core.Params.tsukiMode = true;
assert.equal(core.usesSharedTapeTiming(), false, 'thrust keeps its separate timing mode');
core.Params.tsukiMode = false;
core.isHandSwingMode = () => true;
assert.equal(core.usesSharedTapeTiming(), false, 'hand-only mode keeps its own timing source');
core.isHandSwingMode = () => false;
const prior = core.AppState.realtimeTapeFrames.length;
core.appendRealtimeTapeFrame(3000, makeData(60).frames[0].landmarks, null, null);
const after = core.AppState.realtimeTapeFrames.length;
core.appendRealtimeTapeFrame(3000, null, null, null);
assert.equal(core.AppState.realtimeTapeFrames.length, after, 'duplicate camera timestamp is not another frame');
assert.ok(after <= prior + 1);
core.canvasElement.width = 720;
core.appendRealtimeTapeFrame(3020, null, null, null);
assert.equal(core.AppState.realtimeTapeFrames.length, 1, 'dimension changes restart the measurement buffer');
console.log('PASS: 2D aspect, research fallback, world coordinates, shoulder scale, speed, streaming/offline equality, missing/end frames, live metadata, cue gating and mode isolation');
