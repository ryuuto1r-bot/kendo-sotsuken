const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function declaration(name) {
    const start = html.search(new RegExp(`^        (?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const end = html.indexOf('\n        }', start) + '\n        }'.length;
    return html.slice(start, end);
}
const callbacks = new Map();
let callbackId = 0;
const draws = [], selected = [];
const frames = Array.from({ length: 10 }, (_, i) => ({ rawTimeMs: i * 1000 / 30, timeMs: i * 1000 / 240 }));
const video = {
    paused: false, ended: false, seeking: false, currentTime: 5.25,
    _kendoPreviewUserControlled: true,
    requestVideoFrameCallback(fn) { const id = ++callbackId; callbacks.set(id, fn); return id; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); },
    pause() { this.paused = true; }
};
const elements = {
    videoCorrectionElement: video,
    videoResultElement: { paused: true, pause() {} },
    videoEditorLoopToggle: { checked: false },
    videoFrameSlider: { value: '0' },
    videoEditorZoomToggle: { checked: true },
    'videoStep-correct': { classList: { contains: () => true } }
};
const ctx = vm.createContext({
    AppState: { videoAnalysis: { frames, sourceStartSec: 5 }, videoDrawToken: 0, videoSlowPlaying: true },
    document: { getElementById: id => elements[id] },
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    videoRawMsFromFrame: f => f.rawTimeMs,
    videoSourceSecondForFrame: (d, f) => d.sourceStartSec + f.rawTimeMs / 1000,
    drawVideoAnalysisFrame: (...args) => draws.push(args),
    setVideoAnalysisFrame: index => selected.push(index),
    setVideoSlowButtonsPlaying: () => {}, clearTimeout,
    currentVideoStrikeDetailRange: () => ({ start: 2, end: 8 })
});
vm.runInContext(['videoFrameIndexFromSourceSecond', 'syncVideoPreviewTimeToAnalysis', 'cancelNativePreviewFrameSync',
    'beginNativeVideoPreviewControl', 'startNativePreviewFrameSync', 'stopVideoSlowPlayback', 'activeVideoFrameBounds'].map(declaration).join('\n'), ctx);
assert.equal(ctx.videoFrameIndexFromSourceSecond(5.1), 3, 'slow-motion file PTS, not physical time, selects the video frame');
assert.equal(ctx.videoFrameIndexFromSourceSecond(5.299), 9);
assert.equal(ctx.videoFrameIndexFromSourceSecond(4), 0);
ctx.AppState.videoAnalysis.frames = [{ rawTimeMs: 0 }, { rawTimeMs: 10 }, { rawTimeMs: 55 }, { rawTimeMs: 95 }];
assert.equal(ctx.videoFrameIndexFromSourceSecond(5.052), 2, 'variable PTS uses nearest actual frame');
ctx.AppState.videoAnalysis.frames = frames;
ctx.syncVideoPreviewTimeToAnalysis(video, 5.1);
assert.equal(draws.at(-1)[0], 3, 'presented mediaTime wins over a newer currentTime');
video.seeking = true;
ctx.syncVideoPreviewTimeToAnalysis(video, 5.2);
assert.equal(draws.length, 1, 'do not render during a seek');
video.seeking = false;
video._kendoPlaybackRange = { start: 2, end: 8 };
ctx.startNativePreviewFrameSync(video);
ctx.startNativePreviewFrameSync(video);
assert.equal(callbacks.size, 1, 'one frame callback chain per video');
function tick(time) {
    const [id, fn] = callbacks.entries().next().value;
    callbacks.delete(id);
    fn(0, { mediaTime: time });
}
tick(5.2);
assert.equal(draws.at(-1)[0], 6);
assert.equal(callbacks.size, 1);
tick(5.266667);
assert.equal(selected.at(-1), 8, 'stop on the selected end frame');
assert.equal(video.paused, true);
assert.equal(ctx.AppState.videoSlowPlaying, false);
assert.equal(callbacks.size, 0);
video.paused = false;
video._kendoPreviewUserControlled = true;
video._kendoPlaybackRange = { start: 2, end: 8 };
elements.videoEditorLoopToggle.checked = true;
ctx.startNativePreviewFrameSync(video);
tick(5.266667);
assert.equal(video.currentTime, 5 + 2 / 30, 'loop explicitly restarts at the source PTS');
const stale = callbacks.values().next().value;
ctx.stopVideoSlowPlayback();
const count = draws.length;
stale(0, { mediaTime: 5.1 });
assert.equal(draws.length, count, 'a canceled callback cannot paint a later pause/seek');
assert.equal(callbacks.size, 0);
assert.deepEqual(JSON.parse(JSON.stringify(ctx.activeVideoFrameBounds())), { min: 2, max: 8 });
elements.videoEditorZoomToggle.checked = false;
assert.deepEqual(JSON.parse(JSON.stringify(ctx.activeVideoFrameBounds())), { min: 0, max: 9 }, 'whole-video editing remains available');
const editorHtml = html.slice(html.indexOf('<div id="videoStep-correct"'), html.indexOf('<div id="videoStep-report"'));
assert.equal((editorHtml.match(/id="videoCorrectionDockPlayBtn"/g) || []).length, 1);
for (const id of ['videoSkeletonToggle', 'videoAngleOverlayToggle', 'videoShinaiOverlayToggle', 'videoHasujiOverlayToggle', 'videoCorrectionSupportDetails']) {
    assert.ok(editorHtml.includes(`id="${id}"`), id);
}
const confirmData = { frames, startFrame: 2, endFrame: 8, strikes: [{ manualAdjusted: false }] };
const confirmOrder = [];
const confirmContext = vm.createContext({
    AppState: { videoAnalysis: confirmData },
    showToast() {}, document: { getElementById: () => ({ classList: { contains: () => true } }) },
    markVideoTimingManual(d) { d.manualTimingConfirmed = true; confirmOrder.push('confirm'); },
    recomputeVideoAnalysisResult() { confirmData.peakFrame = 5; confirmOrder.push('recompute'); },
    updateSelectedVideoStrikeFromCurrent() {
        confirmData.strikes[0].manualAdjusted = true;
        confirmData.strikes[0].peakFrame = confirmData.peakFrame;
        confirmOrder.push('strike');
    },
    syncVideoAnalysisSliders() {}, setVideoAnalysisFrame() {}
});
vm.runInContext(declaration('confirmVideoTimingCorrection'), confirmContext);
confirmContext.confirmVideoTimingCorrection();
assert.deepEqual(confirmOrder, ['confirm', 'recompute', 'strike']);
assert.equal(confirmData.strikes[0].manualAdjusted, true, 'confirm without moving a marker enables saving selected strike');
assert.equal(confirmData.strikes[0].peakFrame, 5, 'selected strike keeps recomputed peak');
assert.equal(confirmData.startFrame, 2); assert.equal(confirmData.endFrame, 8);
console.log('PASS: native playback PTS, stop/loop, stale callbacks, whole-video navigation, overlay controls, unchanged-range confirmation');
