const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadTimingCore } = require('./test-tape-timing.cjs');
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/build-research-demo.cjs <analysis.json>');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const core = loadTimingCore();
core.Params.officialSpeedSource = 'tape';
vm.runInContext(['calculateJointAngle3d', 'calculateTorsoAxis3d'].map(n => core.declaration(`function ${n}(`)).join('\n'), core);
const modes = {};
for (const mode of ['downswing']) {
    data.strikeTimingMode = mode;
    const strike = core.detectVideoStrikes(data, { timingOnly: true })[0];
    if (!strike) throw new Error(`Missing ${mode} example`);
    modes[mode] = { start: strike.startFrame, peak: strike.peakFrame, end: strike.endFrame };
}
const round = (n, digits = 4) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
const jointIds = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const range = modes.downswing;
const demo = {
    width: data.diagnostics.width, height: data.diagnostics.height, captureFps: data.captureFps,
    modes, jointIds,
    frames: data.frames.slice(0, range.end + 16).map((f, i) => {
        // Preserve source frame numbers while exporting only the displayed motion window.
        if (i < range.start - 15) return null;
        const world = f.worldLandmarks || [];
        return { t: round(f.timeMs, 3), v: round(data.tapeTiming.speeds[i] / data.tapeTiming.speeds[range.peak] * 100),
            joints: jointIds.map(id => f.landmarks?.[id] ? [round(f.landmarks[id].x), round(f.landmarks[id].y)] : null),
            tip: f.tapePoint ? [round(f.tapePoint.x), round(f.tapePoint.y)] : null,
            elbow: round(core.calculateJointAngle3d(world[12], world[14], world[16]) || f.rightAng, 1),
            torso: round(core.calculateTorsoAxis3d(world) ?? f.torsoAng, 1) };
    })
};
fs.writeFileSync(path.join(__dirname, '../research/demo-data.js'), `window.KENDO_RESEARCH_DEMO = ${JSON.stringify(demo)};\n`);
console.log(JSON.stringify({ frames: demo.frames.filter(Boolean).length, modes, bytes: JSON.stringify(demo).length }));
