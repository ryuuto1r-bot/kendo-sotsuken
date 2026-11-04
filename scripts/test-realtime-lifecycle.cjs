const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function declaration(name) {
    const start = html.search(new RegExp(`^        (?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n        }', start) + 10);
}
const noop = () => {};
let now = 1000;
let nextId = 0;
const callbacks = new Map();
const canceled = [];
const nodes = new Map();
const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop });
    return nodes.get(id);
};
const state = {
    cameraSession: 1, realtimeEpoch: 0, frameLoopRunning: true, isCameraRunning: true,
    cameraFrameCallbackId: null, cameraLastMediaTime: NaN, cameraFrameCount: 0,
    frameTimestampSource: '', lastCameraTimestampMs: NaN, frameTimestampFallbacks: 0,
    cameraFrameTimes: [], aiFrameTimes: [], records: [], replayFrames: [],
    currentPoseSnapshot: [{ x: 1 }], currentViewQuality: 1, currentWristVisibility: 1,
    currentAngleQuality: 1, swingState: 'SWINGING'
};
const video = {
    readyState: 4, currentTime: 0, videoWidth: 640, videoHeight: 480,
    requestVideoFrameCallback: cb => { const id = ++nextId; callbacks.set(id, cb); return id; },
    cancelVideoFrameCallback: id => { canceled.push(id); callbacks.delete(id); },
    pause: noop
};
const context = vm.createContext({
    AppState: state, Params: { targetFps: 60, cameraStableFps: 60, cameraMaxFps: 60, realtimeRecordCooldownMs: 100 },
    videoElement: video, canvasElement: { width: 640, height: 480 }, canvasCtx: { clearRect: noop, save: noop, restore: noop },
    camera: null, document: { hidden: false, getElementById: node },
    navigator: { mediaDevices: {} }, performance: { now: () => now }, DOMException, console,
    setTimeout: cb => { const id = ++nextId; callbacks.set(id, cb); return id; },
    clearTimeout: id => callbacks.delete(id), clearInterval: id => callbacks.delete(id), cancelAnimationFrame: noop,
    safeText: noop, showToast: noop, safeStorageSet: noop, setStrikeTimingMode: noop,
    ensureReactionAudioReady: async () => ({}), updateRealtimeMeasurementModeUi: noop, updatePrecisionPanel: noop,
    resetReactionTrialClock: noop, updateStateUI: noop, updateReactionTrainingUi: noop, setTimingStatus: noop,
    drawCameraFrameOnly: noop, drawCanvasVideoBackground: noop, trackRealtimeShinaiDetection: noop,
    withTimeout: p => p, cameraDefaultFacingMode: () => 'user',
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    isHandSwingMode: () => false, researchRecordMetadata: () => ({}), handSwingSourceLabel: () => 'sword',
    normalizeMs: v => v ?? null, clonePoseSnapshot: v => v, recordPeakOffsetText: () => '',
    reactionMsLabel: () => '', buildResearchAngleSummary: () => ({}), buildReplayClipMeta: () => ({}),
    chooseOfficialSpeed: () => ({ key: 'tape' }), buildRealtimeValidationSnapshot: () => ({}),
    setRecordFilterMode: noop, persistRecords: noop, updateHistoryTable: noop, updateDetailsTab: noop,
    updateRealtimePracticeSummary: noop, updateDataCenter: noop, prepareReplay: noop,
    strikeTimingModeLabel: () => 'full', strikeTimingModeOf: () => 'full', strikeTimingModeDefinition: () => 'full',
    recordTypeLabel: () => 'realtime', recordMeasurementLabel: () => 'sword', formatRecordDate: () => '', recordPeakOffsetMs: () => 0
});
const names = ['resetSwingStartCandidate', 'resetSwingEndCandidate', 'resetFullMotionStart', 'resetWristMotionBaseline',
    'resetSwingTracking', 'resetRealtimeTracking', 'isCurrentLivePoseRequest', 'updateCameraControls', 'cancelCameraFrame',
    'stopCameraStream', 'stopMicrophone', 'initMicrophone', 'checkCameraHealth', 'scheduleVideoFrame', 'processVideoFrame', 'getFrameTimestampMs', 'trackRollingFrameTime',
    'requestCameraStreamWithFallback', 'cameraFrameRateConstraint', 'buildCameraVideoConstraints', 'nextRecordId',
    'toFiniteOrNull', 'cloneModelTapePoint', 'reactionMsLabel', 'setReactionTrainingMode', 'scheduleRealtimeRearm', 'saveRecord', 'csvCell', 'buildRecordsCsv', 'onResults', 'visibilityOf'];
vm.runInContext(names.map(declaration).join('\n'), context);

async function main() {
    let release;
    let inferences = 0;
    context.runPoseFrame = async (_time, request) => {
        inferences++;
        assert.ok(context.isCurrentLivePoseRequest(request));
        await new Promise(resolve => { release = resolve; });
    };
    context.scheduleVideoFrame();
    const callback = callbacks.get(state.cameraFrameCallbackId);
    const id = state.cameraFrameCallbackId;
    context.scheduleVideoFrame();
    assert.equal(state.cameraFrameCallbackId, id, 'one callback chain');
    const first = context.processVideoFrame(1000, { mediaTime: 1, presentedFrames: 30 });
    const request = state.livePoseRequest;
    await context.processVideoFrame(1020, { mediaTime: 1, presentedFrames: 30 });
    assert.equal(state.cameraFrameCount, 1, 'RAF duplicate does not inflate FPS or manufacture time');
    await context.processVideoFrame(1033, { mediaTime: 1.033, presentedFrames: 31 });
    assert.equal(state.cameraFrameCount, 2);
    assert.equal(inferences, 1, 'inferences never overlap');
    assert.equal(request.presentedFrame, 30, 'pending inference retains its own frame number');
    assert.equal(request.performanceMs, 1000, 'pending inference retains its own clock');
    assert.equal(state.cameraFrameClock.performanceMs, 1033, 'camera clock can advance independently');

    let stopped = 0;
    state.videoStream = { getTracks: () => [{ stop: () => stopped++ }] };
    state.zanshinTimer = nextId + 100;
    state.records = [{ id: 9, timeMs: 300 }];
    context.stopCameraStream();
    assert.equal(stopped, 1);
    assert.ok(canceled.includes(id));
    assert.equal(context.isCurrentLivePoseRequest(request), false, 'late results are invalid after stop');
    assert.equal(state.swingState, 'IDLE');
    assert.equal(state.swingStartTime, 0);
    assert.equal(state.currentPoseSnapshot, null);
    assert.equal(state.modelTapePointSnapshot, null, 'stop clears tape snapshot with pose');
    assert.equal(state.currentWristVisibility, 0);
    assert.equal(state.records[0].timeMs, 300, 'stop preserves records');
    assert.equal(state.zanshinTimer, null);
    assert.equal(video.srcObject, null);
    const count = state.cameraFrameCount;
    state.frameLoopRunning = true;
    state.isCameraRunning = true;
    callback(1066, { mediaTime: 1.066, presentedFrames: 32 });
    assert.equal(state.cameraFrameCount, count, 'cancelled callback cannot revive after restart');
    release();
    await first;
    assert.equal(state.processingFrame, false);

    state.livePoseRequest = { session: state.cameraSession, epoch: state.realtimeEpoch };
    assert.equal(context.isCurrentLivePoseRequest(state.livePoseRequest), true);
    const oldRequest = state.livePoseRequest;
    context.resetRealtimeTracking();
    assert.equal(context.isCurrentLivePoseRequest(oldRequest), false, 'mirror/mode resets invalidate pending inference');
    state.swingState = 'SWINGING';
    const epoch = state.realtimeEpoch;
    await context.setReactionTrainingMode(true, { persist: false, notify: false });
    assert.equal(state.swingState, 'IDLE', 'changing measurement mode abandons an incomplete stroke');
    assert.ok(state.realtimeEpoch > epoch);
    context.Params.signalMode = false;

    Object.assign(state, { swingState: 'SWINGING', currentPoseSnapshot: [{ x: 1 }], lastFrameTimeMs: 1000 });
    state.livePoseRequest = { session: state.cameraSession, epoch: state.realtimeEpoch, frameTimeMs: 1033, performanceMs: now, presentedFrame: 31 };
    context.onResults({ liveRequest: state.livePoseRequest, poseLandmarks: null });
    assert.equal(state.swingState, 'IDLE', 'lost person aborts incomplete stroke');
    assert.equal(state.currentPoseSnapshot, null, 'no stale pose after person loss');
    const beforeLate = state.lastPoseResultAt;
    now += 100;
    context.onResults({ liveRequest: oldRequest });
    assert.equal(state.lastPoseResultAt, beforeLate, 'stale pose callback cannot refresh readiness');

    Object.assign(state, { lastLiveFrameAt: 1000, cameraHealthCheckedAt: 1000, cameraStallSince: 0 });
    context.checkCameraHealth(state.cameraSession, 6000);
    assert.equal(state.isCameraRunning, true, 'delayed main-thread timer is not a camera disconnect');
    context.checkCameraHealth(state.cameraSession, 6500);
    assert.equal(state.isCameraRunning, true, 'stalled camera must be confirmed on a later check');
    context.checkCameraHealth(state.cameraSession, 7000);
    assert.equal(state.isCameraRunning, false, 'persistent stalled camera stops safely');

    let requests = 0;
    context.navigator.mediaDevices.getUserMedia = async () => { requests++; throw new DOMException('denied', 'NotAllowedError'); };
    await assert.rejects(context.requestCameraStreamWithFallback({ video: true }), { name: 'NotAllowedError' });
    assert.equal(requests, 1, 'permission denial must not loop through multiple requests');
    let fulfill;
    context.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { fulfill = resolve; });
    const pending = context.requestCameraStreamWithFallback({ video: true });
    state.cameraSession++;
    let lateStopped = false;
    fulfill({ getTracks: () => [{ stop: () => { lateStopped = true; } }] });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(lateStopped, 'late permission success releases the camera');
    state.selectedCameraId = 'selected';
    context.navigator.mediaDevices.getUserMedia = async constraints => {
        assert.equal(constraints.video.deviceId.exact, 'selected', 'fallback must not select a different camera');
        throw new DOMException('constraints', 'OverconstrainedError');
    };
    const warn = console.warn;
    console.warn = noop;
    try { await assert.rejects(context.requestCameraStreamWithFallback({ video: { deviceId: { exact: 'selected' } } })); }
    finally { console.warn = warn; }

    let fulfillMic;
    let lateMicStopped = false;
    state.enableMic = true;
    state.audioContext = { state: 'running' };
    context.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { fulfillMic = resolve; });
    const microphone = context.initMicrophone();
    context.stopMicrophone();
    fulfillMic({ getTracks: () => [{ stop: () => { lateMicStopped = true; } }] });
    assert.equal(await microphone, false);
    assert.equal(state.enableMic, false);
    assert.equal(state.micStream, null);
    assert.ok(lateMicStopped, 'late microphone permission does not reopen recording');
    assert.equal(state.audioContext.state, 'running', 'stopping microphone does not close cue audio output');

    Object.assign(state, { records: [{ id: 1 }, { id: 3 }], replayFrames: [], swingAngleSamples: [], lastRealtimeRecordAt: 0,
        isCameraRunning: true, frameLoopRunning: true,
        modelTapePointSnapshot: { x: .7, y: .2, quality: .9, source: 'tape' } });
    for (let i = 0; i < 3; i++) {
        now += 1000;
        assert.equal(context.saveRecord(300, 0, 0, null, '', 0, 0, 0, 0), true);
        const rearm = callbacks.get(state.zanshinTimer);
        rearm();
        assert.equal(state.swingState, 'IDLE');
    }
    assert.deepEqual(state.records.map(r => r.id), [1, 3, 4, 5, 6], 'deletion gaps do not duplicate record IDs');
    const last = state.records.at(-1);
    assert.equal(last.modelTapePoint.x, .7, 'live record keeps normalized tape snapshot');
    state.modelTapePointSnapshot.x = .3;
    assert.equal(last.modelTapePoint.x, .7, 'next detection cannot mutate saved tape');
    assert.equal(last.hasujiAngle, '', 'missing blade angle is not 0 degrees');
    assert.equal(last.rightAng, '', 'missing elbow angle is not 0 degrees');
    assert.equal(last.torsoAng, 0, 'real zero remains zero');
    now += 1000;
    context.Params.signalMode = true;
    Object.assign(state, { currentReactionTimeMs: null, signalTime: 0, signalPerformanceTimeMs: 0 });
    context.saveRecord(300, 0, 0, null, null, null, 0, 0, 0, { endTimeMs: 2000 });
    assert.equal(state.records.at(-1).reactionTimeMs, null, 'unmeasured reaction is not zero milliseconds');
    assert.equal(state.records.at(-1).totalResponseTimeMs, null, 'no cue means no total response time');
    assert.equal(context.reactionMsLabel(null), '---');
    assert.equal(context.reactionMsLabel(0), '0 ms');
    context.Params.signalMode = false;
    const rearmId = state.zanshinTimer;
    context.scheduleRealtimeRearm();
    const staleRearm = callbacks.get(state.zanshinTimer);
    state.cameraSession++;
    state.swingState = 'SWINGING';
    staleRearm();
    assert.equal(state.swingState, 'SWINGING', 'old rearm cannot reset a new session');
    assert.notEqual(rearmId, state.zanshinTimer);

    const csv = context.buildRecordsCsv([{ id: 1, torsoAng: 0, startFrameIndex: 0, startTimeMs: 0,
        memo: 'A,"quoted"\nB#2', timingDefinition: 'start,end', rightAng: null }]);
    assert.ok(csv.includes('"A,""quoted""\nB#2"'));
    assert.ok(csv.includes('"start,end"'));
    assert.equal(csv.includes('undefined'), false);
    assert.equal(csv.includes('null'), false);
    assert.ok(!html.includes('id: AppState.records.length + 1'));
    console.log('PASS: camera stop/restart, callback ownership, duplicate frames, inference snapshots, camera/microphone permission cancellation, chosen camera, repeated records, missing angles, CSV escaping');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
