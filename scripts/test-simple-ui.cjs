const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadTimingCore } = require('./test-tape-timing.cjs');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = loadTimingCore();
const element = (value = '') => ({ dataset: { value }, disabled: false, hidden: false, textContent: '' });
const elements = Object.fromEntries(['videoContextActionText', 'videoContextNextBtn', 'analysisVideoElement',
    'saveVideoRecordBtn', 'videoReportReviewBtn', 'tab-analysis', 'analysisEmptyState', 'analysisEmptyTitle',
    'analysisClearFiltersBtn'].map(id => [id, element()]));
const steps = ['load', 'mark', 'result', 'report'].map(element);
const calls = [];
elements.saveVideoRecordBtn.click = () => calls.push('save');
const context = vm.createContext({
    AppState: {},
    document: { body: { dataset: {} }, getElementById: id => elements[id], querySelectorAll: () => steps },
    safeText: (id, value) => { elements[id].textContent = value; },
    isVideoTimingConfirmed: data => !!data?.confirmed,
    switchVideoStep: step => calls.push(step),
    confirmVideoTimingCorrection: () => { context.AppState.videoAnalysis.confirmed = true; }
});
vm.runInContext(['updateVideoContextAction', 'runVideoContextAction', 'updateRecordEmptyState']
    .map(name => source.declaration(`function ${name}(`)).join('\n'), context);
context.updateVideoContextAction('load');
assert.deepEqual(steps.map(step => step.disabled), [false, true, true, true]);
context.AppState.videoSource = { type: 'file' };
context.updateVideoContextAction('load');
assert.deepEqual(steps.map(step => step.disabled), [false, false, true, true]);
context.AppState.videoAnalysis = { frames: [{}] };
context.updateVideoContextAction('result');
assert.ok(elements.saveVideoRecordBtn.disabled, 'unreviewed data remains protected');
assert.equal(elements.videoReportReviewBtn.hidden, false);
context.runVideoContextAction();
assert.equal(calls.at(-1), 'correct', 'results lead to review before saving');
context.updateVideoContextAction('correct');
context.runVideoContextAction();
assert.equal(calls.at(-1), 'report', 'confirmation leads to save');
context.updateVideoContextAction('report');
assert.equal(elements.saveVideoRecordBtn.disabled, false);
assert.equal(elements.videoReportReviewBtn.hidden, true);
context.runVideoContextAction();
assert.equal(calls.at(-1), 'save');
context.AppState.videoAnalysisBusy = true;
context.updateVideoContextAction('result');
assert.ok(steps.every(step => step.disabled));
assert.ok(elements.videoContextNextBtn.disabled);
context.AppState.records = [];
context.updateRecordEmptyState('analysis', []);
assert.equal(elements['tab-analysis'].dataset.empty, 'true');
assert.equal(elements['tab-analysis'].dataset.hasRecords, 'false');
assert.equal(elements.analysisClearFiltersBtn.hidden, true);
context.AppState.records = [{ id: 1 }];
context.updateRecordEmptyState('analysis', []);
assert.equal(elements.analysisClearFiltersBtn.hidden, false, 'filters have an escape from empty results');
context.updateRecordEmptyState('analysis', context.AppState.records);
assert.equal(elements.analysisEmptyState.hidden, true);
assert.equal(elements['tab-analysis'].dataset.empty, 'false');
assert.equal((html.match(/analyze: 'mark', correct: 'result'/g) || []).length, 2, 'bootstrap and app stage maps agree');
assert.match(html, /else \{\s+switchVideoStep\('result'\);\s+\}\s+setVideoAnalysisProgress\(100/);
assert.match(html, /isCameraRunning \? tone : 'idle'/);
assert.match(html, /'export-research-excel': \(\) => exportResearchExcel\(\)/);
assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /ui-simple\.css\?v=20261116/);
console.log('PASS: workflow gates, confirmation before save, empty/filter states, neutral camera state and offline UI assets');
