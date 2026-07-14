/**
 * Whisper STT worker — LiteRT.js + whisper_tiny_30s_i8.tflite
 * @see https://developers.google.com/edge/litert/web/get_started
 * @see https://huggingface.co/litert-community/whisper-tiny
 *
 * Model signatures (verified):
 *   encode  args_0 [1,80,3000] f32 → output_0 [1,1500,384] f32
 *   decode  args_0 [1,1500,384] + args_1 [1,128] i32 + args_2 [1,1,128,128] f32
 *           → output_0 [1,128,51865] f32
 */

import {
    loadLiteRt,
    loadAndCompile,
    Tensor,
    isWebGPUSupported,
    type CompiledModel,
} from '@litertjs/core';
import { computeWhisperLogMel, WHISPER_N_FRAMES, WHISPER_N_MELS } from './whisper-mel';
import {
    loadWhisperTokenizer,
    decodeWhisperTokens,
    DECODE_START_TOKEN_ID,
    DECODE_STOP_TOKEN_ID,
    FIRST_LANGUAGE_TOKEN_ID,
    LAST_LANGUAGE_TOKEN_ID,
    NO_TIMESTAMPS_TOKEN_ID,
    TRANSCRIBE_TOKEN_ID,
    getWhisperLanguageTokenId,
} from './whisper-tokenizer';
import { fetchCached, cacheMatch, cachePut } from './whisper-cache';

const MODEL_URL =
    'https://huggingface.co/litert-community/whisper-tiny/resolve/main/whisper_tiny_30s_i8.tflite';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.2/wasm/';

/** Blob URLs for cached Wasm assets (so locateFile never hits the network twice). */
const wasmBlobUrls = new Map<string, string>();

async function ensureWasmAssetCached(file: string): Promise<string> {
    const existing = wasmBlobUrls.get(file);
    if (existing) return existing;

    const url = `${WASM_CDN}${file}`;
    let bytes = await cacheMatch(url);
    if (!bytes) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download Wasm asset ${file}: ${res.status}`);
        bytes = await res.arrayBuffer();
        const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        await cachePut(url, bytes, type);
    }
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type }));
    wasmBlobUrls.set(file, blobUrl);
    return blobUrl;
}

/**
 * Emscripten resolves .wasm relative to the worker script URL. Point locateFile
 * at Cache API–backed blob URLs (absolute CDN on first miss).
 */
function installWasmLocateFile(): void {
    const prev = (self as any).Module || {};
    (self as any).Module = {
        ...prev,
        locateFile(path: string, scriptDirectory?: string) {
            const file = path.split('/').pop() || path;
            const cached = wasmBlobUrls.get(file);
            if (cached) return cached;
            if (file.endsWith('.wasm') || file.endsWith('.js')) {
                return `${WASM_CDN}${file}`;
            }
            if (typeof prev.locateFile === 'function') {
                return prev.locateFile(path, scriptDirectory);
            }
            return `${WASM_CDN}${file}`;
        },
    };
}

const MEL_SHAPE = [1, WHISPER_N_MELS, WHISPER_N_FRAMES] as const; // [1,80,3000]
const SEQ_LEN = 128;
const VOCAB_SIZE = 51865;
const MASKED_IN = 0.0;
const MASKED_OUT = -0.7 * 3.4028235e38;

let model: CompiledModel | null = null;
let ready = false;

function buildCausalMask4D(seqLen: number): Float32Array {
    // Shape [1, 1, S, S]
    const mask = new Float32Array(seqLen * seqLen);
    mask.fill(MASKED_OUT);
    for (let r = 0; r < seqLen; r++) {
        for (let c = 0; c <= r; c++) mask[r * seqLen + c] = MASKED_IN;
    }
    return mask;
}

function argmaxVocab(logits: Float32Array, tokenIndex: number): number {
    const start = tokenIndex * VOCAB_SIZE;
    let best = 0;
    let bestVal = logits[start];
    for (let i = 1; i < VOCAB_SIZE; i++) {
        const v = logits[start + i];
        if (v > bestVal) {
            bestVal = v;
            best = i;
        }
    }
    return best;
}

function argmaxRange(logits: Float32Array, tokenIndex: number, first: number, last: number): number {
    const start = tokenIndex * VOCAB_SIZE;
    let best = first;
    let bestVal = logits[start + first];
    for (let i = first + 1; i <= last; i++) {
        const value = logits[start + i];
        if (value > bestVal) {
            bestVal = value;
            best = i;
        }
    }
    return best;
}

async function readTensorF32(t: Tensor): Promise<Float32Array> {
    const cpu = await t.copyTo('wasm');
    const data = cpu.toTypedArray() as Float32Array;
    const copy = new Float32Array(data);
    if (cpu !== t) cpu.delete();
    return copy;
}

async function loadModel(onProgress: (pct: number) => void): Promise<void> {
    if (ready && model) return;

    onProgress(5);
    installWasmLocateFile();

    // Cache Wasm binaries so locateFile serves blob: URLs on repeat visits.
    // JS glue still loads from CDN (small; jsDelivr sends immutable Cache-Control).
    try {
        await Promise.all([
            ensureWasmAssetCached('litert_wasm_internal.wasm'),
            ensureWasmAssetCached('litert_wasm_compat_internal.wasm'),
        ]);
    } catch (e) {
        console.warn('[Whisper LiteRT] Wasm prefetch failed, CDN fallback:', e);
    }

    await loadLiteRt(WASM_CDN);
    onProgress(15);

    await loadWhisperTokenizer((p) => onProgress(15 + Math.round(p * 0.1)));
    onProgress(30);

    let modelFromCache = false;
    const modelBytes = await fetchCached(MODEL_URL, {
        contentType: 'application/octet-stream',
        onProgress: (p) => onProgress(30 + Math.round(p * 0.55)),
        onSource: (kind) => {
            modelFromCache = kind === 'hit';
            if (kind === 'hit') {
                self.postMessage({ status: 'progress', progress: 50, cached: true });
            }
        },
    });
    console.debug(
        `[Whisper LiteRT] model ${modelFromCache ? 'loaded from Cache API' : 'downloaded and cached'} (${modelBytes.byteLength} bytes)`
    );

    const accelerator = isWebGPUSupported() ? 'webgpu' : 'wasm';
    try {
        model = await loadAndCompile(modelBytes, { accelerator });
    } catch (e) {
        console.warn(`[Whisper LiteRT] ${accelerator} failed, falling back to wasm:`, e);
        model = await loadAndCompile(modelBytes, { accelerator: 'wasm' });
    }

    try {
        await runEncodeDecode(computeWhisperLogMel(new Float32Array(16000)), true);
    } catch (e) {
        console.warn('[Whisper LiteRT] warmup skipped:', e);
    }

    ready = true;
    onProgress(100);
}

async function runEncodeDecode(mel: Float32Array, warmup = false, language?: string): Promise<string> {
    if (!model) throw new Error('Model not loaded');
    if (!model.signatures['encode'] || !model.signatures['decode']) {
        throw new Error(
            `Missing encode/decode signatures (have: ${Object.keys(model.signatures).join(',')})`
        );
    }

    const melData =
        mel.length === WHISPER_N_MELS * WHISPER_N_FRAMES
            ? mel
            : (() => {
                  const p = new Float32Array(WHISPER_N_MELS * WHISPER_N_FRAMES);
                  p.set(mel.subarray(0, Math.min(mel.length, p.length)));
                  return p;
              })();

    const melTensor = new Tensor(melData, [...MEL_SHAPE]);
    let encHidden: Tensor;
    try {
        const encOut = await model.run('encode', { args_0: melTensor });
        encHidden = Array.isArray(encOut) ? encOut[0] : encOut['output_0'] ?? Object.values(encOut)[0];
    } finally {
        melTensor.delete();
    }

    const tokenIds = new Int32Array(SEQ_LEN);
    const maskData = buildCausalMask4D(SEQ_LEN);
    const generated: number[] = [];

    const runDecoder = async (): Promise<Float32Array> => {
        const tokenTensor = new Tensor(new Int32Array(tokenIds), [1, SEQ_LEN]);
        const maskTensor = new Tensor(new Float32Array(maskData), [1, 1, SEQ_LEN, SEQ_LEN]);
        let logitsTensor: Tensor;
        try {
            const decOut = await model!.run('decode', {
                args_0: encHidden,
                args_1: tokenTensor,
                args_2: maskTensor,
            });
            logitsTensor = Array.isArray(decOut)
                ? decOut[0]
                : decOut['output_0'] ?? Object.values(decOut)[0];
        } finally {
            tokenTensor.delete();
            maskTensor.delete();
        }
        const logits = await readTensorF32(logitsTensor);
        logitsTensor.delete();
        return logits;
    };

    try {
        tokenIds[0] = DECODE_START_TOKEN_ID;
        let languageToken = getWhisperLanguageTokenId(language);
        if (!languageToken) {
            const logits = await runDecoder();
            languageToken = argmaxRange(
                logits,
                0,
                FIRST_LANGUAGE_TOKEN_ID,
                LAST_LANGUAGE_TOKEN_ID
            );
        }
        tokenIds[1] = languageToken;
        tokenIds[2] = TRANSCRIBE_TOKEN_ID;
        tokenIds[3] = NO_TIMESTAMPS_TOKEN_ID;

        const maxSteps = warmup ? 1 : SEQ_LEN - 4;
        for (let step = 0; step < maxSteps; step++) {
            const tokenIndex = 3 + step;
            const logits = await runDecoder();
            const tokenId = argmaxVocab(logits, tokenIndex);
            if (tokenId === DECODE_STOP_TOKEN_ID) break;
            generated.push(tokenId);
            tokenIds[tokenIndex + 1] = tokenId;
        }
    } finally {
        try {
            encHidden.delete();
        } catch {
            /* already freed */
        }
    }

    if (warmup) return '';
    return decodeWhisperTokens(generated);
}

self.addEventListener('message', async (event: MessageEvent) => {
    const message = event.data;

    if (message.type === 'load') {
        try {
            await loadModel((progress) => {
                self.postMessage({ status: 'progress', progress });
            });
            self.postMessage({ status: 'ready' });
        } catch (error) {
            console.error('[Whisper LiteRT Worker]', error);
            self.postMessage({ status: 'error', error: String(error) });
        }
    } else if (message.type === 'transcribe') {
        try {
            if (!ready) await loadModel(() => {});
            const audio: Float32Array = message.audio;
            const t0 = performance.now();
            const mel = computeWhisperLogMel(audio);
            const melMs = performance.now() - t0;
            const t1 = performance.now();
            const text = await runEncodeDecode(mel, false, message.language);
            const inferMs = performance.now() - t1;
            self.postMessage({
                status: 'complete',
                text,
                infer_ms: Math.round(inferMs),
                mel_ms: Math.round(melMs),
                duration_s: Math.round((audio.length / 16000) * 100) / 100,
            });
        } catch (error: any) {
            self.postMessage({
                status: 'error',
                error: error?.message || String(error),
            });
        }
    }
});
