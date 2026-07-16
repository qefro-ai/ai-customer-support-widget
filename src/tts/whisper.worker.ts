let pipeline: any;
let Tensor: any;
let env: any;

class PipelineSingleton {
    static task = 'automatic-speech-recognition' as const;
    static model = 'onnx-community/whisper-tiny';
    static instance: any = null;

    static async getInstance(progressCallback: (progress: any) => void) {
        if (!pipeline) {
            const transformers = await import(
                // @ts-expect-error The runtime CDN import keeps ONNX/Wasm out of the widget bundle.
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'
            );
            pipeline = transformers.pipeline;
            Tensor = transformers.Tensor;
            env = transformers.env;
            env.allowLocalModels = false;
        }

        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback: progressCallback,
                dtype: {
                    encoder_model: 'q4',
                    decoder_model_merged: 'q4',
                },
            });
        }
        return this.instance;
    }
}

/** Map Unicode script in recent text → Whisper language code. */
function inferLanguageFromText(texts: string[] | undefined): string | null {
    if (!texts?.length) return null;
    const joined = texts.join('\n');
    const counts: Array<[string, RegExp]> = [
        ['ar', /[\u0600-\u06FF]/g],
        ['ta', /[\u0B80-\u0BFF]/g],
        ['hi', /[\u0900-\u097F]/g],
        ['te', /[\u0C00-\u0C7F]/g],
        ['kn', /[\u0C80-\u0CFF]/g],
        ['ml', /[\u0D00-\u0D7F]/g],
        ['bn', /[\u0980-\u09FF]/g],
        ['gu', /[\u0A80-\u0AFF]/g],
        ['pa', /[\u0A00-\u0A7F]/g],
        ['zh', /[\u4E00-\u9FFF]/g],
        ['ja', /[\u3040-\u30FF]/g],
        ['ko', /[\uAC00-\uD7AF]/g],
        ['th', /[\u0E00-\u0E7F]/g],
        ['ru', /[\u0400-\u04FF]/g],
    ];
    let best: string | null = null;
    let bestCount = 0;
    for (const [code, re] of counts) {
        const n = joined.match(re)?.length ?? 0;
        if (n > bestCount) {
            best = code;
            bestCount = n;
        }
    }
    return bestCount >= 2 ? best : null;
}

function browserLanguageCode(): string | null {
    try {
        const lang = (self as any).navigator?.language as string | undefined;
        if (!lang) return null;
        return lang.toLowerCase().split(/[-_]/, 1)[0] || null;
    } catch {
        return null;
    }
}

/**
 * Whisper language detection via a single decoder step after <|startoftranscript|>.
 * Required because transformers.js still defaults unspecified language to English.
 */
async function detectLanguageFromAudio(transcriber: any, audio: Float32Array): Promise<string | null> {
    const model = transcriber?.model;
    const processor = transcriber?.processor;
    const generationConfig = model?.generation_config;
    const langToId = generationConfig?.lang_to_id as Record<string, number> | undefined;
    if (!model || !processor || !langToId || !Tensor) return null;
    if (generationConfig.is_multilingual === false) return null;

    const processed = await processor(audio);
    const input_features = processed.input_features ?? processed;
    const sot = Number(generationConfig.decoder_start_token_id);
    if (!Number.isFinite(sot)) return null;

    const decoder_input_ids = new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
    const outputs = await model({ input_features, decoder_input_ids });
    const logits = outputs?.logits;
    if (!logits?.dims || logits.dims.length < 3) return null;

    // logits: [1, seq, vocab] — score language tokens at the last position
    const [, seqLen, vocab] = logits.dims;
    const flat = logits.to?.('float32')?.data ?? logits.data;
    if (!flat || !vocab) return null;
    const offset = (seqLen - 1) * vocab;

    const langIds = new Set(Object.values(langToId).map(Number));
    let maxScore = -Infinity;
    let detectedId = -1;
    for (const id of langIds) {
        if (id < 0 || id >= vocab) continue;
        const score = Number(flat[offset + id]);
        if (score > maxScore) {
            maxScore = score;
            detectedId = id;
        }
    }
    if (detectedId < 0) return null;

    const idToLang = Object.fromEntries(
        Object.entries(langToId).map(([token, id]) => [Number(id), token]),
    );
    const token = idToLang[detectedId]; // e.g. "<|ta|>"
    if (!token || typeof token !== 'string') return null;
    const match = token.match(/^<\|([a-z]{2})\|>$/i);
    return match?.[1]?.toLowerCase() ?? null;
}

async function resolveLanguage(
    transcriber: any,
    audio: Float32Array,
    requested: string | undefined,
    hintTexts: string[] | undefined,
): Promise<string> {
    const normalized = requested?.toLowerCase().split(/[-_]/, 1)[0];
    if (normalized && normalized !== 'auto') {
        return normalized;
    }

    try {
        const detected = await detectLanguageFromAudio(transcriber, audio);
        if (detected) {
            console.debug('[Whisper] detected language:', detected);
            return detected;
        }
    } catch (err) {
        console.warn('[Whisper] audio language detection failed', err);
    }

    const fromText = inferLanguageFromText(hintTexts);
    if (fromText) {
        console.debug('[Whisper] language from chat text:', fromText);
        return fromText;
    }

    const fromBrowser = browserLanguageCode();
    if (fromBrowser) {
        console.debug('[Whisper] language from browser:', fromBrowser);
        return fromBrowser;
    }

    return 'en';
}

function reportProgress(progress: any): void {
    if (progress?.status === 'progress' && typeof progress.progress === 'number') {
        self.postMessage({ status: 'progress', progress: progress.progress });
    }
}

self.addEventListener('message', async (event: MessageEvent) => {
    const message = event.data;

    if (message.type === 'load') {
        try {
            await PipelineSingleton.getInstance(reportProgress);
            self.postMessage({ status: 'ready' });
        } catch (error) {
            console.error('[Whisper Transformers.js Worker]', error);
            self.postMessage({ status: 'error', error: String(error) });
        }
    } else if (message.type === 'transcribe') {
        try {
            const transcriber = await PipelineSingleton.getInstance(reportProgress);
            const language = await resolveLanguage(
                transcriber,
                message.audio,
                message.language,
                message.hintTexts,
            );
            const output = await transcriber(message.audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
                task: 'transcribe',
                language,
            });

            self.postMessage({
                status: 'complete',
                text: output.text,
                language,
            });
        } catch (error: any) {
            self.postMessage({
                status: 'error',
                error: error?.message || String(error),
            });
        }
    }
});
