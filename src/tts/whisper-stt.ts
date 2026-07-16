/**
 * Server-side Speech-to-Text client.
 *
 * Browser only records microphone audio and POSTs it to
 * `/api/v1/widget/stt` (Whisper Base ONNX on the llm-service).
 * No WASM / Transformers.js / ONNX Runtime Web.
 */

export type WhisperSTTState =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'listening'
    | 'processing'
    | 'error'
    | 'unsupported';

export interface ServerSttConfig {
    apiUrl: string;
    apiToken: string;
    workspaceId?: string | null;
    language?: string;
}

export class WhisperSTT {
    private state: WhisperSTTState = 'idle';
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private onStateChange: ((state: WhisperSTTState) => void) | null = null;
    private onResult: ((transcript: string) => void) | null = null;
    private onProgress: ((progress: number) => void) | null = null;
    private languageHintProvider: (() => string[] | undefined) | null = null;
    private language: string;
    private apiUrl: string;
    private apiToken: string;
    private workspaceId: string | null;
    private abortController: AbortController | null = null;

    constructor(configOrWorkerPath?: string | ServerSttConfig, language?: string) {
        // Back-compat: old signature was (workerPath?, language?)
        if (configOrWorkerPath && typeof configOrWorkerPath === 'object') {
            this.apiUrl = configOrWorkerPath.apiUrl.replace(/\/$/, '');
            this.apiToken = configOrWorkerPath.apiToken;
            this.workspaceId = configOrWorkerPath.workspaceId ?? null;
            this.language =
                (configOrWorkerPath.language || language || 'auto').trim() || 'auto';
        } else {
            this.apiUrl = '';
            this.apiToken = '';
            this.workspaceId = null;
            this.language = (language || 'auto').trim() || 'auto';
        }
        this.checkSupport();
    }

    configure(config: ServerSttConfig) {
        this.apiUrl = config.apiUrl.replace(/\/$/, '');
        this.apiToken = config.apiToken;
        this.workspaceId = config.workspaceId ?? null;
        if (config.language) {
            this.language = config.language.trim() || 'auto';
        }
    }

    private checkSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.setState('unsupported');
            console.error('[STT] MediaDevices API not supported');
        }
    }

    private setState(newState: WhisperSTTState) {
        if (this.state !== newState) {
            this.state = newState;
            this.onStateChange?.(newState);
        }
    }

    setOnStateChange(callback: (state: WhisperSTTState) => void) {
        this.onStateChange = callback;
    }

    setOnResult(callback: (transcript: string) => void) {
        this.onResult = callback;
    }

    setOnProgress(callback: (progress: number) => void) {
        this.onProgress = callback;
    }

    setLanguage(language?: string) {
        this.language = language && language.trim() ? language : 'auto';
    }

    /** Kept for API compat; server Whisper handles language detection. */
    setLanguageHintProvider(provider: (() => string[] | undefined) | null) {
        this.languageHintProvider = provider;
    }

    getState() {
        return this.state;
    }

    async init() {
        if (this.state === 'unsupported') return;
        if (!this.apiUrl || !this.apiToken) {
            this.setState('error');
            throw new Error('STT API URL/token not configured');
        }
        // No model download — ready immediately.
        this.setState('ready');
        this.onProgress?.(100);
    }

    async start() {
        try {
            if (this.state === 'idle' || this.state === 'error') {
                this.setState('loading');
                await this.init();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            if (this.state !== 'ready' && this.state !== 'loading') {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            this.setState('ready');

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                  ? 'audio/webm'
                  : undefined;
            this.mediaRecorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                this.setState('processing');
                stream.getTracks().forEach((track) => track.stop());

                try {
                    if (this.audioChunks.length === 0) {
                        this.setState('ready');
                        return;
                    }

                    const audioBlob = new Blob(this.audioChunks, {
                        type: this.mediaRecorder?.mimeType || 'audio/webm',
                    });
                    if (audioBlob.size === 0) {
                        this.setState('ready');
                        return;
                    }

                    // Touch hint provider so callers still wire it (unused server-side).
                    try {
                        this.languageHintProvider?.();
                    } catch {
                        /* ignore */
                    }

                    const text = await this.uploadAndTranscribe(audioBlob);
                    if (text && this.onResult) {
                        this.onResult(text);
                    }
                    this.setState('ready');
                } catch (error) {
                    console.error('[STT] Failed to process audio', error);
                    this.setState('error');
                    setTimeout(() => {
                        if (this.state === 'error') this.setState('ready');
                    }, 1500);
                }
            };

            this.mediaRecorder.start(250);
            this.setState('listening');
        } catch (error) {
            console.error('[STT] Failed to start recording', error);
            this.setState('error');
        }
    }

    private async uploadAndTranscribe(blob: Blob): Promise<string> {
        if (!this.apiUrl || !this.apiToken) {
            throw new Error('STT not configured');
        }

        const form = new FormData();
        const ext = blob.type.includes('ogg')
            ? 'ogg'
            : blob.type.includes('wav')
              ? 'wav'
              : 'webm';
        form.append('audio', blob, `recording.${ext}`);
        form.append('language', this.language || 'auto');

        this.abortController?.abort();
        this.abortController = new AbortController();

        const t0 = performance.now();
        const response = await fetch(`${this.apiUrl}/api/v1/widget/stt`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                ...(this.workspaceId ? { 'X-Workspace-ID': this.workspaceId } : {}),
            },
            body: form,
            signal: this.abortController.signal,
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`STT ${response.status}: ${detail.slice(0, 200)}`);
        }

        const json = (await response.json()) as {
            text?: string;
            language?: string;
            processing_ms?: number;
        };
        console.debug(
            `[STT] transcription complete in ${(performance.now() - t0).toFixed(0)}ms ` +
                `(server ${json.processing_ms ?? '?'}ms, lang=${json.language ?? '?'})`,
        );
        return (json.text || '').trim();
    }

    stop() {
        if (this.state === 'listening' && this.mediaRecorder) {
            this.mediaRecorder.stop();
        }
    }

    toggle() {
        if (this.state === 'listening') {
            this.stop();
        } else if (this.state === 'loading' || this.state === 'processing') {
            console.log('[STT] Ignoring toggle during ' + this.state);
        } else {
            this.start();
        }
    }

    dispose() {
        if (this.mediaRecorder && this.state === 'listening') {
            this.mediaRecorder.stop();
        }
        this.abortController?.abort();
        this.abortController = null;
    }
}
