const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('research/index.html');
const worker = read('sw.js');
const context = { window: {} };
vm.runInNewContext(read('research/demo-data.js'), context);
new vm.Script(read('research/research.js'));
const data = context.window.KENDO_RESEARCH_DEMO;
const { start, peak, end } = data.modes.downswing;
assert.equal(JSON.stringify([start, peak, end]), '[258,308,349]');
assert.ok(Math.abs((data.frames[end].t - data.frames[start].t) - 379.2) < 0.1);
const relative = i => data.frames[i].v / data.frames[peak].v;
for (let i = start; i < start + 4; i++) assert.ok(relative(i) >= 0.03);
for (let i = end; i < end + 7; i++) assert.ok(relative(i) <= 0.025);
assert.ok(relative(start - 1) < 0.03);
assert.ok(relative(end - 1) > 0.025);
assert.equal(data.frames.filter(Boolean).length, end - start + 31);
assert.ok(data.jointIds.every(id => id >= 11), 'no face landmarks in the public demo');
for (const frame of data.frames.filter(Boolean)) {
    assert.equal(Object.keys(frame).sort().join(','), 'elbow,joints,t,tip,torso,v');
}
for (const id of ['overview', 'timing', 'geometry', 'records']) {
    assert.ok(html.includes(`href="#${id}"`));
    assert.ok(html.includes(`id="${id}"`));
}
for (const asset of ['research.css', 'research.js', 'demo-data.js']) {
    assert.ok(html.includes(asset));
    assert.ok(worker.includes(`./research/${asset}`));
}
assert.match(html, /3%以上.*4コマ連続/);
assert.match(html, /2\.5%以下.*7コマ連続/);
assert.match(html, /確認を待つ時間は計測区間に含めない/);
console.log('PASS: research guide assets, navigation, real example thresholds, frame timing and minimal demo payload');
