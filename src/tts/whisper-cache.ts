/**
 * Persistent Cache API storage for Whisper STT assets (model, tokenizer, wasm).
 * Survives page reloads so the ~41MB TFLite model is not re-downloaded.
 */

export const WHISPER_CACHE_NAME = 'qefro-whisper-litert-v1';

export type CacheHitKind = 'hit' | 'miss';

async function openCache(): Promise<Cache | null> {
    try {
        if (typeof caches === 'undefined') return null;
        return await caches.open(WHISPER_CACHE_NAME);
    } catch {
        return null;
    }
}

/** Read a URL from Cache API, or null on miss / unsupported. */
export async function cacheMatch(url: string): Promise<ArrayBuffer | null> {
    const cache = await openCache();
    if (!cache) return null;
    try {
        const hit = await cache.match(url);
        if (!hit || !hit.ok) return null;
        return await hit.arrayBuffer();
    } catch {
        return null;
    }
}

/** Store bytes in Cache API under the given URL key. */
export async function cachePut(
    url: string,
    data: ArrayBuffer,
    contentType: string
): Promise<void> {
    const cache = await openCache();
    if (!cache) return;
    try {
        await cache.put(
            url,
            new Response(data.slice(0), {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': String(data.byteLength),
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            })
        );
    } catch (e) {
        console.warn('[WhisperCache] put failed:', e);
    }
}

/**
 * Fetch with Cache API: return cached bytes instantly, otherwise download
 * (with optional progress), store, and return.
 */
export async function fetchCached(
    url: string,
    opts: {
        contentType: string;
        onProgress?: (pct: number) => void;
        onSource?: (kind: CacheHitKind) => void;
    }
): Promise<Uint8Array> {
    const cached = await cacheMatch(url);
    if (cached) {
        opts.onSource?.('hit');
        opts.onProgress?.(100);
        return new Uint8Array(cached);
    }

    opts.onSource?.('miss');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    let data: ArrayBuffer;

    if (!res.body) {
        data = await res.arrayBuffer();
        opts.onProgress?.(100);
    } else {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0) {
                opts.onProgress?.(Math.min(99, Math.round((received / total) * 100)));
            }
        }
        const out = new Uint8Array(received);
        let offset = 0;
        for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
        }
        data = out.buffer;
        opts.onProgress?.(100);
    }

    await cachePut(url, data, opts.contentType);
    return new Uint8Array(data);
}
