self.importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');

const INPUT_SIZE = 640;
const KEYPOINT_COUNT = 17;
const CONF_THRESHOLD = 0.34;
const NMS_THRESHOLD = 0.45;

let session = null;
let inputName = '';
let outputName = '';
let modelCanvas = null;
let modelCtx = null;
let tensorData = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      await initSession(message.buffer);
      self.postMessage({ type: 'ready' });
      return;
    }

    if (message.type === 'infer') {
      const result = await runInference(message);
      self.postMessage({ type: 'result', jobId: message.jobId || null, ...result });
    }
  } catch (error) {
    self.postMessage({ type: 'error', jobId: message.jobId || null, message: error?.message || 'worker error' });
  }
};

async function initSession(buffer) {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
  session = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  inputName = session.inputNames[0];
  outputName = session.outputNames[0];
  if (self.OffscreenCanvas) {
    modelCanvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    modelCtx = modelCanvas.getContext('2d', { willReadFrequently: true });
  }
}

async function runInference(message) {
  if (!session) throw new Error('Session is not ready');
  const start = performance.now();
  const { bitmap, imageData, mirrorView, videoRect } = message;
  let letterbox;
  let videoWidth;
  let videoHeight;

  if (bitmap && modelCtx) {
    letterbox = preprocessBitmap(bitmap, mirrorView);
    videoWidth = letterbox.sourceWidth;
    videoHeight = letterbox.sourceHeight;
    bitmap.close?.();
  } else if (imageData) {
    letterbox = message.letterbox;
    videoWidth = message.videoWidth;
    videoHeight = message.videoHeight;
    fillTensorFromPixels(imageData.data);
  } else {
    throw new Error('No frame data');
  }

  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const outputs = await session.run({ [inputName]: inputTensor });
  const outputTensor = outputs[outputName] || Object.values(outputs)[0];
  const detections = parseYoloPoseOutput(outputTensor, letterbox, videoRect, videoWidth, videoHeight);
  return { detections, inferenceMs: performance.now() - start };
}

function preprocessBitmap(bitmap, mirrorView) {
  const scale = Math.min(INPUT_SIZE / bitmap.width, INPUT_SIZE / bitmap.height);
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  const padX = (INPUT_SIZE - drawW) / 2;
  const padY = (INPUT_SIZE - drawH) / 2;

  modelCtx.fillStyle = '#000';
  modelCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  modelCtx.save();
  if (mirrorView) {
    modelCtx.translate(padX + drawW, padY);
    modelCtx.scale(-1, 1);
  } else {
    modelCtx.translate(padX, padY);
  }
  modelCtx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, drawW, drawH);
  modelCtx.restore();

  const pixels = modelCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  fillTensorFromPixels(pixels);

  return { scale, padX, padY, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
}

function fillTensorFromPixels(pixels) {
  const planeSize = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    tensorData[p] = pixels[i] / 255;
    tensorData[planeSize + p] = pixels[i + 1] / 255;
    tensorData[planeSize * 2 + p] = pixels[i + 2] / 255;
  }
}

function parseYoloPoseOutput(tensor, letterbox, videoRect, videoWidth, videoHeight) {
  if (!tensor || !tensor.data || !tensor.dims) return [];
  const dims = tensor.dims;
  let candidates = 0;
  let channels = 0;
  let valueAt;

  if (dims.length === 3) {
    if (dims[1] < dims[2]) {
      channels = dims[1];
      candidates = dims[2];
      valueAt = (candidate, channel) => tensor.data[channel * candidates + candidate];
    } else {
      candidates = dims[1];
      channels = dims[2];
      valueAt = (candidate, channel) => tensor.data[candidate * channels + channel];
    }
  } else if (dims.length === 2) {
    candidates = dims[0];
    channels = dims[1];
    valueAt = (candidate, channel) => tensor.data[candidate * channels + channel];
  } else {
    return [];
  }

  if (channels < 56) return [];
  const keypointStart = channels - KEYPOINT_COUNT * 3;
  const boxes = [];

  for (let i = 0; i < candidates; i++) {
    const score = valueAt(i, 4);
    if (!Number.isFinite(score) || score < CONF_THRESHOLD) continue;

    let cx = valueAt(i, 0);
    let cy = valueAt(i, 1);
    let w = valueAt(i, 2);
    let h = valueAt(i, 3);
    if ([cx, cy, w, h].some(value => !Number.isFinite(value))) continue;
    if (Math.max(cx, cy, w, h) <= 2) {
      cx *= INPUT_SIZE;
      cy *= INPUT_SIZE;
      w *= INPUT_SIZE;
      h *= INPUT_SIZE;
    }

    const keypoints = [];
    for (let k = 0; k < KEYPOINT_COUNT; k++) {
      let x = valueAt(i, keypointStart + k * 3);
      let y = valueAt(i, keypointStart + k * 3 + 1);
      const conf = valueAt(i, keypointStart + k * 3 + 2);
      if (Math.max(x, y) <= 2) {
        x *= INPUT_SIZE;
        y *= INPUT_SIZE;
      }
      keypoints.push(modelPointToScreenPoint(x, y, conf, letterbox, videoRect, videoWidth, videoHeight));
    }

    boxes.push({
      score,
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      keypoints
    });
  }

  return nonMaximumSuppression(boxes, NMS_THRESHOLD).sort((a, b) => b.score - a.score).slice(0, 1);
}

function modelPointToScreenPoint(x, y, conf, letterbox, videoRect, videoWidth, videoHeight) {
  const vx = (x - letterbox.padX) / letterbox.scale;
  const vy = (y - letterbox.padY) / letterbox.scale;
  return {
    x: videoRect.x + vx * (videoRect.w / videoWidth),
    y: videoRect.y + vy * (videoRect.h / videoHeight),
    conf: Number.isFinite(conf) ? conf : 0
  };
}

function nonMaximumSuppression(boxes, threshold) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep = [];
  while (sorted.length) {
    const current = sorted.shift();
    keep.push(current);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (boxIoU(current, sorted[i]) > threshold) sorted.splice(i, 1);
    }
  }
  return keep;
}

function boxIoU(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return inter / Math.max(1, areaA + areaB - inter);
}
