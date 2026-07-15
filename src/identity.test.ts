/**
 * Identity transport helpers — unit tests (node:test).
 * Run: npx tsx --test src/identity.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildIdentityTransport,
    normalizeIdentity,
    sameOriginCredentials,
} from './identity';

describe('normalizeIdentity', () => {
    it('trims fields', () => {
        const id = normalizeIdentity({
            id: '  u1  ',
            email: ' a@b.com ',
            auth: { mode: 'jwt', token: ' tok ' },
        });
        assert.equal(id.id, 'u1');
        assert.equal(id.email, 'a@b.com');
        assert.equal(id.auth?.token, 'tok');
    });
});

describe('buildIdentityTransport', () => {
    it('returns empty for anonymous', () => {
        const t = buildIdentityTransport(null);
        assert.equal(t.identityBody, null);
        assert.deepEqual(t.headers, {});
    });

    it('sets JWT header and ws field', () => {
        const t = buildIdentityTransport(
            normalizeIdentity({
                id: 'u1',
                email: 'u@example.com',
                auth: { mode: 'jwt', token: 'abc.def' },
            })
        );
        assert.equal(t.headers['X-End-User-Token'], 'abc.def');
        assert.equal(t.wsAuthFields.endUserToken, 'abc.def');
        assert.equal(t.identityBody?.authMode, 'jwt');
        assert.ok(!('X-End-User-Session' in t.headers));
    });

    it('sets session header', () => {
        const t = buildIdentityTransport(
            normalizeIdentity({
                id: 'u1',
                auth: { mode: 'session', token: 'sess-9' },
            })
        );
        assert.equal(t.headers['X-End-User-Session'], 'sess-9');
        assert.equal(t.wsAuthFields.endUserSession, 'sess-9');
    });

    it('never puts token in identityBody', () => {
        const t = buildIdentityTransport(
            normalizeIdentity({
                id: 'u1',
                auth: { mode: 'jwt', token: 'secret' },
            })
        );
        assert.ok(!JSON.stringify(t.identityBody).includes('secret'));
    });
});

describe('sameOriginCredentials', () => {
    it('returns omit without window', () => {
        assert.equal(sameOriginCredentials('https://api.example.com'), 'omit');
    });
});
