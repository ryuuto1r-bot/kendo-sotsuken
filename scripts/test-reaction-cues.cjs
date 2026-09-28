const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=|application\/ld\+json/.test(attrs)).map(([, , code]) => code);
function declaration(name) {
    const source = blocks.find(code => code.includes(`function ${name}(`));
    assert.ok(source, name);
    const start = source.search(new RegExp(`^        (?:async )?function ${name}\\(`, 'm'));
    const end = source.indexOf('\n        }', start) + '\n        }'.length;
    return source.slice(start, end);
}

function fixture(initialAudioState = 'running') {
    let now = 1000;
    let sequence = 0;
    const timers = new Map();
    const audioNodes = [];
    const flashClasses = new Set();
    const flash = {
        classList: { add: key => flashClasses.add(key), remove: key => flashClasses.delete(key) },
        label: { textContent: '' }, querySelector() { return this.label; }
    };
    const state = {
        reactionSignalGeneration: 0, reactionCue: null, reactionAudioBlocked: false,
        reactionSoundTesting: false, swingState: 'IDLE', signalTime: 0,
        reactionIdleSinceMs: null, reactionIdleLastFrameMs: null, reactionIdleAnchorY: null,
        currentWristVisibility: 0.95, currentViewQuality: 0.95,
        currentFrameTimeMs: 100, currentFramePerformanceMs: 1000
    };
    class AudioContext {
        constructor() {
            this.state = initialAudioState;
            this.currentTime = 5;
            this.outputLatency = 0.015;
            this.destination = {};
            this.resumeCount = 0;
            this.listeners = [];
        }
        addEventListener(name, callback) { this.listeners.push(callback); }
        async resume() { this.resumeCount++; this.state = 'running'; }
        createOscillator() {
            const node = {
                frequency: { setValueAtTime() {} }, starts: [], stops: [],
                connect() {}, disconnect() {},
                start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); }
            };
            audioNodes.push(node);
            return node;
        }
        createGain() {
            const values = [];
            return { values, connect() {}, disconnect() {}, gain: {
                setValueAtTime: (value, time) => values.push([value, time]),
                exponentialRampToValueAtTime: (value, time) => values.push([value, time])
            } };
        }
        interrupt() { this.state = 'interrupted'; this.listeners.forEach(callback => callback()); }
    }
    const context = vm.createContext({
        AppState: state, Params: {
            signalMode: true, minViewQuality: 0.42, reactionStillDurationMs: 700,
            reactionDelayMinMs: 1500, reactionDelayMaxMs: 1500
        },
        window: { AudioContext }, document: { hidden: false, getElementById: id => id === 'flashOverlay' ? flash : null },
        performance: { now: () => now },
        setTimeout: (callback, delay = 0) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id), console,
        resetFullMotionStart() {}, resetSwingStartCandidate() {}, resetSwingEndCandidate() {}, updateStateUI() {},
        updateReactionTrainingUi: text => { state.status = text; }, updateRealtimeMeasurementModeUi() {},
        showToast: (text, color) => { state.toast = { text, color }; }
    });
    const names = ['ensureReactionAudioReady', 'cancelReactionCue', 'pauseReactionTrial', 'frameClockAtPerformanceTime',
        'playBeep', 'resetReactionTrialClock', 'testReactionSound', 'issueReactionSignal', 'updateReactionIdle', 'withTimeout'];
    vm.runInContext(names.map(declaration).join('\n'), context);
    async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
    async function advance(ms) {
        await flush();
        const target = now + ms;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            const [id, timer] = next;
            now = timer.at; timers.delete(id); timer.callback(); await flush();
        }
        now = target; await flush();
    }
    return { context, state, audioNodes, flashClasses, flash, timers, advance, flush };
}

async function main() {
    for (const initial of ['suspended', 'interrupted']) {
        const test = fixture(initial);
        const ctx = await test.context.ensureReactionAudioReady();
        assert.equal(ctx.resumeCount, 1, `${initial} must resume`);
        assert.equal(ctx.state, 'running');
        assert.equal(test.state.reactionAudioBlocked, false);
    }

    {
        const test = fixture();
        const result = test.context.testReactionSound();
        await test.advance(51);
        assert.equal(test.audioNodes.length, 1);
        assert.equal(test.flashClasses.has('flash-signal'), true, 'test cue is visible before camera starts');
        assert.equal(test.flash.label.textContent, '合図テスト');
        assert.equal(test.state.signalTime, 0, 'sound test is not a measurement');
        assert.equal(test.state.reactionSoundTesting, true);
        await test.advance(650);
        assert.equal(await result, true);
        assert.equal(test.flashClasses.size, 0);
        assert.equal(test.state.reactionSoundTesting, false);
    }

    {
        const test = fixture();
        test.state.isCameraRunning = true;
        test.state.swingState = 'SIGNAL_WAIT';
        test.state.signalTimer = test.context.setTimeout(() => { throw new Error('stale trial fired'); }, 200);
        const result = test.context.testReactionSound();
        await test.advance(710);
        assert.equal(await result, true, 'live recovery button works');
        assert.equal(test.state.swingState, 'IDLE');
        assert.equal(test.state.signalTime, 0);
    }

    {
        const test = fixture('interrupted');
        const ctx = new test.context.window.AudioContext();
        ctx.resume = async () => {};
        test.state.audioContext = ctx;
        test.state.swingState = 'SIGNAL_WAIT';
        assert.equal(await test.context.issueReactionSignal(), false);
        assert.equal(test.state.reactionAudioBlocked, true);
        assert.equal(test.state.signalTime, 0);
        assert.equal(test.state.swingState, 'IDLE');
        assert.equal(test.audioNodes.length, 0, 'silent context must not start a trial');
    }

    {
        const test = fixture('suspended');
        const ctx = new test.context.window.AudioContext();
        ctx.resume = () => new Promise(() => {});
        test.state.audioContext = ctx;
        const result = test.context.testReactionSound();
        await test.advance(2001);
        assert.equal(await result, false, 'audio permission cannot hang the button');
        assert.equal(test.state.reactionSoundTesting, false);
        assert.equal(test.state.reactionAudioBlocked, true);
    }

    {
        const test = fixture();
        test.state.swingState = 'SIGNAL_WAIT';
        await test.context.issueReactionSignal();
        test.context.resetReactionTrialClock();
        await test.advance(800);
        assert.equal(test.state.signalTime, 0, 'cancelled cue cannot start measurement');
        assert.equal(test.flashClasses.size, 0);
        assert.ok(test.audioNodes[0].stops.includes(undefined), 'scheduled audio was cancelled');
    }

    {
        const test = fixture();
        test.state.swingState = 'SIGNAL_WAIT';
        await test.context.issueReactionSignal();
        await test.advance(51);
        assert.equal(test.state.swingState, 'SIGNAL_GO');
        assert.equal(test.flashClasses.has('flash-signal'), true);
        assert.ok(Math.abs(test.state.signalTime - 150) < 1e-6, 'audio and camera clocks align at the scheduled onset');
        test.state.audioContext.interrupt();
        assert.equal(test.state.signalTime, 0);
        assert.equal(test.state.swingState, 'IDLE');
        assert.equal(test.flashClasses.size, 0);
    }

    {
        const test = fixture('suspended');
        const ctx = new test.context.window.AudioContext();
        let resume;
        ctx.resume = () => new Promise(resolve => { resume = resolve; });
        test.state.audioContext = ctx;
        test.state.swingState = 'SIGNAL_WAIT';
        const result = test.context.issueReactionSignal();
        test.context.resetReactionTrialClock();
        ctx.state = 'running'; resume();
        assert.equal(await result, false);
        assert.equal(test.audioNodes.length, 0, 'mode changes cancel in-flight audio initialization');
    }

    for (const fps of [10, 24, 30, 60]) {
        const test = fixture();
        await test.context.ensureReactionAudioReady();
        for (let frame = 0; frame < fps; frame++) {
            test.context.updateReactionIdle(frame * 1000 / fps, 0.6 + (frame % 2) * 0.002, 0.002);
            if (test.state.swingState === 'SIGNAL_WAIT') break;
        }
        assert.equal(test.state.swingState, 'SIGNAL_WAIT', `stillness is time-based at ${fps}fps`);
        assert.equal(test.state.signalTime, 0, 'waiting does not count as signal onset');
        await test.advance(1551);
        assert.equal(test.state.swingState, 'SIGNAL_GO', 'automatic wait timer produces a real cue');
    }

    {
        const test = fixture();
        await test.context.ensureReactionAudioReady();
        test.context.updateReactionIdle(0, 0.6, 0);
        test.context.updateReactionIdle(1000, 0.6, 0);
        assert.equal(test.state.swingState, 'IDLE', 'tracking gaps do not count as stillness');
        test.state.reactionAudioBlocked = true;
        for (let time = 1100; time < 2500; time += 100) test.context.updateReactionIdle(time, 0.6, 0);
        assert.equal(test.state.swingState, 'IDLE', 'interrupted audio requires explicit reactivation');
    }
    assert.match(html, /#flashOverlay \{[\s\S]*?z-index: 60/);
    assert.match(html, /id="reactionLiveSoundTestBtn"/);
    console.log('PASS: audio resume/timeout, live sound test, visible cue, cancellation, interruption, FPS-independent arming');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
