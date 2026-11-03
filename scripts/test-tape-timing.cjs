const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function loadTimingCore(filename = path.join(__dirname, '..', 'index.html')) {
    const html = fs.readFileSync(filename, 'utf8');
    const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter(([, attrs]) => !/\bsrc=|application\/ld\+json/.test(attrs)).map(([, , code]) => code);
    blocks.forEach(code => new vm.Script(code));
    const script = blocks.find(code => code.includes('function resolveTapeStrikeWindow('));
    function declaration(prefix) {
        const start = script.indexOf(prefix);
        assert.ok(start >= 0, prefix);
        for (let end = script.indexOf('\n', start); end >= 0; end = script.indexOf('\n', end + 1)) {
            const source = script.slice(start, end).trim();
            if (!/[};]$/.test(source)) continue;
            try { new vm.Script(source); return source; } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
            }
        }
        throw new Error(`Incomplete declaration: ${prefix}`);
    }
    const context = vm.createContext({ console, AppState: {}, isHandSwingMode: () => false });
    const names = ['clamp', 'percentile', 'visibilityOf', 'landmarkQuality', 'distance2d',
        'videoSlowMotionFactorForData', 'videoFrameStepMs', 'videoEffectiveTimingFps',
        'normalizeStrikeTimingMode', 'strikeTimingModeOf', 'strikeTimingMinimumMs', 'strikeTimingMaximumMs',
        'videoFormalMinDurationMs', 'videoFormalMaxDurationMs', 'videoStrikeSensitivityProfile',
        'smoothVideoScalarSeries', 'buildTapeTimingSeries', 'videoShoulderWidthRatio',
        'videoTapeYNear', 'videoTapeDescentRatio', 'videoShinaiProgressAngle',
        'refineTapeStrikeWindowByAngle', 'resolveTapeStrikeWindow',
        'resolveVideoStrikeWindow', 'videoPeakProminence', 'isVideoDownwardStrikeCandidate',
        'detectVideoStrikes', 'normalizeVideoStrikeBuckets', 'videoStrikeValidationTarget',
        'validateVideoStrikeSummary', 'hasReliableDirectShinaiTiming', 'maxReasonableSpeedForSource',
        'normalizeMs', 'segmentAverage', 'scoreVideoStrike', 'summarizeVideoStrike', 'buildRejectedVideoStrike',
        'metricsForVideoSource', 'chooseOfficialMetrics', 'chooseOfficialSpeed', 'videoFrameSpeed', 'videoWristScreenY',
        'videoWristDescentRatio', 'dominantShinaiDetectionSource', 'analyzeSwingSamples', 'smoothSavitzkyGolay5', 'distance3d',
        'hsvFromRgb', 'getTapeHue', 'hueDistance', 'detectVideoTapeInCanvas', 'buildWebCodecsFullVideoWindows'];
    vm.runInContext(declaration('const Params = {') + '\nthis.Params = Params;\n' +
        names.map(name => declaration(`function ${name}(`)).join('\n'), context);
    context.declaration = declaration;
    return context;
}

function run() {
    const core = loadTimingCore();
    const makeData = (fps = 240, count = 360) => ({ fps, strikeTimingMode: 'downswing',
        preferredShinaiSource: 'tape', diagnostics: { width: 1000, height: 1000 },
        frames: Array.from({ length: count }, (_, i) => ({ timeMs: i * 1000 / fps,
            landmarks: Array.from({ length: 33 }, (_, j) => ({ x: j === 11 ? 0.3 : 0.5, y: 0.5, visibility: 1 })),
            poseConfidence: 1, tapeConfidence: 1, shinaiSource: 'tape', tapeSpeed: 35,
            tapePoint: { x: 0.5 + i * 0.001, y: 0.3, source: 'tape' } })) });
    const resolve = (data, speeds, peak) => core.resolveTapeStrikeWindow(data, peak, speeds, core.videoStrikeSensitivityProfile());
    const data = makeData();
    const speeds = data.frames.map((_, i) => i >= 100 && i <= 220 ? (i < 180 ? 6 : 10) : 0.01);
    // The vertical crossing at 180 is during the swing, not its beginning.
    data.frames.forEach((f, i) => {
        const angle = (i - 180) * 0.02 - Math.PI / 2;
        f.tapePoint = { x: 0.5 + 0.3 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle), source: 'tape' };
    });
    let result = resolve(data, speeds, 180);
    assert.equal(result.startFrame, 100);
    assert.equal(result.endFrame, 221);
    assert.equal(result.timingIssue, '');
    const decaying = speeds.slice();
    for (let i = 221; i < 270; i++) decaying[i] = 1;
    result = resolve(data, decaying, 180);
    assert.equal(result.endFrame, 270, '10% of peak is not settled');
    const missing = decaying.slice();
    for (let i = 230; i < 245; i++) missing[i] = NaN;
    assert.ok(resolve(data, missing, 180).timingIssue, 'missing samples must not mean stopped');
    const truncated = { ...data, frames: data.frames.slice(0, 260) };
    assert.ok(resolve(truncated, decaying.slice(0, 260), 180).timingIssue, 'unfinished swing needs review');
    const raising = speeds.slice();
    for (let i = 20; i <= 80; i++) raising[i] = 2;
    assert.equal(resolve({ ...data, strikeTimingMode: 'full-motion' }, raising, 180).startFrame, 20);
    assert.equal(resolve(data, raising, 180).startFrame, 100, 'downswing must not merge the raising phase');
    for (const fps of [60, 120, 240]) {
        const d = makeData(fps, fps * 2);
        const values = d.frames.map(f => f.timeMs >= 500 && f.timeMs < 1000 ? 10 : 0.01);
        const r = resolve(d, values, Math.round(fps * 0.75));
        assert.equal(d.frames[r.endFrame].timeMs - d.frames[r.startFrame].timeMs, 500);
    }
    const track = makeData();
    track.frames.forEach((f, i) => { f.tapePoint.x = i * i * 0.0002; });
    let signal = core.buildTapeTimingSeries(track);
    assert.ok(Number.isNaN(signal.speeds[0]));
    assert.ok(signal.speeds[300] > 35, 'timing signal must not be clipped at display speed limit');
    assert.ok(signal.speeds[310] > signal.speeds[300]);
    for (let i = 100; i < 104; i++) track.frames[i].tapePoint = null;
    signal = core.buildTapeTimingSeries(track);
    assert.ok(Number.isFinite(signal.speeds[102]), 'short bounded gap can be interpolated');
    for (let i = 160; i < 180; i++) track.frames[i].tapePoint = null;
    signal = core.buildTapeTimingSeries(track);
    assert.ok(Number.isNaN(signal.speeds[170]), 'long gap remains missing');
    track.frames[220].timeMs = track.frames[219].timeMs;
    assert.ok(Number.isNaN(core.buildTapeTimingSeries(track).speeds[220]), 'duplicate PTS must not create speed');
    const rejected = { timingIssue: 'missing tape', manualAdjusted: false };
    assert.equal(core.validateVideoStrikeSummary(rejected, data).ok, false);
    const buckets = { ...data, strikes: [], rejectedStrikes: [{ ...rejected, startFrame: 100, peakFrame: 180, endFrame: 250, durationMs: 625 }] };
    core.normalizeVideoStrikeBuckets(buckets);
    assert.equal(buckets.strikes.length, 0, 'normalization cannot promote an incomplete automatic interval');
    assert.equal(buckets.rejectedStrikes.length, 1);
    const multi = makeData(240, 720);
    let y = 0.1;
    multi.frames.forEach(f => {
        const phase = ((f.timeMs / 1000 - 0.2) % 0.9 + 0.9) % 0.9;
        const v = phase < 0.5 ? Math.sin(phase / 0.5 * Math.PI) ** 2 : 0;
        y += v * 0.003;
        Object.assign(f, { tapePoint: { x: 0.6, y, source: 'tape' }, rightAng: 130, torsoAng: 5,
            tapePosition: { x: 0.6, y: -y, z: 0 }, tapeSpeed: v * 1.512, viewQuality: 1 });
    });
    core.Params.officialSpeedSource = 'tape';
    const found = core.detectVideoStrikes(multi);
    assert.equal(found.length, 3, 'all three strokes remain separate');
    assert.ok(found.every(s => s.durationMs >= 400 && s.durationMs <= 510));
    assert.ok(found.every(s => s.timingSignalSource === 'tape-displacement'));
    const w = 200, h = 200;
    const image = new Uint8ClampedArray(w * h * 4);
    const box = (x, y, size, color) => {
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) image.set([...color, 255], ((y + dy) * w + x + dx) * 4);
    };
    const ctx = { getImageData: () => ({ data: image }) };
    box(50, 50, 5, [230, 230, 10]);
    box(0, 100, 30, [230, 230, 10]);
    box(120, 40, 6, [230, 20, 10]);
    const hit = core.detectVideoTapeInCanvas(ctx, w, h, null, null, 0);
    assert.equal(hit.x, 52, 'large/background and wrong-color regions are not averaged into the tip');
    box(90, 70, 5, [230, 230, 10]);
    assert.equal(core.detectVideoTapeInCanvas(ctx, w, h, null, null, 10), null, 'ambiguous acquisition is missing, not a guessed tip');
    assert.equal(core.detectVideoTapeInCanvas(ctx, w, h, null, hit, 4.167).x, 52, 'temporal tracking keeps the same component');
    const windows = core.buildWebCodecsFullVideoWindows({ sourceStartSec: 0, sourceEndSec: 20, strikes: [] },
        { frameTable: [{ rawTimeMs: 0 }, { rawTimeMs: 19966.667 }] });
    assert.equal(windows[0].endMs, 19966.667, 'full-frame decode does not depend on coarse candidates');
    const currentHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(!currentHtml.includes('if (webCodecsContext && (AppState.videoAnalysis.strikes.length'), 'coarse detection must not gate full-frame decoding');
    console.log('PASS: tape timing, vertical crossing, settling, gaps, truncation, modes, fps, unclipped signal, duplicate PTS, exclusions, repeated strokes, color tracking, full-frame decode');
}

module.exports = { loadTimingCore };
if (require.main === module) run();
