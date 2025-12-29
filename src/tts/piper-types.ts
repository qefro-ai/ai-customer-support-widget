/**
 * Piper TTS Types and Utilities
 * 
 * Type definitions and helper functions for Piper TTS WASM integration.
 * The actual Piper WASM is loaded dynamically from CDN.
 */

/** Piper TTS model configuration */
export interface PiperModelConfig {
    /** Model ONNX file URL */
    modelUrl: string;
    /** Model config JSON URL (optional) */
    configUrl?: string;
    /** Sample rate of output audio */
    sampleRate: number;
    /** Speaker ID for multi-speaker models */
    speakerId?: number;
}

/** Default English voice model (lessac medium - good quality, reasonable size) */
export const DEFAULT_MODEL_CONFIG: PiperModelConfig = {
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    sampleRate: 22050,
    speakerId: 0,
};

/** CDN URLs for ONNX Runtime Web WASM files */
export const ONNX_CDN_URLS = {
    wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort-wasm.wasm',
    wasmSimd: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort-wasm-simd.wasm',
    wasmThreaded: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort-wasm-threaded.wasm',
};

/** TTS generation options */
export interface TTSOptions {
    /** Length scale - higher = slower (default: 1.0) */
    lengthScale?: number;
    /** Noise scale - controls expressiveness (default: 0.667) */
    noiseScale?: number;
    /** Noise width - controls phoneme duration variation (default: 0.8) */
    noiseWidth?: number;
}

/**
 * Simple phoneme approximation for Piper
 * This is a fallback - real phonemization would use espeak-ng
 */
export function textToBasicPhonemes(text: string): number[] {
    // Basic ASCII to phoneme ID mapping
    // This is a simplified version - production would use proper phonemizer
    const phonemeMap: Record<string, number> = {
        ' ': 1, '.': 2, ',': 3, '?': 4, '!': 5,
        'a': 10, 'b': 11, 'c': 12, 'd': 13, 'e': 14,
        'f': 15, 'g': 16, 'h': 17, 'i': 18, 'j': 19,
        'k': 20, 'l': 21, 'm': 22, 'n': 23, 'o': 24,
        'p': 25, 'q': 26, 'r': 27, 's': 28, 't': 29,
        'u': 30, 'v': 31, 'w': 32, 'x': 33, 'y': 34, 'z': 35,
    };

    const phonemes: number[] = [0]; // Start token

    for (const char of text.toLowerCase()) {
        const id = phonemeMap[char];
        if (id !== undefined) {
            phonemes.push(id);
        }
    }

    phonemes.push(0); // End token
    return phonemes;
}

/**
 * Preprocess text for TTS
 * - Normalize whitespace
 * - Expand common abbreviations
 * - Add pauses after punctuation
 */
export function preprocessText(text: string): string {
    return text
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
        // Expand common abbreviations
        .replace(/\bdr\./gi, 'doctor')
        .replace(/\bmr\./gi, 'mister')
        .replace(/\bms\./gi, 'miss')
        .replace(/\bmrs\./gi, 'missus')
        // Numbers (basic)
        .replace(/\$(\d+)/g, '$1 dollars')
        .replace(/(\d+)%/g, '$1 percent');
}

export default {
    DEFAULT_MODEL_CONFIG,
    ONNX_CDN_URLS,
    textToBasicPhonemes,
    preprocessText,
};
