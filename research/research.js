(() => {
    'use strict';
    const data = window.KENDO_RESEARCH_DEMO;
    if (!data?.frames?.length) return;
    const range = data.modes.downswing;
    const colors = { ink: '#202b30', muted: '#596b73', line: '#d8e1e5', blue: '#087fa2', green: '#16856c', red: '#bd4050' };
    const slider = document.getElementById('frameSlider');
    const play = document.getElementById('playButton');
    let frameIndex = range.peak, playing = false, request = 0, startedAt = 0, startedFrame = 0;
    slider.min = range.start;
    slider.max = range.end;
    slider.value = frameIndex;
    const relativeSpeed = i => data.frames[i]?.v === null ? NaN : data.frames[i]?.v / data.frames[range.peak].v * 100;

    function surface(id) {
        const canvas = document.getElementById(id);
        if (!canvas || !canvas.getBoundingClientRect().width) return null;
        const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.font = '12px -apple-system, sans-serif';
        ctx.lineCap = 'round';
        return { ctx, width, height, canvas };
    }
    function line(ctx, a, b, color, width = 2) {
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    function dot(ctx, p, color, radius = 4) {
        ctx.beginPath(); ctx.arc(...p, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    }
    function text(ctx, label, x, y, color = colors.muted, align = 'left') {
        ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(label, x, y);
    }
    function drawPose() {
        const s = surface('poseCanvas'); if (!s) return;
        const { ctx, width, height, canvas } = s;
        const f = data.frames[frameIndex];
        const scale = Math.min((width - 38) / data.width, (height - 42) / data.height);
        const x0 = (width - data.width * scale) / 2, y0 = (height - data.height * scale) / 2;
        const xy = p => [x0 + p[0] * data.width * scale, y0 + p[1] * data.height * scale];
        const joints = Object.fromEntries(data.jointIds.map((id, i) => [id, f.joints[i]]));
        for (const [a, b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]]) {
            if (joints[a] && joints[b]) line(ctx, xy(joints[a]), xy(joints[b]), '#7e919b', 3);
        }
        for (const p of Object.values(joints)) if (p) dot(ctx, xy(p), '#566f7a', 3);
        const head = joints[11] && joints[12] ? [(joints[11][0] + joints[12][0]) / 2, (joints[11][1] + joints[12][1]) / 2 - 0.065] : null;
        if (head) { ctx.beginPath(); ctx.arc(...xy(head), 12, 0, Math.PI * 2); ctx.strokeStyle = '#7e919b'; ctx.lineWidth = 3; ctx.stroke(); }
        for (let i = range.start + 1; i <= frameIndex; i++) {
            const a = data.frames[i - 1].tip, b = data.frames[i].tip;
            if (a && b) line(ctx, xy(a), xy(b), '#7cc6b3', 1.7);
        }
        if (f.tip && joints[16]) { line(ctx, xy(joints[16]), xy(f.tip), colors.green, 4); dot(ctx, xy(f.tip), colors.green, 5); }
        if (joints[12] && joints[14] && joints[16]) {
            line(ctx, xy(joints[12]), xy(joints[14]), colors.blue, 4);
            line(ctx, xy(joints[14]), xy(joints[16]), colors.blue, 4);
            dot(ctx, xy(joints[14]), colors.blue, 5);
        }
        text(ctx, '骨格・竹刀先端', 14, 22);
        canvas.dataset.frame = frameIndex;
    }
    function drawPlot(id, first, last, { zoom = false, threshold = null, count = 0, selected = false } = {}) {
        const s = surface(id); if (!s) return;
        const { ctx, width, height } = s;
        const pad = { l: 43, r: 15, t: zoom ? 32 : 48, b: 40 };
        const plotWidth = width - pad.l - pad.r, plotHeight = height - pad.t - pad.b;
        const maximum = zoom ? Math.max(threshold * 1.8, ...data.frames.slice(first, last + 1).map((_, i) => relativeSpeed(first + i)).filter(Number.isFinite)) * 1.1 : 110;
        const x = i => pad.l + (i - first) / (last - first) * plotWidth;
        const y = v => pad.t + plotHeight * (1 - v / maximum);
        for (let n = 0; n <= 4; n++) {
            const v = maximum * n / 4;
            line(ctx, [pad.l, y(v)], [width - pad.r, y(v)], colors.line, 1);
            text(ctx, zoom ? v.toFixed(1) : String(Math.round(v)), pad.l - 8, y(v) + 4, colors.muted, 'right');
        }
        const tickCount = width < 450 ? 3 : 5;
        for (let n = 0; n < tickCount; n++) {
            const i = Math.round(first + (last - first) * n / (tickCount - 1));
            text(ctx, zoom ? String(i) : String(Math.round(data.frames[i].t - data.frames[range.start].t)), x(i), height - 20, colors.muted, 'center');
        }
        text(ctx, zoom ? 'コマ' : '開始からの時間 [ms]', width - pad.r, height - 3, colors.muted, 'right');
        if (zoom) {
            const anchor = threshold === 3 ? range.start : range.end;
            ctx.fillStyle = threshold === 3 ? '#087fa216' : '#bd405016';
            ctx.fillRect(x(anchor), pad.t, x(anchor + count - 1) - x(anchor), plotHeight);
            ctx.setLineDash([5, 4]);
            line(ctx, [pad.l, y(threshold)], [width - pad.r, y(threshold)], threshold === 3 ? colors.blue : colors.red, 1.5);
            ctx.setLineDash([]);
            text(ctx, `${threshold}% / ${count}コマ連続`, width - pad.r, 18, threshold === 3 ? colors.blue : colors.red, 'right');
        }
        ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, plotWidth, plotHeight); ctx.clip();
        ctx.strokeStyle = colors.blue; ctx.lineWidth = 2;
        ctx.beginPath(); let connected = false;
        for (let i = first; i <= last; i++) {
            const v = relativeSpeed(i);
            if (!Number.isFinite(v)) { connected = false; continue; }
            if (connected) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
            connected = true;
        }
        ctx.stroke();
        if (zoom) for (let i = first; i <= last; i++) if (Number.isFinite(relativeSpeed(i))) dot(ctx, [x(i), y(relativeSpeed(i))], colors.blue, 3);
        ctx.restore();
        if (!zoom) {
            const labels = [[range.start, '開始', colors.blue], [range.peak, '最高速度', colors.green], [range.end, '終了', colors.red]];
            labels.forEach(([i, name, color]) => {
                ctx.setLineDash([4, 3]); line(ctx, [x(i), pad.t], [x(i), height - pad.b], color, 1); ctx.setLineDash([]);
                text(ctx, name, x(i), 16, color, 'center');
                text(ctx, `${i}コマ`, x(i), 34, color, 'center');
            });
            if (selected) line(ctx, [x(frameIndex), pad.t], [x(frameIndex), height - pad.b], colors.ink, 1.5);
        }
    }
    function drawAngle() {
        const s = surface('angleCanvas'); if (!s) return;
        const { ctx, width, height } = s;
        const a = [width * 0.25, 63], b = [width * 0.39, height - 52], c = [width * 0.80, height * 0.45];
        line(ctx, b, a, colors.blue, 4); line(ctx, b, c, colors.green, 4);
        for (const [p, color] of [[a, colors.blue], [b, colors.ink], [c, colors.green]]) dot(ctx, p, color, 6);
        text(ctx, '右肩 (12)', a[0], a[1] - 20, colors.ink, 'center');
        text(ctx, '右肘 (14)', b[0], b[1] + 28, colors.ink, 'center');
        text(ctx, '右手首 (16)', c[0], c[1] - 20, colors.ink, 'center');
        text(ctx, 'u', (a[0]+b[0])/2 - 15, (a[1]+b[1])/2, colors.blue);
        text(ctx, 'v', (c[0]+b[0])/2 + 5, (c[1]+b[1])/2 + 18, colors.green);
        ctx.beginPath(); ctx.arc(...b, 39, Math.atan2(a[1]-b[1], a[0]-b[0]), Math.atan2(c[1]-b[1], c[0]-b[0])); ctx.strokeStyle = colors.red; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = '21px Georgia, serif'; text(ctx, 'θ', b[0]+17, b[1]-51, colors.red);
    }
    function render() {
        const f = data.frames[frameIndex];
        document.getElementById('elbowValue').innerHTML = `${f.elbow.toFixed(1)}<small>°</small>`;
        document.getElementById('torsoValue').innerHTML = `${f.torso.toFixed(1)}<small>°</small>`;
        document.getElementById('frameLabel').textContent = `${frameIndex}コマ / ${(f.t-data.frames[range.start].t).toFixed(0)} ms`;
        slider.value = frameIndex;
        drawPose();
        drawPlot('overviewPlot', range.start-15, range.end+15, { selected: true });
        drawPlot('timingPlot', range.start-15, range.end+15);
        drawPlot('startPlot', range.start-4, range.start+7, { zoom: true, threshold: 3, count: 4 });
        drawPlot('endPlot', range.end-4, range.end+9, { zoom: true, threshold: 2.5, count: 7 });
        drawAngle();
    }
    function stop() {
        playing = false; cancelAnimationFrame(request);
        play.setAttribute('aria-label', '再生'); play.title = '再生'; play.firstElementChild.className = 'fa-solid fa-play';
    }
    function animate(now) {
        if (!playing) return;
        frameIndex = Math.min(range.end, startedFrame + Math.floor((now-startedAt) * 30 / 1000));
        render();
        if (frameIndex >= range.end) stop(); else request = requestAnimationFrame(animate);
    }
    play.addEventListener('click', () => {
        if (playing) return stop();
        if (frameIndex >= range.end) frameIndex = range.start;
        playing = true; startedAt = performance.now(); startedFrame = frameIndex;
        play.setAttribute('aria-label', '停止'); play.title = '停止'; play.firstElementChild.className = 'fa-solid fa-pause';
        request = requestAnimationFrame(animate);
    });
    slider.addEventListener('input', () => { stop(); frameIndex = Number(slider.value); render(); });
    document.getElementById('resetButton').addEventListener('click', () => { stop(); frameIndex = range.start; render(); });
    function navigate() {
        const id = ['overview','timing','geometry','records'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
        stop();
        document.querySelectorAll('.panel').forEach(panel => { panel.hidden = panel.id !== id; });
        document.querySelectorAll('.section-nav a').forEach(a => {
            if (a.hash === `#${id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        render();
    }
    document.querySelectorAll('.section-nav a').forEach(a => a.addEventListener('click', event => {
        event.preventDefault(); history.pushState(null, '', a.hash); navigate(); window.scrollTo({ top: 0 });
    }));
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    new ResizeObserver(() => render()).observe(document.querySelector('main'));
    window.addEventListener('beforeprint', render);
    navigate();
})();
