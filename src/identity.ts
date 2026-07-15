/**
 * End-user identity for Business Tools (host app owns auth — Qefro does not).
 */

export type EndUserAuthMode = 'jwt' | 'session' | 'none';

export interface WidgetAuthConfig {
    mode: EndUserAuthMode;
    /** JWT or session token/id from the host application */
    token?: string;
}

export interface WidgetIdentity {
    id: string;
    email?: string;
    name?: string;
    auth?: WidgetAuthConfig;
}

export interface IdentityTransport {
    /** Safe profile fields for the API body (never includes tokens) */
    identityBody: {
        id: string;
        email?: string;
        name?: string;
        authMode: EndUserAuthMode;
    } | null;
    /** Headers for HTTP (SSE/REST). Empty for anonymous. */
    headers: Record<string, string>;
    /** Extra fields for WebSocket chat body (request-scoped secrets). */
    wsAuthFields: {
        endUserToken?: string;
        endUserSession?: string;
    };
}

export function normalizeIdentity(input: WidgetIdentity): WidgetIdentity {
    const mode = input.auth?.mode ?? 'none';
    return {
        id: String(input.id ?? '').trim(),
        email: input.email?.trim() || undefined,
        name: input.name?.trim() || undefined,
        auth: {
            mode,
            token: input.auth?.token?.trim() || undefined,
        },
    };
}

export function buildIdentityTransport(identity: WidgetIdentity | null): IdentityTransport {
    if (!identity || !identity.id) {
        return { identityBody: null, headers: {}, wsAuthFields: {} };
    }
    const mode = identity.auth?.mode ?? 'none';
    const token = identity.auth?.token;
    const headers: Record<string, string> = {};
    const wsAuthFields: IdentityTransport['wsAuthFields'] = {};

    if (mode === 'jwt' && token) {
        headers['X-End-User-Token'] = token;
        wsAuthFields.endUserToken = token;
    } else if (mode === 'session' && token) {
        headers['X-End-User-Session'] = token;
        wsAuthFields.endUserSession = token;
    }

    return {
        identityBody: {
            id: identity.id,
            email: identity.email,
            name: identity.name,
            authMode: mode,
        },
        headers,
        wsAuthFields,
    };
}

/** Use credentials:include only when talking to the same origin as the page. */
export function sameOriginCredentials(endpoint: string): RequestCredentials {
    try {
        if (typeof window === 'undefined' || !window.location?.origin) return 'omit';
        const apiOrigin = new URL(endpoint, window.location.href).origin;
        return apiOrigin === window.location.origin ? 'include' : 'omit';
    } catch {
        return 'omit';
    }
}
