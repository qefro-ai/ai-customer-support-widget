export type WhisperSTTState = 'idle' | 'loading' | 'ready' | 'listening' | 'processing' | 'error' | 'unsupported';

export class WhisperSTT {
    private worker: Worker | null = null;
    private state: WhisperSTTState = 'idle';
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private onStateChange: ((state: WhisperSTTState) => void) | null = null;
    private onResult: ((transcript: string) => void) | null = null;
    private onProgress: ((progress: number) => void) | null = null;
    private workerPath: string;

    constructor(workerPath: string) {
        this.workerPath = workerPath;
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

    getState() {
        return this.state;
    }

    async init() {
        if (this.state !== 'idle' && this.state !== 'error') return;

        this.setState('loading');

        return new Promise<void>((resolve, reject) => {
            this.worker = new Worker(new URL(this.workerPath, import.meta.url), {
                type: 'module'
            });

            this.worker.addEventListener('message', (event) => {
                const message = event.data;

                if (message.status === 'ready') {
                    this.setState('ready');
                    resolve();
                } else if (message.status === 'complete') {
                    if (this.onResult && message.text) {
                        this.onResult(message.text.trim());
                    }
                    this.setState('ready'); // Ready for next recording
                } else if (message.status === 'error') {
                    console.error('[WhisperSTT Worker Error]', message.error);
                    this.setState('error');
                    reject(new Error(message.error));
                } else if (message.status === 'progress') {
                    if (this.onProgress && typeof message.progress === 'number') {
                        this.onProgress(message.progress);
                    }
                } else {
                    // Progress updates can be handled here if needed
                }
            });

            // Send load message
            this.worker.postMessage({ type: 'load' });
        });
    }

    async start() {
        try {
            // Request microphone immediately to prevent browser gesture timeouts
            // which occur if we wait 30s for the model to download first.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            if (this.state === 'idle' || this.state === 'error') {
                await this.init();
            }

            if (this.state !== 'ready') {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                this.setState('processing');
                
                // Stop all tracks to release microphone
                stream.getTracks().forEach(track => track.stop());

                const audioBlob = new Blob(this.audioChunks);
                const arrayBuffer = await audioBlob.arrayBuffer();

                // Decode audio using AudioContext at 16000Hz (required by Whisper)
                const audioContext = new AudioContext({ sampleRate: 16000 });
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const audioData = audioBuffer.getChannelData(0); // Float32Array

                // Send to worker
                this.worker?.postMessage({
                    type: 'transcribe',
                    audio: audioData
                });
            };

            this.mediaRecorder.start();
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
    }
}
