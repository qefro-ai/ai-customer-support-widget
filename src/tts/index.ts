/**
 * TTS Controller - Main orchestrator for B2B Text-to-Speech
 *
 * Optimizations:
 * - Prefetch next sentence while current audio plays (pipeline parallelism)
 * - Client-side WAV LRU cache
 * - Event-based playback wait (no 100ms polling)
 * - Faster sentence flush for first-audio latency
 */

import { SentenceBuffer } from './sentence-buffer';
import { AudioPlayer } from './audio-player';
import { PiperModelId } from './piper-wasm';
import { preprocessText } from './piper-types';

export type TTSState = 'disabled' | 'loading' | 'ready' | 'speaking' | 'error';
export type TTSEngineType = 'api' | 'webspeech' | 'none';

export interface TTSControllerConfig {
    storageKey: string;
    modelId: PiperModelId;
    accessibilityAutoEnable: boolean;
    forceWebSpeech: boolean;
    apiUrl: string;
    apiToken: string;
    workspaceId: string | null;
}

const DEFAULT_CONFIG: TTSControllerConfig = {
    storageKey: 'helpbase_voice_enabled',
    modelId: 'en_lessac_medium',
    accessibilityAutoEnable: false,
    forceWebSpeech: false,
    apiUrl: 'http://localhost:3000',
    apiToken: '',
    workspaceId: null,
};

const CLIENT_TTS_CACHE_MAX = 32;

interface ITTSEngine {
    speak(text: string): Promise<void>;
    /** Fetch audio without waiting for playback (for prefetch) */
    fetchAudio?(text: string): Promise<ArrayBuffer>;
    /** Enqueue pre-fetched audio and wait until that clip finishes */
    playAudio?(buffer: ArrayBuffer): Promise<void>;
    stop(): void;
    isSupported(): boolean;
}

class WebSpeechEngine implements ITTSEngine {
    private synth: SpeechSynthesis;
    private voice: SpeechSynthesisVoice | null = null;
    private rate = 1.0;
    private currentUtterance: SpeechSynthesisUtterance | null = null;

    constructor() {
        this.synth = window.speechSynthesis;
        this.selectVoice();
    }

    private selectVoice(): void {
        const voices = this.synth.getVoices();
        const preferred = ['Google UK English Female', 'Google US English', 'Microsoft Zira', 'Samantha'];

        for (const name of preferred) {
            const found = voices.find(v => v.name.includes(name));
            if (found) {
                this.voice = found;
                return;
            }
        }
        this.voice = voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
    }

    async speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.voice) this.selectVoice();

            const utterance = new SpeechSynthesisUtterance(text);
            if (this.voice) utterance.voice = this.voice;
            utterance.rate = this.rate;
            utterance.onend = () => resolve();
            utterance.onerror = (e) => reject(e);

            this.currentUtterance = utterance;
            this.synth.speak(utterance);
        });
    }

    stop(): void {
        this.synth.cancel();
        this.currentUtterance = null;
    }

    isSupported(): boolean {
        return 'speechSynthesis' in window;
    }
}

class ApiEngine implements ITTSEngine {
    private audioPlayer: AudioPlayer;
    private apiUrl: string;
    private apiToken: string;
    private workspaceId: string | null;
    private cache = new Map<string, ArrayBuffer>();

    constructor(audioPlayer: AudioPlayer, apiUrl: string, apiToken: string, workspaceId: string | null) {
        this.audioPlayer = audioPlayer;
        this.apiUrl = apiUrl;
        this.apiToken = apiToken;
        this.workspaceId = workspaceId;
    }

    async initialize(): Promise<void> {}

    private cacheGet(text: string): ArrayBuffer | undefined {
        const hit = this.cache.get(text);
        if (hit) {
            // LRU touch
            this.cache.delete(text);
            this.cache.set(text, hit);
        }
        return hit;
    }

    private cachePut(text: string, buf: ArrayBuffer): void {
        this.cache.set(text, buf);
        while (this.cache.size > CLIENT_TTS_CACHE_MAX) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
    }

    async fetchAudio(text: string): Promise<ArrayBuffer> {
        const cached = this.cacheGet(text);
        if (cached) return cached.slice(0);

        const t0 = performance.now();
        const response = await fetch(`${this.apiUrl}/api/v1/widget/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`,
                ...(this.workspaceId ? { 'X-Workspace-ID': this.workspaceId } : {})
            },
            body: JSON.stringify({ text, lang: 'auto' })
        });

        if (!response.ok) {
            throw new Error(`TTS request failed with status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const latency = response.headers.get('X-TTS-Latency-Ms');
        console.debug(
            `[TTS] fetch ${text.length} chars in ${(performance.now() - t0).toFixed(0)}ms` +
            (latency ? ` (server ${latency}ms)` : '')
        );
        this.cachePut(text, arrayBuffer.slice(0));
        return arrayBuffer;
    }

    async playAudio(buffer: ArrayBuffer): Promise<void> {
        await this.audioPlayer.enqueueWav(buffer);
        await this.audioPlayer.waitUntilIdle();
    }

    async speak(text: string): Promise<void> {
        try {
            const arrayBuffer = await this.fetchAudio(text);
            await this.playAudio(arrayBuffer);
        } catch (error) {
            console.error('[TTS ApiEngine] Error:', error);
        }
    }

    stop(): void {
        this.audioPlayer.stop();
    }

    isSupported(): boolean {
        return true;
    }

    dispose(): void {
        this.cache.clear();
    }
}

export class TTSController {
    private config: TTSControllerConfig;
    private sentenceBuffer: SentenceBuffer;
    private audioPlayer: AudioPlayer;
    private engine: ITTSEngine | null = null;
    private engineType: TTSEngineType = 'none';
    private state: TTSState = 'disabled';
    private enabled = false;
    private speakQueue: string[] = [];
    private isSpeaking = false;
    private onStateChange: ((state: TTSState) => void) | null = null;
    private prefetchPromise: Promise<ArrayBuffer | null> | null = null;
    private prefetchText: string | null = null;

    constructor(config: Partial<TTSControllerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Faster flush → earlier first audio when LLM streams without punctuation
        this.sentenceBuffer = new SentenceBuffer({ flushTimeout: 800 });
        this.audioPlayer = new AudioPlayer();

        this.sentenceBuffer.setOnSentence(this.handleSentence.bind(this));
        this.loadPreference();
        this.setupVisibilityHandler();
    }

    setOnStateChange(callback: (state: TTSState) => void): void {
        this.onStateChange = callback;
    }

    getEngineType(): 'wasm' | 'webspeech' | 'none' {
        return this.engineType as 'wasm' | 'webspeech' | 'none';
    }

    async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        this.savePreference();

        if (enabled) {
            await this.initialize();
        } else {
            this.stop();
            this.setState('disabled');
        }
    }

    async toggle(): Promise<boolean> {
        await this.setEnabled(!this.enabled);
        return this.enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    getState(): TTSState {
        return this.state;
    }

    private async initialize(): Promise<void> {
        if (this.engine) {
            this.setState('ready');
            return;
        }

        this.setState('loading');

        try {
            await this.audioPlayer.initialize();

            if (!this.config.forceWebSpeech) {
                try {
                    console.log('[TTS] Initializing API engine...');
                    const apiEngine = new ApiEngine(
                        this.audioPlayer,
                        this.config.apiUrl,
                        this.config.apiToken,
                        this.config.workspaceId
                    );
                    await apiEngine.initialize();
                    this.engine = apiEngine;
                    this.engineType = 'api';
                    console.log('[TTS] API engine ready');
                } catch (apiError) {
                    console.warn('[TTS] API engine failed, falling back to Web Speech:', apiError);
                }
            }

            if (!this.engine) {
                console.log('[TTS] Using Web Speech API fallback');
                const webEngine = new WebSpeechEngine();

                if (!webEngine.isSupported()) {
                    throw new Error('No TTS engine available');
                }

                await new Promise<void>(resolve => {
                    if (window.speechSynthesis.getVoices().length > 0) {
                        resolve();
                    } else {
                        window.speechSynthesis.onvoiceschanged = () => resolve();
                        setTimeout(resolve, 1000);
                    }
                });

                this.engine = webEngine;
                this.engineType = 'webspeech';
            }

            this.setState('ready');
        } catch (error) {
            console.error('[TTS] Initialization failed:', error);
            this.engineType = 'none';
            this.setState('error');
        }
    }

    processText(text: string): void {
        if (!this.enabled) return;
        this.sentenceBuffer.append(text);
    }

    private handleSentence(sentence: string): void {
        if (!this.enabled || !this.engine) return;

        const processed = preprocessText(sentence);
        this.speakQueue.push(processed);
        // Kick off prefetch for the head of queue immediately
        this.ensurePrefetch();
        this.processQueue();
    }

    private ensurePrefetch(): void {
        if (!this.engine?.fetchAudio || this.speakQueue.length === 0) return;
        const next = this.speakQueue[0];
        if (this.prefetchText === next && this.prefetchPromise) return;

        this.prefetchText = next;
        this.prefetchPromise = this.engine.fetchAudio(next).catch((err) => {
            console.error('[TTS] Prefetch failed:', err);
            return null;
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isSpeaking || this.speakQueue.length === 0) return;

        this.isSpeaking = true;
        this.setState('speaking');

        while (this.speakQueue.length > 0 && this.enabled) {
            const text = this.speakQueue.shift()!;

            // Use in-flight prefetch if it matches this sentence
            let audioPromise: Promise<ArrayBuffer | null>;
            if (this.prefetchText === text && this.prefetchPromise) {
                audioPromise = this.prefetchPromise;
            } else if (this.engine!.fetchAudio) {
                audioPromise = this.engine!.fetchAudio(text).catch(() => null);
            } else {
                audioPromise = Promise.resolve(null);
            }

            // Prefetch next sentence while current fetch/playback runs
            if (this.speakQueue.length > 0 && this.engine!.fetchAudio) {
                const upcoming = this.speakQueue[0];
                this.prefetchText = upcoming;
                this.prefetchPromise = this.engine!.fetchAudio(upcoming).catch(() => null);
            } else {
                this.prefetchText = null;
                this.prefetchPromise = null;
            }

            try {
                if (this.engine!.playAudio) {
                    const buffer = await audioPromise;
                    if (buffer) {
                        await this.engine!.playAudio(buffer);
                    } else {
                        await this.engine!.speak(text);
                    }
                } else {
                    await this.engine!.speak(text);
                }
            } catch (error) {
                console.error('[TTS] Speak error:', error);
            }
        }

        this.isSpeaking = false;
        if (this.enabled) {
            this.setState('ready');
        }
    }

    stop(): void {
        this.speakQueue = [];
        this.prefetchPromise = null;
        this.prefetchText = null;
        this.engine?.stop();
        this.audioPlayer.stop();
        this.isSpeaking = false;
    }

    reset(): void {
        this.stop();
        this.sentenceBuffer.reset();
    }

    onUserMessage(): void {
        this.reset();
    }

    onResponseComplete(): void {
        this.sentenceBuffer.flush();
    }

    async speakText(text: string): Promise<void> {
        if (!this.enabled || !text.trim()) return;

        if (!this.engine) {
            await this.initialize();
        }

        if (!this.engine) return;

        const processed = preprocessText(text);
        this.speakQueue.push(processed);
        this.ensurePrefetch();
        this.processQueue();
    }

    private loadPreference(): void {
        try {
            const saved = localStorage.getItem(this.config.storageKey);
            this.enabled = saved === 'true';

            if (this.config.accessibilityAutoEnable) {
                const screenReader = /NVDA|JAWS|VoiceOver|ChromeVox/i.test(navigator.userAgent);
                if (screenReader) this.enabled = true;
            }
        } catch {
            this.enabled = false;
        }
    }

    private savePreference(): void {
        try {
            localStorage.setItem(this.config.storageKey, String(this.enabled));
        } catch { }
    }

    private setupVisibilityHandler(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'speaking') {
                this.audioPlayer.pause();
            } else if (!document.hidden && this.enabled) {
                this.audioPlayer.resume();
            }
        });
    }

    private setState(state: TTSState): void {
        if (this.state !== state) {
            this.state = state;
            this.onStateChange?.(state);
        }
    }

    dispose(): void {
        this.stop();
        this.audioPlayer.dispose();
        if (this.engine && 'dispose' in this.engine) {
            (this.engine as ApiEngine).dispose();
        }
        this.engine = null;
    }
}

export default TTSController;
