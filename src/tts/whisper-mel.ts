/**
 * Whisper log-mel spectrogram aligned with LiteRT Android sample
 * (litert-samples MelSpectroProcessor: nFFT=400 → padded STFT 512, normType=whisper).
 *
 * Output: Float32Array length nMels * nFrames, row-major [mel][frame], transpose=false.
 */

export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_N_FFT = 400;
export const WHISPER_HOP_LENGTH = 160;
export const WHISPER_N_MELS = 80;
export const WHISPER_N_FRAMES = 3000;
export const WHISPER_N_SAMPLES = 30 * WHISPER_SAMPLE_RATE;

function nextPow2(n: number): number {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

function hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

/** Slaney-norm mel filterbank [nMels, nFreq] for given FFT size */
function buildMelFilters(nMels: number, nFft: number, sr: number): Float32Array {
    const nFreq = Math.floor(nFft / 2) + 1;
    const mMin = hzToMel(0);
    const mMax = hzToMel(sr / 2);
    const mPoints = new Float32Array(nMels + 2);
    for (let i = 0; i < mPoints.length; i++) {
        mPoints[i] = mMin + (i * (mMax - mMin)) / (nMels + 1);
    }
    const freqs = new Float32Array(mPoints.length);
    for (let i = 0; i < freqs.length; i++) freqs[i] = melToHz(mPoints[i]);

    const fftFreqs = new Float32Array(nFreq);
    for (let i = 0; i < nFreq; i++) fftFreqs[i] = (i * sr) / nFft;

    const filters = new Float32Array(nMels * nFreq);
    for (let i = 0; i < nMels; i++) {
        const left = freqs[i];
        const center = freqs[i + 1];
        const right = freqs[i + 2];
        const enorm = 2 / (right - left);
        for (let j = 0; j < nFreq; j++) {
            const f = fftFreqs[j];
            let w = 0;
            if (f >= left && f <= center) w = (f - left) / (center - left);
            else if (f > center && f <= right) w = (right - f) / (right - center);
            filters[i * nFreq + j] = w * enorm;
        }
    }
    return filters;
}

function hannWindow(n: number): Float32Array {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return w;
}

/** In-place radix-2 complex FFT (length must be power of 2). */
function fftRadix2(re: Float32Array, im: Float32Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
            tmp = im[i]; im[i] = im[j]; im[j] = tmp;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wlenRe = Math.cos(ang);
        const wlenIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let wRe = 1;
            let wIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const uRe = re[i + j];
                const uIm = im[i + j];
                const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
                const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + len / 2] = uRe - vRe;
                im[i + j + len / 2] = uIm - vIm;
                const nextWRe = wRe * wlenRe - wIm * wlenIm;
                wIm = wRe * wlenIm + wIm * wlenRe;
                wRe = nextWRe;
            }
        }
    }
}

let filtersCache: Float32Array | null = null;
let filtersNFft = 0;

export function computeWhisperLogMel(
    audio: Float32Array,
    opts: { nFrames?: number; nMels?: number } = {}
): Float32Array {
    const nFrames = opts.nFrames ?? WHISPER_N_FRAMES;
    const nMels = opts.nMels ?? WHISPER_N_MELS;
    const hop = WHISPER_HOP_LENGTH;
    const nSamples = nFrames * hop;
    const stftSize = nextPow2(WHISPER_N_FFT); // 512 — matches Android sample
    const nFreq = stftSize / 2 + 1;
    const LN_10 = Math.log(10);
    const LOG_GUARD = Math.pow(2, -24);

    const samples = new Float32Array(nSamples);
    samples.set(audio.subarray(0, Math.min(audio.length, nSamples)));

    if (!filtersCache || filtersNFft !== stftSize) {
        filtersCache = buildMelFilters(nMels, stftSize, WHISPER_SAMPLE_RATE);
        filtersNFft = stftSize;
    }
    const filters = filtersCache;
    const window = hannWindow(stftSize);

    // Center padding (reflect-ish zeros at edges is fine for ASR)
    const pad = Math.floor(stftSize / 2);
    const padded = new Float32Array(nSamples + stftSize);
    padded.set(samples, pad);

    const mel = new Float32Array(nMels * nFrames);
    const re = new Float32Array(stftSize);
    const im = new Float32Array(stftSize);
    const power = new Float32Array(nFreq);

    const validFrames = Math.min(nFrames, Math.max(1, Math.floor(audio.length / hop)));

    for (let f = 0; f < nFrames; f++) {
        const start = f * hop;
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < stftSize; i++) {
            re[i] = padded[start + i] * window[i];
        }
        fftRadix2(re, im);
        for (let k = 0; k < nFreq; k++) {
            power[k] = re[k] * re[k] + im[k] * im[k];
        }

        for (let m = 0; m < nMels; m++) {
            let sum = 0;
            const base = m * nFreq;
            for (let k = 0; k < nFreq; k++) sum += filters[base + k] * power[k];
            // natural log then / ln(10) ≡ log10 (Android sample)
            mel[m * nFrames + f] = Math.log(sum + LOG_GUARD) / LN_10;
        }
    }

    // Whisper norm over valid frames only
    let maxVal = -Infinity;
    for (let m = 0; m < nMels; m++) {
        for (let f = 0; f < validFrames; f++) {
            const v = mel[m * nFrames + f];
            if (v > maxVal) maxVal = v;
        }
    }
    const clipVal = maxVal - 8;
    for (let m = 0; m < nMels; m++) {
        for (let f = 0; f < nFrames; f++) {
            const idx = m * nFrames + f;
            if (f < validFrames) {
                mel[idx] = (Math.max(mel[idx], clipVal) + 4) / 4;
            } else {
                mel[idx] = 0;
            }
        }
    }

    return mel;
}
