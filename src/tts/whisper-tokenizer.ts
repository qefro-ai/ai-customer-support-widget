/**
 * Minimal Whisper BPE tokenizer (decode-only) from HuggingFace tokenizer.json.
 */

const TOKENIZER_URL =
    'https://huggingface.co/openai/whisper-tiny/resolve/main/tokenizer.json';

export const DECODE_START_TOKEN_ID = 50258; // <|startoftranscript|>
export const DECODE_STOP_TOKEN_ID = 50257; // <|endoftext|>

interface TokenizerJson {
    model: {
        vocab: Record<string, number>;
        merges?: string[] | Array<[string, string]>;
    };
    added_tokens?: Array<{ id: number; content: string; special?: boolean }>;
}

let idToToken: string[] | null = null;
let specialIds: Set<number> | null = null;
let byteDecoder: string[] | null = null;

function buildByteDecoder(): string[] {
    // GPT-2 / Whisper bytes_to_unicode reverse map
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
    const decoder: string[] = new Array(256);
    // Map unicode codepoint char → byte. We need char → byte for decoding tokens.
    // Actually we need: token string chars → bytes. bytes_to_unicode maps byte→char.
    const byteToChar = new Map<number, string>();
    for (let i = 0; i < bs.length; i++) {
        byteToChar.set(bs[i], String.fromCharCode(cs[i]));
    }
    const charToByte = new Map<string, number>();
    for (const [b, ch] of byteToChar) charToByte.set(ch, b);

    // Store as parallel arrays keyed by char code of the unicode char used in vocab
    // We'll use a Map in decode instead — keep a module-level map.
    (buildByteDecoder as any)._charToByte = charToByte;
    return decoder;
}

let charToByte: Map<string, number> | null = null;

export async function loadWhisperTokenizer(
    onProgress?: (pct: number) => void
): Promise<void> {
    if (idToToken) return;

    buildByteDecoder();
    charToByte = (buildByteDecoder as any)._charToByte as Map<string, number>;

    const res = await fetch(TOKENIZER_URL);
    if (!res.ok) throw new Error(`Failed to fetch tokenizer: ${res.status}`);
    const json = (await res.json()) as TokenizerJson;
    onProgress?.(50);

    const maxId = Math.max(
        ...Object.values(json.model.vocab),
        ...(json.added_tokens?.map((t) => t.id) ?? [0])
    );
    idToToken = new Array(maxId + 1).fill('');
    specialIds = new Set<number>();

    for (const [tok, id] of Object.entries(json.model.vocab)) {
        idToToken[id] = tok;
    }
    for (const t of json.added_tokens ?? []) {
        idToToken[t.id] = t.content;
        if (t.special || t.content.startsWith('<|')) {
            specialIds.add(t.id);
        }
    }
    // Mark common whisper specials
    for (let id = 50257; id <= 50363; id++) specialIds.add(id);

    onProgress?.(100);
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
