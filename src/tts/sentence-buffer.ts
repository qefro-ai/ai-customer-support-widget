/**
 * Sentence Buffer for B2B TTS
 * 
 * Accumulates streaming text, detects sentence boundaries,
 * and applies B2B safety rules before allowing speech.
 */

export interface SentenceBufferConfig {
    /** Maximum words per sentence for speech (default: 20) */
    maxWordsPerSentence: number;
    /** Timeout in ms to flush buffer if no punctuation (default: 3000) */
    flushTimeout: number;
    /** Custom unsafe patterns to filter */
    unsafePatterns?: RegExp[];
}

const DEFAULT_CONFIG: SentenceBufferConfig = {
    maxWordsPerSentence: 20,
    flushTimeout: 3000,
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
    private maxSentencesToSpeak: number = 2; // Only speak first 2 sentences per response

    constructor(config: Partial<SentenceBufferConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
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
        // Match sentences ending with . ! or ?
        // Include the preceding text to capture full sentence
        const sentenceRegex = /[^.!?]*[.!?]+/g;
        const matches = this.buffer.match(sentenceRegex);
        return matches || [];
    }

    /**
     * Check if sentence is safe for B2B speech
     */
    isSpeakable(sentence: string): boolean {
        const trimmed = sentence.trim();

        // Empty or too short
        if (trimmed.length < 10) return false;

        // Check word count
        const words = trimmed.split(/\s+/).filter(w => w.length > 0);
        if (words.length > this.config.maxWordsPerSentence) return false;
        if (words.length < 3) return false;

        // Check max sentences per response
        if (this.spokenCount >= this.maxSentencesToSpeak) return false;

        // Check unsafe patterns
        for (const pattern of this.unsafePatterns) {
            if (pattern.test(trimmed)) return false;
        }

        // Check for question marks (don't repeat questions back)
        if (trimmed.endsWith('?')) return false;

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
