import STTWorker from './whisper.worker?worker&inline';

export type WhisperSTTState = 'idle' | 'loading' | 'ready' | 'listening' | 'processing' | 'error' | 'unsupported';

export class WhisperSTT {
    private worker: Worker | null = null;
    private state: WhisperSTTState = 'idle';
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private decodeCtx: AudioContext | null = null;
    private onStateChange: ((state: WhisperSTTState) => void) | null = null;
    private onResult: ((transcript: string) => void) | null = null;
    private onProgress: ((progress: number) => void) | null = null;
    private transcribeStartedAt = 0;
    private language?: string;

    constructor(_workerPath?: string, language?: string) {
        this.language = language;
        this.checkSupport();
    }

    private checkSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.setState('unsupported');
            console.error('[WhisperSTT] MediaDevices API not supported');
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
        this.language = language;
    }

    getState() {
        return this.state;
    }

    async init() {
        if (this.state !== 'idle' && this.state !== 'error') return;

        this.setState('loading');

        return new Promise<void>((resolve, reject) => {
            this.worker = new STTWorker();
            const worker = this.worker;

            worker.addEventListener('message', (event) => {
                const message = event.data;

                if (message.status === 'ready') {
                    this.setState('ready');
                    resolve();
                } else if (message.status === 'complete') {
                    const elapsed = this.transcribeStartedAt
                        ? (performance.now() - this.transcribeStartedAt).toFixed(0)
                        : '?';
                    console.debug(`[WhisperSTT] transcription complete in ${elapsed}ms`);
                    if (this.onResult && message.text) {
                        this.onResult(message.text.trim());
                    }
                    this.setState('ready');
                } else if (message.status === 'error') {
                    console.error('[WhisperSTT Worker Error]', message.error);
                    this.setState('error');
                    reject(new Error(message.error));
                } else if (message.status === 'progress') {
                    if (this.onProgress && typeof message.progress === 'number') {
                        // Negative progress signals cache hit for UI copy
                        if (message.cached) {
                            this.onProgress(-1);
                        } else {
                            this.onProgress(message.progress);
                        }
                    }
                }
            });

            worker.postMessage({ type: 'load' });
        });
    }

    private getDecodeContext(): AudioContext {
        if (!this.decodeCtx || this.decodeCtx.state === 'closed') {
            this.decodeCtx = new AudioContext({ sampleRate: 16000 });
        }
        return this.decodeCtx;
    }

    async start() {
        try {
            // Prefer low-latency mono capture when the browser supports constraints
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            if (this.state === 'idle' || this.state === 'error') {
                await this.init();
            }

            if (this.state !== 'ready') {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
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
                stream.getTracks().forEach(track => track.stop());

                try {
                    if (this.audioChunks.length === 0) {
                        this.setState('ready');
                        return;
                    }

                    const audioBlob = new Blob(this.audioChunks, {
                        type: this.mediaRecorder?.mimeType || 'audio/webm',
                    });
                    const arrayBuffer = await audioBlob.arrayBuffer();

                    if (arrayBuffer.byteLength === 0) {
                        this.setState('ready');
                        return;
                    }

                    const audioContext = this.getDecodeContext();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                    // Copy channel data into a transferable buffer (zero-copy to worker)
                    const channel = audioBuffer.getChannelData(0);
                    const audioData = new Float32Array(channel.length);
                    audioData.set(channel);

                    this.transcribeStartedAt = performance.now();
                    this.worker?.postMessage(
                        { type: 'transcribe', audio: audioData, language: this.language },
                        [audioData.buffer]
                    );
                } catch (error) {
                    console.error('[WhisperSTT] Failed to process audio', error);
                    this.setState('ready');
                }
            };

            // Timeslice keeps chunks flowing; stop() still finalizes the blob
            this.mediaRecorder.start(250);
            this.setState('listening');
        } catch (error) {
            console.error('[WhisperSTT] Failed to start recording', error);
            this.setState('error');
        }
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
            console.log('[WhisperSTT] Ignoring toggle during ' + this.state);
        } else {
            this.start();
        }
    }

    dispose() {
        if (this.mediaRecorder && this.state === 'listening') {
            this.mediaRecorder.stop();
        }
        if (this.worker) {
            this.worker.terminate();
        }
        if (this.decodeCtx) {
            this.decodeCtx.close();
            this.decodeCtx = null;
        }
    }
}
