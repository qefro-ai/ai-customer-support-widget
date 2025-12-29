/**
 * Piper TTS with ONNX Runtime Web (WASM)
 * 
 * ONNX Runtime is loaded dynamically from CDN to keep widget bundle small.
 * The model is lazy-loaded on first TTS request.
 */

// ONNX Runtime types (loaded dynamically)
type InferenceSession = any;
type Tensor = any;

/** CDN URLs */
const ONNX_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

/** Piper voice models */
export const PIPER_MODELS = {
    en_lessac_medium: {
        name: 'English (US) - Lessac Medium',
        onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
        config: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
        sampleRate: 22050,
    },
    en_amy_low: {
        name: 'English (GB) - Amy Low',
        onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/amy/low/en_GB-amy-low.onnx',
        config: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/amy/low/en_GB-amy-low.onnx.json',
        sampleRate: 16000,
    },
};

export type PiperModelId = keyof typeof PIPER_MODELS;

/** Piper model configuration from JSON */
interface PiperConfig {
    audio: { sample_rate: number };
    inference: {
        noise_scale: number;
        length_scale: number;
        noise_w: number;
    };
    phoneme_id_map: Record<string, number[]>;
}

/** Global ONNX Runtime reference (loaded from CDN) */
let ort: any = null;

/**
 * Load ONNX Runtime from CDN
 */
async function loadOnnxRuntime(): Promise<any> {
    if (ort) return ort;

    console.log('[PiperTTS] Loading ONNX Runtime from CDN...');

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${ONNX_CDN}ort.min.js`;
        script.async = true;

        script.onload = () => {
            ort = (window as any).ort;
            if (ort) {
                // Configure WASM paths
                ort.env.wasm.wasmPaths = ONNX_CDN;
                console.log('[PiperTTS] ONNX Runtime loaded');
                resolve(ort);
            } else {
                reject(new Error('ONNX Runtime not found on window'));
            }
        };

        script.onerror = () => reject(new Error('Failed to load ONNX Runtime'));
        document.head.appendChild(script);
    });
}

/**
 * Piper TTS using ONNX Runtime Web (CDN loaded)
 */
export class PiperWasmTTS {
    private session: InferenceSession | null = null;
    private config: PiperConfig | null = null;
    private modelId: PiperModelId;
    private isLoading = false;
    private isReady = false;

    constructor(modelId: PiperModelId = 'en_lessac_medium') {
        this.modelId = modelId;
    }

    ready(): boolean {
        return this.isReady;
    }

    loading(): boolean {
        return this.isLoading;
    }

    /**
     * Initialize TTS - loads ONNX Runtime + Piper model
     */
    async initialize(): Promise<void> {
        if (this.isReady || this.isLoading) return;

        this.isLoading = true;
        const model = PIPER_MODELS[this.modelId];

        try {
            // Load ONNX Runtime from CDN
            const ortLib = await loadOnnxRuntime();

            console.log('[PiperTTS] Loading model:', model.name);

            // Load Piper config
            const configResponse = await fetch(model.config);
            this.config = await configResponse.json();

            // Create ONNX session
            this.session = await ortLib.InferenceSession.create(model.onnx, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });

            this.isReady = true;
            console.log('[PiperTTS] Model loaded successfully');
        } catch (error) {
            console.error('[PiperTTS] Failed to load:', error);
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Synthesize speech from text
     */
    async synthesize(text: string): Promise<Float32Array> {
        if (!this.session || !this.config || !ort) {
            await this.initialize();
        }

        if (!this.session || !this.config || !ort) {
            throw new Error('TTS not initialized');
        }

        // Convert text to phoneme IDs
        const phonemeIds = this.textToPhonemeIds(text);

        // Create input tensors
        const inputIds = new ort.Tensor('int64', BigInt64Array.from(phonemeIds.map(BigInt)), [1, phonemeIds.length]);
        const inputLengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
        const scales = new ort.Tensor('float32', new Float32Array([
            this.config.inference.noise_scale,
            this.config.inference.length_scale,
            this.config.inference.noise_w,
        ]), [3]);

        // Run inference
        const results = await this.session.run({
            input: inputIds,
            input_lengths: inputLengths,
            scales: scales,
        });

        return results.output.data as Float32Array;
    }

    getSampleRate(): number {
        return this.config?.audio.sample_rate || PIPER_MODELS[this.modelId].sampleRate;
    }

    /**
     * Convert text to phoneme IDs
     */
    private textToPhonemeIds(text: string): number[] {
        if (!this.config) return [];

        const map = this.config.phoneme_id_map;
        const ids: number[] = [];

        // Start token
        if (map['^']) ids.push(...map['^']);

        // Process text
        const normalized = text.toLowerCase().trim();

        for (const char of normalized) {
            if (map[char]) {
                ids.push(...map[char]);
            } else if (char === ' ' && map[' ']) {
                ids.push(...map[' ']);
            } else if ('.?!,'.includes(char) && map[char]) {
                ids.push(...map[char]);
            }
        }

        // End token
        if (map['$']) ids.push(...map['$']);

        return ids;
    }

    dispose(): void {
        this.session = null;
        this.config = null;
        this.isReady = false;
    }
}

export default PiperWasmTTS;
