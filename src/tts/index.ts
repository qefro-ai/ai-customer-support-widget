/**
 * TTS Controller - Main orchestrator for B2B Text-to-Speech
 * 
 * Features:
 * - WASM ONNX TTS with Piper (lazy loaded)
 * - Fallback to Web Speech API if WASM fails
 * - Sentence buffering with B2B safety filters
 * - Web Audio playback with queue
 * - Interruption on new user message
 * - User preference persistence
 */

import { SentenceBuffer } from './sentence-buffer';
import { AudioPlayer } from './audio-player';
import { PiperWasmTTS, PiperModelId, PIPER_MODELS } from './piper-wasm';
import { preprocessText } from './piper-types';

export type TTSState = 'disabled' | 'loading' | 'ready' | 'speaking' | 'error';
export type TTSEngineType = 'wasm' | 'webspeech' | 'none';

export interface TTSControllerConfig {
    /** Storage key for voice preference */
    storageKey: string;
    /** Piper model to use */
    modelId: PiperModelId;
    /** Auto-enable for accessibility */
    accessibilityAutoEnable: boolean;
    /** Force Web Speech API (skip WASM) */
    forceWebSpeech: boolean;
}

const DEFAULT_CONFIG: TTSControllerConfig = {
    storageKey: 'helpbase_voice_enabled',
    modelId: 'en_lessac_medium',
    accessibilityAutoEnable: false,
    forceWebSpeech: false,
};

/** TTS Engine interface */
interface ITTSEngine {
    speak(text: string): Promise<void>;
    stop(): void;
    isSupported(): boolean;
}

/** Web Speech API implementation */
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

/** WASM ONNX Piper implementation */
class WasmEngine implements ITTSEngine {
    private piper: PiperWasmTTS;
    private audioPlayer: AudioPlayer;
    private currentAudioResolve: (() => void) | null = null;

    constructor(modelId: PiperModelId, audioPlayer: AudioPlayer) {
        this.piper = new PiperWasmTTS(modelId);
        this.audioPlayer = audioPlayer;
    }

    async initialize(): Promise<void> {
        await this.piper.initialize();
    }

    async speak(text: string): Promise<void> {
        const audioData = await this.piper.synthesize(text);
        const sampleRate = this.piper.getSampleRate();

        return new Promise<void>((resolve) => {
            this.currentAudioResolve = resolve;
            this.audioPlayer.enqueue(audioData, sampleRate);

            // Resolve when audio finishes
            const checkComplete = () => {
                if (this.audioPlayer.getState() === 'idle') {
                    resolve();
                } else {
                    setTimeout(checkComplete, 100);
                }
            };
            checkComplete();
        });
    }

    stop(): void {
        this.audioPlayer.stop();
        if (this.currentAudioResolve) {
            this.currentAudioResolve();
            this.currentAudioResolve = null;
        }
    }

    isSupported(): boolean {
        return typeof WebAssembly !== 'undefined';
    }

    dispose(): void {
        this.piper.dispose();
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

    constructor(config: Partial<TTSControllerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.sentenceBuffer = new SentenceBuffer();
        this.audioPlayer = new AudioPlayer();

        this.sentenceBuffer.setOnSentence(this.handleSentence.bind(this));
        this.loadPreference();
        this.setupVisibilityHandler();
    }

    /** Set state change callback */
    setOnStateChange(callback: (state: TTSState) => void): void {
        this.onStateChange = callback;
    }

    /** Get current engine type */
    getEngineType(): 'wasm' | 'webspeech' | 'none' {
        return this.engineType;
    }

    /** Enable/disable voice */
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

    /** Toggle voice on/off */
    async toggle(): Promise<boolean> {
        await this.setEnabled(!this.enabled);
        return this.enabled;
    }

    /** Check if voice is enabled */
    isEnabled(): boolean {
        return this.enabled;
    }

    /** Get current state */
    getState(): TTSState {
        return this.state;
    }

    /** Initialize TTS engine (lazy loading) */
    private async initialize(): Promise<void> {
        if (this.engine) {
            this.setState('ready');
            return;
        }

        this.setState('loading');

        try {
            await this.audioPlayer.initialize();

            // Try WASM ONNX first (unless forced to WebSpeech)
            if (!this.config.forceWebSpeech && typeof WebAssembly !== 'undefined') {
                try {
                    console.log('[TTS] Initializing WASM ONNX engine...');
                    const wasmEngine = new WasmEngine(this.config.modelId, this.audioPlayer);
                    await wasmEngine.initialize();
                    this.engine = wasmEngine;
                    this.engineType = 'wasm';
                    console.log('[TTS] WASM ONNX engine ready');
                } catch (wasmError) {
                    console.warn('[TTS] WASM failed, falling back to Web Speech:', wasmError);
                }
            }

            // Fallback to Web Speech API
            if (!this.engine) {
                console.log('[TTS] Using Web Speech API fallback');
                const webEngine = new WebSpeechEngine();

                if (!webEngine.isSupported()) {
                    throw new Error('No TTS engine available');
                }

                // Wait for voices to load
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

    /** Process streaming text */
    processText(text: string): void {
        if (!this.enabled) return;
        this.sentenceBuffer.append(text);
    }

    /** Handle approved sentence from buffer */
    private handleSentence(sentence: string): void {
        if (!this.enabled || !this.engine) return;

        const processed = preprocessText(sentence);
        this.speakQueue.push(processed);
        this.processQueue();
    }

    /** Process speech queue */
    private async processQueue(): Promise<void> {
        if (this.isSpeaking || this.speakQueue.length === 0) return;

        this.isSpeaking = true;
        this.setState('speaking');

        while (this.speakQueue.length > 0 && this.enabled) {
            const text = this.speakQueue.shift()!;
            try {
                await this.engine!.speak(text);
            } catch (error) {
                console.error('[TTS] Speak error:', error);
            }
        }

        this.isSpeaking = false;
        if (this.enabled) {
            this.setState('ready');
        }
    }

    /** Stop current speech and clear queue */
    stop(): void {
        this.speakQueue = [];
        this.engine?.stop();
        this.audioPlayer.stop();
        this.isSpeaking = false;
    }

    /** Reset for new conversation/message */
    reset(): void {
        this.stop();
        this.sentenceBuffer.reset();
    }

    /** Called when user sends a new message */
    onUserMessage(): void {
        this.reset();
    }

    /** Called when assistant response is complete */
    onResponseComplete(): void {
        this.sentenceBuffer.flush();
    }

    /** Speak complete text (non-streaming, for full responses) */
    async speakText(text: string): Promise<void> {
        if (!this.enabled || !text.trim()) return;

        // Initialize engine if needed
        if (!this.engine) {
            await this.initialize();
        }

        if (!this.engine) return;

        // Preprocess and speak the full text
        const processed = preprocessText(text);
        this.speakQueue.push(processed);
        this.processQueue();
    }

    /** Load preference from storage */
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

    /** Save preference to storage */
    private savePreference(): void {
        try {
            localStorage.setItem(this.config.storageKey, String(this.enabled));
        } catch { }
    }

    /** Handle tab visibility changes */
    private setupVisibilityHandler(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'speaking') {
                this.audioPlayer.pause();
            } else if (!document.hidden && this.enabled) {
                this.audioPlayer.resume();
            }
        });
    }

    /** Update state and notify */
    private setState(state: TTSState): void {
        if (this.state !== state) {
            this.state = state;
            this.onStateChange?.(state);
        }
    }

    /** Cleanup resources */
    dispose(): void {
        this.stop();
        this.audioPlayer.dispose();
        if (this.engine && 'dispose' in this.engine) {
            (this.engine as WasmEngine).dispose();
        }
        this.engine = null;
    }
}

export default TTSController;
