(function (global) {
    'use strict';

    const DRAFT_PREFIX = 'kendo-video-correction-draft-v2:';
    const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

    function stableHash(value) {
        const text = String(value || '');
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function sourceKey(source = {}) {
        const file = source.file || source;
        const parts = [
            source.type || (file?.name ? 'file' : 'unknown'),
            file?.name || source.name || '',
            Number(file?.size ?? source.size ?? 0),
            Number(file?.lastModified ?? source.lastModified ?? 0),
            source.url && source.type === 'url' ? source.url : ''
        ];
        return stableHash(parts.join('|'));
    }

    function draftStorageKey(source) {
        return `${DRAFT_PREFIX}${sourceKey(source)}`;
    }

    function purgeDrafts(storage = global.sessionStorage) {
        if (!storage) return;
        const now = Date.now();
        for (let index = storage.length - 1; index >= 0; index -= 1) {
            const key = storage.key(index);
            if (!key?.startsWith(DRAFT_PREFIX)) continue;
            try {
                const draft = JSON.parse(storage.getItem(key) || 'null');
                if (!draft?.savedAt || now - Number(draft.savedAt) > DRAFT_MAX_AGE_MS) storage.removeItem(key);
            } catch (error) {
                storage.removeItem(key);
            }
        }
    }

    const correctionDrafts = {
        _timer: null,
        sourceKey,
        save(source, payload) {
            if (!source || !payload || !global.sessionStorage) return false;
            purgeDrafts(global.sessionStorage);
            const draft = { ...payload, savedAt: Date.now(), sourceKey: sourceKey(source) };
            global.sessionStorage.setItem(draftStorageKey(source), JSON.stringify(draft));
            return true;
        },
        schedule(source, payloadFactory, delayMs = 120) {
            clearTimeout(this._timer);
            this._timer = global.setTimeout(() => {
                this._timer = null;
                const payload = typeof payloadFactory === 'function' ? payloadFactory() : payloadFactory;
                if (payload) this.save(source, payload);
            }, Math.max(0, Number(delayMs) || 0));
        },
        load(source) {
            if (!source || !global.sessionStorage) return null;
            purgeDrafts(global.sessionStorage);
            try {
                const draft = JSON.parse(global.sessionStorage.getItem(draftStorageKey(source)) || 'null');
                return draft?.sourceKey === sourceKey(source) ? draft : null;
            } catch (error) {
                return null;
            }
        },
        clear(source) {
            if (!source || !global.sessionStorage) return;
            global.sessionStorage.removeItem(draftStorageKey(source));
        }
    };

    function seekVideoTo(video, timeSec, options = {}) {
        if (!video) return Promise.reject(new Error('video element is required'));
        const target = Math.max(0, Number(timeSec) || 0);
        const timeoutMs = Math.max(250, Number(options.timeoutMs) || 8000);
        const tolerance = Math.max(0.0001, Number(options.tolerance) || 0.0005);
        if (video.readyState >= 1 && Math.abs(Number(video.currentTime || 0) - target) <= tolerance) {
            return new Promise(resolve => global.requestAnimationFrame(() => resolve(true)));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                global.clearTimeout(timer);
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
            };
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                cleanup();
                error ? reject(error) : resolve(true);
            };
            const onSeeked = () => finish();
            const onError = () => finish(new Error(video.error?.message || 'video seek error'));
            const timer = global.setTimeout(() => finish(new Error('seek timeout')), timeoutMs);
            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onError, { once: true });
            try {
                video.currentTime = target;
            } catch (error) {
                finish(error);
            }
        });
    }

    function bindActions(root, handlers) {
        if (!root || root.__kendoVideoActionsBound) return;
        root.__kendoVideoActionsBound = true;
        root.addEventListener('click', event => {
            const element = event.target?.closest?.('[data-kendo-action]');
            if (!element || (root !== document && !root.contains(element))) return;
            const action = element.dataset.kendoAction;
            const handler = handlers?.[action];
            if (typeof handler !== 'function') return;
            event.preventDefault();
            handler({
                event,
                element,
                value: element.dataset.value,
                number: Number(element.dataset.value)
            });
        });
    }

    class ExactFrameRenderer {
        constructor(options = {}) {
            this.maxCache = Math.max(2, Number(options.maxCache) || 10);
            this.cache = new Map();
            this.pending = new Map();
            this.context = null;
        }

        setContext(context) {
            if (this.context === context) return;
            this.clear();
            this.context = context || null;
        }

        clear() {
            this.cache.forEach(bitmap => bitmap?.close?.());
            this.cache.clear();
            this.pending.clear();
        }

        _cacheBitmap(key, bitmap) {
            if (this.cache.has(key)) this.cache.get(key)?.close?.();
            this.cache.set(key, bitmap);
            while (this.cache.size > this.maxCache) {
                const oldestKey = this.cache.keys().next().value;
                this.cache.get(oldestKey)?.close?.();
                this.cache.delete(oldestKey);
            }
        }

        _findSample(context, timestampUs) {
            const target = Number(timestampUs);
            if (!context?.samples?.length || !Number.isFinite(target)) return null;
            let bestIndex = 0;
            let bestDiff = Infinity;
            context.samples.forEach((item, index) => {
                const diff = Math.abs(Number(item.timestampUs) - target);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestIndex = index;
                }
            });
            return { item: context.samples[bestIndex], index: bestIndex };
        }

        async _decodeBitmap(context, targetTimestampUs) {
            if (!global.VideoDecoder || !global.EncodedVideoChunk || !global.createImageBitmap) return null;
            const target = this._findSample(context, targetTimestampUs);
            if (!target) return null;
            let firstIndex = target.index;
            while (firstIndex > 0 && !context.samples[firstIndex].isRap) firstIndex -= 1;
            let bitmapPromise = null;
            let decodeError = null;
            const decoder = new VideoDecoder({
                output: frame => {
                    try {
                        if (Number(frame.timestamp) === Number(target.item.timestampUs) && !bitmapPromise) {
                            const clone = frame.clone();
                            bitmapPromise = global.createImageBitmap(clone).finally(() => clone.close());
                        }
                    } catch (error) {
                        decodeError = error;
                    } finally {
                        frame.close();
                    }
                },
                error: error => { decodeError = error; }
            });
            try {
                decoder.configure(context.decoderConfig);
                for (let index = firstIndex; index <= target.index; index += 1) {
                    const item = context.samples[index];
                    decoder.decode(new EncodedVideoChunk({
                        type: item.isRap ? 'key' : 'delta',
                        timestamp: item.timestampUs,
                        duration: item.durationUs,
                        data: item.sample.data
                    }));
                    if (decoder.decodeQueueSize > 24) await new Promise(resolve => global.setTimeout(resolve, 0));
                }
                await decoder.flush();
                if (decodeError) throw decodeError;
                return bitmapPromise ? await bitmapPromise : null;
            } finally {
                try { decoder.close(); } catch (error) {}
            }
        }

        async getBitmap(context, timestampUs) {
            this.setContext(context);
            const key = String(Math.round(Number(timestampUs) || 0));
            if (this.cache.has(key)) {
                const bitmap = this.cache.get(key);
                this.cache.delete(key);
                this.cache.set(key, bitmap);
                return bitmap;
            }
            if (this.pending.has(key)) return this.pending.get(key);
            const pending = this._decodeBitmap(context, Number(timestampUs))
                .then(bitmap => {
                    if (bitmap) this._cacheBitmap(key, bitmap);
                    return bitmap;
                })
                .finally(() => this.pending.delete(key));
            this.pending.set(key, pending);
            return pending;
        }

        async draw(context, timestampUs, canvasContext, width, height) {
            if (!context || !Number.isFinite(Number(timestampUs)) || !canvasContext) return false;
            try {
                const bitmap = await this.getBitmap(context, timestampUs);
                if (!bitmap) return false;
                const rotation = ((Math.round(Number(context.rotation || 0)) % 360) + 360) % 360;
                canvasContext.save();
                if (rotation === 90) {
                    canvasContext.translate(width, 0);
                    canvasContext.rotate(Math.PI / 2);
                    canvasContext.drawImage(bitmap, 0, 0, height, width);
                } else if (rotation === 270) {
                    canvasContext.translate(0, height);
                    canvasContext.rotate(-Math.PI / 2);
                    canvasContext.drawImage(bitmap, 0, 0, height, width);
                } else if (rotation === 180) {
                    canvasContext.translate(width, height);
                    canvasContext.rotate(Math.PI);
                    canvasContext.drawImage(bitmap, 0, 0, width, height);
                } else {
                    canvasContext.drawImage(bitmap, 0, 0, width, height);
                }
                canvasContext.restore();
                return true;
            } catch (error) {
                return false;
            }
        }
    }

    async function buildFingerprint(url = './index.html') {
        try {
            const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}sw-fingerprint=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = await response.arrayBuffer();
            if (global.crypto?.subtle) {
                const digest = await global.crypto.subtle.digest('SHA-256', bytes);
                return Array.from(new Uint8Array(digest).slice(0, 8), value => value.toString(16).padStart(2, '0')).join('');
            }
            return stableHash(new TextDecoder().decode(bytes));
        } catch (error) {
            return stableHash(`${location.pathname}|${document.lastModified || ''}`);
        }
    }

    global.KendoVideoEditorRuntime = Object.freeze({
        version: '2.0.0',
        correctionDrafts,
        seekVideoTo,
        bindActions,
        ExactFrameRenderer,
        buildFingerprint,
        sourceKey
    });
})(window);
