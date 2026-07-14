/**
 * Minimal Whisper BPE tokenizer (decode-only) from HuggingFace tokenizer.json.
 */

import { fetchCached } from './whisper-cache';

const TOKENIZER_URL =
    'https://huggingface.co/openai/whisper-tiny/resolve/main/tokenizer.json';

export const DECODE_START_TOKEN_ID = 50258; // <|startoftranscript|>
export const DECODE_STOP_TOKEN_ID = 50257; // <|endoftext|>
export const TRANSCRIBE_TOKEN_ID = 50359; // <|transcribe|>
export const NO_TIMESTAMPS_TOKEN_ID = 50363; // <|notimestamps|>
export const FIRST_LANGUAGE_TOKEN_ID = 50259;
export const LAST_LANGUAGE_TOKEN_ID = 50357;

interface TokenizerJson {
    model: {
        vocab: Record<string, number>;
        merges?: string[] | Array<[string, string]>;
    };
    added_tokens?: Array<{ id: number; content: string; special?: boolean }>;
}

let idToToken: string[] | null = null;
let specialIds: Set<number> | null = null;
let charToByte: Map<string, number> | null = null;
let languageTokenIds: Map<string, number> | null = null;

/** GPT-2 / Whisper bytes_to_unicode reverse map (char → byte). */
function buildCharToByte(): Map<string, number> {
    const bs: number[] = [];
    for (let i = 33; i <= 126; i++) bs.push(i);
    for (let i = 161; i <= 172; i++) bs.push(i);
    for (let i = 174; i <= 255; i++) bs.push(i);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
        if (!bs.includes(b)) {
            bs.push(b);
            cs.push(256 + n);
            n++;
        }
    }
    const map = new Map<string, number>();
    for (let i = 0; i < bs.length; i++) {
        map.set(String.fromCharCode(cs[i]), bs[i]);
    }
    return map;
}

export async function loadWhisperTokenizer(
    onProgress?: (pct: number) => void
): Promise<void> {
    if (idToToken) return;

    charToByte = buildCharToByte();

    const bytes = await fetchCached(TOKENIZER_URL, {
        contentType: 'application/json',
        onProgress: (p) => onProgress?.(Math.round(p * 0.5)),
    });
    const json = JSON.parse(new TextDecoder().decode(bytes)) as TokenizerJson;
    onProgress?.(50);

    const maxId = Math.max(
        ...Object.values(json.model.vocab),
        ...(json.added_tokens?.map((t) => t.id) ?? [0])
    );
    idToToken = new Array(maxId + 1).fill('');
    specialIds = new Set<number>();
    languageTokenIds = new Map<string, number>();

    for (const [tok, id] of Object.entries(json.model.vocab)) {
        idToToken[id] = tok;
    }
    for (const t of json.added_tokens ?? []) {
        idToToken[t.id] = t.content;
        if (t.special || t.content.startsWith('<|')) {
            specialIds.add(t.id);
        }
        const language = /^<\|([a-z]{2,3})\|>$/.exec(t.content)?.[1];
        if (language && t.id >= FIRST_LANGUAGE_TOKEN_ID && t.id <= LAST_LANGUAGE_TOKEN_ID) {
            languageTokenIds.set(language, t.id);
        }
    }
    for (let id = 50257; id <= 50363; id++) specialIds.add(id);

    onProgress?.(100);
}

export function getWhisperLanguageTokenId(language?: string): number | undefined {
    if (!language || language === 'auto') return undefined;
    if (!languageTokenIds) throw new Error('Tokenizer not loaded');
    return languageTokenIds.get(language.toLowerCase().split(/[-_]/, 1)[0]);
}

export function decodeWhisperTokens(tokenIds: number[]): string {
    if (!idToToken || !charToByte || !specialIds) {
        throw new Error('Tokenizer not loaded');
    }

    let text = '';
    for (const id of tokenIds) {
        if (specialIds.has(id)) continue;
        const tok = idToToken[id];
        if (!tok) continue;
        text += tok;
    }

    // Byte-level BPE → UTF-8
    const bytes: number[] = [];
    for (const ch of text) {
        const b = charToByte.get(ch);
        if (b !== undefined) bytes.push(b);
        else {
            // Fallback: encode char as UTF-8 directly
            const encoded = new TextEncoder().encode(ch);
            for (const x of encoded) bytes.push(x);
        }
    }
    try {
        return new TextDecoder('utf-8', { fatal: false })
            .decode(Uint8Array.from(bytes))
            .trim();
    } catch {
        return text.trim();
    }
}
