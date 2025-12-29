/**
 * Speech-to-Text (STT) for B2B Widget
 * 
 * Uses Web Speech API for browser-native voice recognition.
 * Provides a simple, accessible way for users to speak instead of type.
 */

export type STTState = 'idle' | 'listening' | 'processing' | 'error' | 'unsupported';

export interface STTConfig {
    /** Language code (default: 'en-US') */
    language: string;
    /** Continuous mode vs single phrase */
    continuous: boolean;
    /** Interim results while speaking */
    interimResults: boolean;
}

const DEFAULT_CONFIG: STTConfig = {
    language: 'en-US',
    continuous: false,
    interimResults: true,
};

// Web Speech API types
interface SpeechRecognitionEvent {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

type SpeechRecognitionType = {
    new(): SpeechRecognitionInstance;
};

interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
}

export type ResultCallback = (transcript: string, isFinal: boolean) => void;

export class SpeechToText {
    private config: STTConfig;
    private recognition: SpeechRecognitionInstance | null = null;
    private state: STTState = 'idle';
    private onResult: ResultCallback | null = null;
    private onStateChange: ((state: STTState) => void) | null = null;

    constructor(config: Partial<STTConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.checkSupport();
    }

    /**
     * Check browser support for Web Speech API
     */
    private checkSupport(): void {
        const SpeechRecognition = (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            this.state = 'unsupported';
            console.warn('[STT] Web Speech API not supported');
            return;
        }

        try {
            this.recognition = new SpeechRecognition() as SpeechRecognitionInstance;
            this.recognition.continuous = this.config.continuous;
            this.recognition.interimResults = this.config.interimResults;
            this.recognition.lang = this.config.language;
            this.setupHandlers();
        } catch (e) {
            this.state = 'unsupported';
            console.error('[STT] Failed to create recognition:', e);
        }
    }

    /**
     * Set up event handlers
     */
    private setupHandlers(): void {
        if (!this.recognition) return;

        this.recognition.onstart = () => {
            this.setState('listening');
            console.log('[STT] Listening...');
        };

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            // Emit interim results for live preview
            if (interimTranscript && this.onResult) {
                this.onResult(interimTranscript, false);
            }

            // Emit final result
            if (finalTranscript && this.onResult) {
                this.onResult(finalTranscript, true);
            }
        };

        this.recognition.onerror = (event: { error: string }) => {
            console.error('[STT] Error:', event.error);

            // Handle specific errors
            switch (event.error) {
                case 'not-allowed':
                    this.setState('error');
                    break;
                case 'no-speech':
                    // Not an error, just no speech detected
                    this.setState('idle');
                    break;
                case 'aborted':
                    this.setState('idle');
                    break;
                default:
                    this.setState('error');
            }
        };

        this.recognition.onend = () => {
            if (this.state === 'listening') {
                this.setState('idle');
            }
            console.log('[STT] Stopped');
        };
    }

    /**
     * Check if STT is supported
     */
    isSupported(): boolean {
        return this.state !== 'unsupported';
    }

    /**
     * Get current state
     */
    getState(): STTState {
        return this.state;
    }

    /**
     * Set result callback
     */
    setOnResult(callback: ResultCallback): void {
        this.onResult = callback;
    }

    /**
     * Set state change callback
     */
    setOnStateChange(callback: (state: STTState) => void): void {
        this.onStateChange = callback;
    }

    /**
     * Start listening
     */
    start(): boolean {
        if (!this.recognition || this.state === 'unsupported') {
            console.warn('[STT] Not supported');
            return false;
        }

        if (this.state === 'listening') {
            return true; // Already listening
        }

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.error('[STT] Failed to start:', e);
            this.setState('error');
            return false;
        }
    }

    /**
     * Stop listening
     */
    stop(): void {
        if (this.recognition && this.state === 'listening') {
            this.recognition.stop();
        }
    }

    /**
     * Abort listening (cancel without result)
     */
    abort(): void {
        if (this.recognition && this.state === 'listening') {
            this.recognition.abort();
        }
    }

    /**
     * Toggle listening
     */
    toggle(): boolean {
        if (this.state === 'listening') {
            this.stop();
            return false;
        } else {
            return this.start();
        }
    }

    /**
     * Update state and notify
     */
    private setState(state: STTState): void {
        if (this.state !== state) {
            this.state = state;
            this.onStateChange?.(state);
        }
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.abort();
        this.recognition = null;
    }
}

export default SpeechToText;
