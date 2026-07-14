/**
 * TTS Controller - Main orchestrator for B2B Text-to-Speech
 *
 * Pipeline:
 * - Sentences enqueue as the LLM streams
 * - TTS API fetches run ahead (parallel, capped) while audio plays
 * - Decoded clips enqueue into Web Audio without waiting for prior clip end
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
/** How many TTS HTTP fetches may run at once while audio plays */
const MAX_CONCURRENT_FETCHES = 3;
const TTS_FETCH_RETRIES = 2;
const TTS_FETCH_RETRY_DELAY_MS = 400;

interface ITTSEngine {
    speak(text: string): Promise<void>;
    fetchAudio?(text: string): Promise<ArrayBuffer>;
    /** Enqueue audio for playback (must NOT wait for the whole queue to drain) */
    enqueueAudio?(buffer: ArrayBuffer): Promise<void>;
    playAudio?(buffer: ArrayBuffer): Promise<void>;
    stop(): void;
    isSupported(): boolean;
}

class WebSpeechEngine implements ITTSEngine {
    private synth: SpeechSynthesis;
    private voice: SpeechSynthesisVoice | null = null;
    private rate = 1.0;

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

            this.synth.speak(utterance);
        });
    }

    stop(): void {
        this.synth.cancel();
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

        let lastError: unknown;
        for (let attempt = 0; attempt <= TTS_FETCH_RETRIES; attempt++) {
            try {
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
            } catch (error) {
                lastError = error;
                if (attempt < TTS_FETCH_RETRIES) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, TTS_FETCH_RETRY_DELAY_MS * (attempt + 1))
                    );
                }
            }
        }
        throw lastError;
    }

    /** Decode + push onto the play queue; returns as soon as enqueued */
    async enqueueAudio(buffer: ArrayBuffer): Promise<void> {
        await this.audioPlayer.enqueueWav(buffer);
    }

    async playAudio(buffer: ArrayBuffer): Promise<void> {
        await this.enqueueAudio(buffer);
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

type QueueItem = {
    text: string;
    fetch: Promise<ArrayBuffer | null> | null;
};

export class TTSController {
    private config: TTSControllerConfig;
    private sentenceBuffer: SentenceBuffer;
    private audioPlayer: AudioPlayer;
    private engine: ITTSEngine | null = null;
    private webSpeechFallback: WebSpeechEngine | null = null;
    private engineType: TTSEngineType = 'none';
    private state: TTSState = 'disabled';
    private enabled = false;
    private queue: QueueItem[] = [];
    private draining = false;
    private initPromise: Promise<void> | null = null;
    private onStateChange: ((state: TTSState) => void) | null = null;

    constructor(config: Partial<TTSControllerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.sentenceBuffer = new SentenceBuffer({ flushTimeout: 800 });
        this.audioPlayer = new AudioPlayer();

        this.sentenceBuffer.setOnSentence(this.handleSentence.bind(this));
        this.loadPreference();
        this.setupVisibilityHandler();

        if (this.enabled) {
            this.ensureInitialized().catch((e) => console.error('[TTS] Auto-init failed:', e));
        }
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

    private ensureInitialized(): Promise<void> {
        if (this.engine) return Promise.resolve();
        if (!this.initPromise) {
            this.initPromise = this.initialize().finally(() => {
                this.initPromise = null;
            });
        }
        return this.initPromise;
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
            this.drainQueue();
        } catch (error) {
            console.error('[TTS] Initialization failed:', error);
            this.engineType = 'none';
            this.setState('error');
        }
    }

    processText(text: string): void {
        if (!this.enabled) return;
        void this.ensureInitialized();
        this.sentenceBuffer.append(text);
    }

    private handleSentence(sentence: string): void {
        if (!this.enabled) return;

        const processed = preprocessText(sentence);
        this.queue.push({ text: processed, fetch: null });
        void this.ensureInitialized().then(() => {
            this.fillFetchSlots();
            this.drainQueue();
        });
    }

    /** Start TTS fetches for upcoming sentences up to the concurrency cap */
    private fillFetchSlots(): void {
        if (!this.engine?.fetchAudio) return;

        let inFlight = 0;
        for (const item of this.queue) {
            if (item.fetch) inFlight++;
        }

        for (const item of this.queue) {
            if (inFlight >= MAX_CONCURRENT_FETCHES) break;
            if (item.fetch) continue;
            const text = item.text;
            item.fetch = this.engine.fetchAudio(text).catch((err) => {
                console.error('[TTS] Prefetch failed:', err);
                return null;
            });
            inFlight++;
        }
    }

    /**
     * Ordered drain: wait for each sentence's audio (already fetching ahead),
     * enqueue onto the player immediately, keep fetching the rest — never block
     * on playback finishing between sentences.
     */
    private async drainQueue(): Promise<void> {
        if (this.draining) return;
        if (!this.engine) return;

        this.draining = true;
        this.setState('speaking');

        try {
            while (this.queue.length > 0 && this.enabled) {
                this.fillFetchSlots();
                const item = this.queue[0];

                let buffer: ArrayBuffer | null = null;
                if (item.fetch) {
                    buffer = await item.fetch;
                } else if (this.engine.fetchAudio) {
                    buffer = await this.engine.fetchAudio(item.text).catch(() => null);
                }

                // Drop before enqueue so later sentences can start fetching
                this.queue.shift();
                this.fillFetchSlots();

                try {
                    if (buffer && this.engine.enqueueAudio) {
                        await this.engine.enqueueAudio(buffer);
                    } else if (buffer) {
                        await this.audioPlayer.enqueueWav(buffer);
                    } else {
                        await this.speakWithFallback(item.text);
                    }
                } catch (error) {
                    console.error('[TTS] Speak error:', error);
                    try {
                        await this.speakWithFallback(item.text);
                    } catch (fallbackError) {
                        console.error('[TTS] Fallback speak error:', fallbackError);
                    }
                }
            }
        } finally {
            this.draining = false;
            if (this.queue.length > 0 && this.enabled) {
                // Sentences arrived while we were finishing the last fetch
                this.drainQueue();
                return;
            }
            // Flip UI back to ready only after playback catches up — do not
            // block the fetch/enqueue pipeline on this wait.
            void this.audioPlayer.waitUntilIdle().then(() => {
                if (!this.draining && this.queue.length === 0 && this.enabled) {
                    this.setState('ready');
                }
            });
        }
    }

    private getWebSpeechFallback(): WebSpeechEngine | null {
        if (!this.webSpeechFallback) {
            this.webSpeechFallback = new WebSpeechEngine();
        }
        return this.webSpeechFallback.isSupported() ? this.webSpeechFallback : null;
    }

    /** Use browser speech when API fetch/decode fails */
    private async speakWithFallback(text: string): Promise<void> {
        const fallback = this.getWebSpeechFallback();
        if (!fallback) {
            throw new Error('No TTS fallback available');
        }
        await fallback.speak(text);
    }

    stop(): void {
        this.queue = [];
        this.engine?.stop();
        this.webSpeechFallback?.stop();
        this.audioPlayer.stop();
        this.draining = false;
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

        await this.ensureInitialized();
        if (!this.engine) return;

        const processed = preprocessText(text);
        this.queue.push({ text: processed, fetch: null });
        this.fillFetchSlots();
        this.drainQueue();
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
            const activePlayback =
                this.audioPlayer.isPlaying() ||
                this.audioPlayer.getQueueLength() > 0 ||
                this.state === 'speaking';
            if (document.hidden && activePlayback) {
                this.audioPlayer.pause();
            } else if (!document.hidden && this.enabled && this.audioPlayer.getState() === 'paused') {
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
        this.webSpeechFallback?.stop();
        this.webSpeechFallback = null;
        if (this.engine && 'dispose' in this.engine) {
            (this.engine as ApiEngine).dispose();
        }
        this.engine = null;
    }
}

export default TTSController;
