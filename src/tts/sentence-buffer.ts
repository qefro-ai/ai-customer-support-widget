/**
 * Sentence Buffer for B2B TTS
 * 
 * Accumulates streaming text, detects sentence boundaries,
 * and applies B2B safety rules before allowing speech.
 */

export interface SentenceBufferConfig {
    /** Maximum words per sentence for speech (default: 40) */
    maxWordsPerSentence: number;
    /** Timeout in ms to flush buffer if no punctuation (default: 800) */
    flushTimeout: number;
    /** Max sentences spoken per assistant response (default: 20) */
    maxSentencesToSpeak: number;
    /** Custom unsafe patterns to filter */
    unsafePatterns?: RegExp[];
}

const DEFAULT_CONFIG: SentenceBufferConfig = {
    maxWordsPerSentence: 40,
    flushTimeout: 800,
    maxSentencesToSpeak: 20,
    unsafePatterns: [],
};

/** Default patterns that indicate filler/uncertainty - NOT suitable for B2B speech */
const DEFAULT_UNSAFE_PATTERNS: RegExp[] = [
    /let me check/i,
    /let me look/i,
    /one moment/i,
    /just a moment/i,
    /i think/i,
    /i believe/i,
    /maybe/i,
    /perhaps/i,
    /probably/i,
    /might be/i,
    /could be/i,
    /not sure/i,
    /i'm not certain/i,
    /sure!/i,
    /great question/i,
    /good question/i,
    /that's a great/i,
    /here's what/i,
    /here is what/i,
    /let me explain/i,
    /^(hi|hello|hey)[\s!.,]/i,
    /^sure[\s!.,]/i,
    /^okay[\s!.,]/i,
    /^alright[\s!.,]/i,
];

export type SentenceCallback = (sentence: string) => void;

export class SentenceBuffer {
    private buffer: string = '';
    private config: SentenceBufferConfig;
    private unsafePatterns: RegExp[];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private onSentence: SentenceCallback | null = null;
    private spokenCount: number = 0;
    private maxSentencesToSpeak: number;

    constructor(config: Partial<SentenceBufferConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.maxSentencesToSpeak = this.config.maxSentencesToSpeak;
        this.unsafePatterns = [
            ...DEFAULT_UNSAFE_PATTERNS,
            ...(this.config.unsafePatterns || []),
        ];
    }

    /**
     * Set callback for approved sentences
     */
    setOnSentence(callback: SentenceCallback): void {
        this.onSentence = callback;
    }

    /**
     * Add streaming text to buffer
     */
    append(text: string): void {
        this.buffer += text;
        this.resetFlushTimer();
        this.processSentences();
    }

    /**
     * Process and emit complete sentences
     */
    private processSentences(): void {
        const sentences = this.extractSentences();

        for (const sentence of sentences) {
            // Remove sentence from buffer
            const sentenceEnd = this.buffer.indexOf(sentence) + sentence.length;
            this.buffer = this.buffer.slice(sentenceEnd);

            // Apply safety rules and emit
            if (this.isSpeakable(sentence)) {
                this.emitSentence(sentence.trim());
            }
        }
    }

    /**
     * Extract complete sentences from buffer
     */
    private extractSentences(): string[] {
        // Latin + Indic danda + CJK punctuation
        const sentenceRegex = /[^.!?।？！]*[.!?।？！]+/g;
        const matches = this.buffer.match(sentenceRegex);
        return matches || [];
    }

    /**
     * Check if sentence is safe for B2B speech
     */
    isSpeakable(sentence: string): boolean {
        const trimmed = sentence.trim();

        // Empty or too short (allow short Indic phrases)
        if (trimmed.length < 4) return false;

        const words = trimmed.split(/\s+/).filter(w => w.length > 0);
        if (words.length > this.config.maxWordsPerSentence) return false;
        // Allow 1+ tokens for non-Latin scripts; require 2+ for Latin-heavy
        const hasNonLatin = /[^\u0000-\u007F]/.test(trimmed);
        if (!hasNonLatin && words.length < 2) return false;

        if (this.spokenCount >= this.maxSentencesToSpeak) return false;

        for (const pattern of this.unsafePatterns) {
            if (pattern.test(trimmed)) return false;
        }

        if (trimmed.endsWith('?') || trimmed.endsWith('？')) return false;

        return true;
    }

    /**
     * Emit approved sentence
     */
    private emitSentence(sentence: string): void {
        this.spokenCount++;
        if (this.onSentence) {
            this.onSentence(sentence);
        }
    }

    /**
     * Reset flush timer
     */
    private resetFlushTimer(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            this.flush();
        }, this.config.flushTimeout);
    }

    /**
     * Flush remaining buffer (for incomplete sentences)
     */
    flush(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        const remaining = this.buffer.trim();
        if (remaining.length > 0 && this.isSpeakable(remaining + '.')) {
            this.emitSentence(remaining);
        }
        this.buffer = '';
    }

    /**
     * Reset buffer (on new user message)
     */
    reset(): void {
        this.buffer = '';
        this.spokenCount = 0;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    /**
     * Get current buffer content (for debugging)
     */
    getBuffer(): string {
        return this.buffer;
    }
}

export default SentenceBuffer;
