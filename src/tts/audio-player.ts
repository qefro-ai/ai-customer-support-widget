/**
 * Audio Player for B2B TTS
 * 
 * Handles Web Audio API playback with queue management,
 * interruption support, and graceful pause/resume.
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

    constructor(config: Partial<AudioPlayerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize audio context (must be called after user interaction)
     */
    async initialize(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.config.volume;
        this.gainNode.connect(this.audioContext.destination);
    }

    /**
     * Set state change callback
     */
    setOnStateChange(callback: (state: AudioState) => void): void {
        this.onStateChange = callback;
    }

    /**
     * Set volume (0-1)
     */
    setVolume(volume: number): void {
        this.config.volume = Math.max(0, Math.min(1, volume));
        if (this.gainNode) {
            this.gainNode.gain.value = this.config.volume;
        }
    }

    /**
     * Add audio data to queue and start playing
     */
    async enqueue(audioData: Float32Array, sampleRate: number = 22050): Promise<void> {
        if (!this.audioContext) {
            await this.initialize();
        }

        const audioBuffer = this.audioContext!.createBuffer(1, audioData.length, sampleRate);
        audioBuffer.getChannelData(0).set(audioData);

        this.queue.push(audioBuffer);

        // Start playing if idle
        if (this.state === 'idle') {
            this.playNext();
        }
    }

    /**
     * Play next item in queue
     */
    private playNext(): void {
        if (this.queue.length === 0) {
            this.setState('idle');
            return;
        }

        const audioBuffer = this.queue.shift()!;
        this.playBuffer(audioBuffer);
    }

    /**
     * Play audio buffer
     */
    private playBuffer(buffer: AudioBuffer): void {
        if (!this.audioContext || !this.gainNode) return;

        // Resume context if suspended (browser autoplay policy)
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

    /**
     * Stop current playback and clear queue
     */
    stop(): void {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                // Already stopped
            }
            this.currentSource = null;
        }
        this.queue = [];
        this.setState('idle');
    }

    /**
     * Pause playback (for tab visibility changes)
     */
    pause(): void {
        if (this.audioContext && this.state === 'playing') {
            this.audioContext.suspend();
            this.setState('paused');
        }
    }

    /**
     * Resume playback
     */
    resume(): void {
        if (this.audioContext && this.state === 'paused') {
            this.audioContext.resume();
            this.setState('playing');
        }
    }

    /**
     * Check if currently playing
     */
    isPlaying(): boolean {
        return this.state === 'playing';
    }

    /**
     * Get current state
     */
    getState(): AudioState {
        return this.state;
    }

    /**
     * Get queue length
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Update state and notify
     */
    private setState(state: AudioState): void {
        if (this.state !== state) {
            this.state = state;
            if (this.onStateChange) {
                this.onStateChange(state);
            }
        }
    }

    /**
     * Cleanup resources
     */
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
