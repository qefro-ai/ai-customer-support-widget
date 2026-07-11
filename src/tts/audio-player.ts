/**
 * Audio Player for B2B TTS
 *
 * Web Audio playback with queue management, interruption support,
 * and event-based idle wait (no polling).
 */

export type AudioState = 'idle' | 'loading' | 'playing' | 'paused';

export interface AudioPlayerConfig {
    /** Volume level 0-1 (default: 0.8) */
    volume: number;
    /** Speech rate multiplier (default: 1.0) */
    rate: number;
}

const DEFAULT_CONFIG: AudioPlayerConfig = {
    volume: 0.8,
    rate: 1.0,
};

export class AudioPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private queue: AudioBuffer[] = [];
    private currentSource: AudioBufferSourceNode | null = null;
    private config: AudioPlayerConfig;
    private state: AudioState = 'idle';
    private onStateChange: ((state: AudioState) => void) | null = null;
    private idleWaiters: Array<() => void> = [];

    constructor(config: Partial<AudioPlayerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async initialize(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.config.volume;
        this.gainNode.connect(this.audioContext.destination);
    }

    /** Expose context for decode without creating a second AudioContext */
    getContext(): AudioContext | null {
        return this.audioContext;
    }

    setOnStateChange(callback: (state: AudioState) => void): void {
        this.onStateChange = callback;
    }

    setVolume(volume: number): void {
        this.config.volume = Math.max(0, Math.min(1, volume));
        if (this.gainNode) {
            this.gainNode.gain.value = this.config.volume;
        }
    }

    async enqueue(audioData: Float32Array, sampleRate: number = 22050): Promise<void> {
        if (!this.audioContext) {
            await this.initialize();
        }

        const audioBuffer = this.audioContext!.createBuffer(1, audioData.length, sampleRate);
        // Copy once into AudioBuffer; avoid retaining the source Float32Array longer than needed
        audioBuffer.getChannelData(0).set(audioData);

        this.queue.push(audioBuffer);

        if (this.state === 'idle') {
            this.playNext();
        }
    }

    /**
     * Decode and enqueue raw audio bytes (e.g. WAV from TTS API).
     * Uses the player's own AudioContext so sample rates stay consistent.
     */
    async enqueueWav(arrayBuffer: ArrayBuffer): Promise<void> {
        if (!this.audioContext) {
            await this.initialize();
        }

        const decoded = await this.audioContext!.decodeAudioData(arrayBuffer.slice(0));
        this.queue.push(decoded);

        if (this.state === 'idle') {
            this.playNext();
        }
    }

    /** Resolve when queue drains and playback is idle */
    waitUntilIdle(): Promise<void> {
        if (this.state === 'idle' && this.queue.length === 0 && !this.currentSource) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.idleWaiters.push(resolve);
        });
    }

    private playNext(): void {
        if (this.queue.length === 0) {
            this.setState('idle');
            return;
        }

        const audioBuffer = this.queue.shift()!;
        this.playBuffer(audioBuffer);
    }

    private playBuffer(buffer: AudioBuffer): void {
        if (!this.audioContext || !this.gainNode) return;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = buffer;
        this.currentSource.playbackRate.value = this.config.rate;
        this.currentSource.connect(this.gainNode);

        this.currentSource.onended = () => {
            this.currentSource = null;
            this.playNext();
        };

        this.currentSource.start();
        this.setState('playing');
    }

    stop(): void {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch {
                // Already stopped
            }
            this.currentSource = null;
        }
        this.queue = [];
        this.setState('idle');
    }

    pause(): void {
        if (this.audioContext && this.state === 'playing') {
            this.audioContext.suspend();
            this.setState('paused');
        }
    }

    resume(): void {
        if (this.audioContext && this.state === 'paused') {
            this.audioContext.resume();
            this.setState('playing');
        }
    }

    isPlaying(): boolean {
        return this.state === 'playing';
    }

    getState(): AudioState {
        return this.state;
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    private setState(state: AudioState): void {
        if (this.state !== state) {
            this.state = state;
            this.onStateChange?.(state);
        }
        if (state === 'idle' && this.queue.length === 0 && !this.currentSource) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const w of waiters) w();
        }
    }

    dispose(): void {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.gainNode = null;
    }
}

export default AudioPlayer;
