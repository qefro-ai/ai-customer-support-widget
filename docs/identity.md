# Widget Identity & Authentication

Qefro is **not** an authentication provider. Your application owns login, logout, JWT issuance, session cookies, and authorization. The Widget SDK only forwards verified identity so Business Tools can call your APIs as the end user (`END_USER_IDENTITY`).

## Anonymous Visitor

Do nothing special. Never call `identify()`.

```ts
const widget = new Widget({
  token: 'YOUR_WIDGET_TOKEN',
  endpoint: 'https://api.qefro.com',
});
```

Tools marked **Allow from public chat** may still run. Tools that require end-user identity will not.

## Authenticated Visitor

Call `identify()` after your app knows who is signed in.

```ts
widget.identify({
  id: user.id,
  email: user.email,
  name: user.name,
  auth: {
    mode: 'jwt', // or 'session' | 'none'
    token: customerJwt,
  },
});
```

## JWT Authentication

1. Your backend issues a JWT for the signed-in user.
2. Pass it as `auth: { mode: 'jwt', token }`.
3. The SDK sends `X-End-User-Token` on HTTP and `endUserToken` on WebSocket messages.
4. Business Tools with auth mode `END_USER_IDENTITY` forward `Authorization: Bearer <token>` to your API.

**Never** put your Qefro widget token or tenant API keys in the JWT for the widget.

## Session Authentication

Pass a session id/token your app understands:

```ts
widget.identify({
  id: user.id,
  auth: { mode: 'session', token: sessionId },
});
```

The SDK sends `X-End-User-Session`. Tools with `END_USER_IDENTITY` forward `X-Session-Id`.

`credentials: 'include'` is used only when the widget `endpoint` is **same-origin** as the page (self-hosted API). Cross-origin SaaS cannot forward your first-party cookies to `api.qefro.com`.

## Token Refresh

```ts
widget.setAuthToken(freshJwt);
```

Updates the JWT without restarting the widget. Prefer calling this from your refresh-token flow.

## Logout

```ts
await widget.clearIdentity();
```

- Clears in-memory identity and auth token
- Notifies Qefro to clear conversation variables for the current conversation
- Keeps the anonymous visitor session so chat history continuity is preserved

## setContext vs identify

| API | Purpose |
|-----|---------|
| `setContext({ page, productId, … })` | Marketing / page context for RAG/routing |
| `identify({ id, email, auth })` | End-user identity for Business Tools |

Legacy `setContext({ userId, email })` still works as opaque context but is **not** used for tool auth.

## Security Model

- Never expose tenant API keys, secrets, passwords, or private keys in the widget
- JWTs are request-scoped; Qefro does not persist end-user JWTs in Postgres
- JWTs are never written to tool execution logs (URL query redaction includes `jwt` / `token`)
- Host app must mint short-lived JWTs and rotate on logout

## Developer Guide

1. Embed the widget (script or `@qefro-ai/widget`)
2. After host login, call `identify()`
3. On token refresh, call `setAuthToken()`
4. On logout, call `clearIdentity()`
5. In the portal, set tool auth to **End-User Identity** for APIs that need the user JWT/session
6. Optionally require preconditions (`require_authenticated`) on those tools

## Framework examples

### React

```tsx
useEffect(() => {
  if (!user) return;
  widget.identify({
    id: user.id,
    email: user.email,
    auth: { mode: 'jwt', token: accessToken },
  });
  return () => { void widget.clearIdentity(); };
}, [user, accessToken]);
```

### Next.js (App Router client)

```tsx
'use client';
// After session from next-auth / your auth:
widget.identify({
  id: session.user.id,
  email: session.user.email!,
  auth: { mode: 'jwt', token: session.accessToken },
});
```

### Vue

```ts
watch(user, (u) => {
  if (!u) { void widget.clearIdentity(); return; }
  widget.identify({
    id: u.id,
    auth: { mode: 'jwt', token: u.token },
  });
});
```

### Angular

```ts
this.auth.user$.subscribe((u) => {
  if (!u) { void this.widget.clearIdentity(); return; }
  this.widget.identify({
    id: u.id,
    auth: { mode: 'jwt', token: u.accessToken },
  });
});
```

### Laravel (Blade + JWT from your API)

```html
script type="module"
import { Widget } from 'https://cdn.qefro.com/widget.js'; // or npm
const widget = new Widget({ token: '...', endpoint: '...' });
widget.identify({
  id: @json(auth()->id()),
  email: @json(auth()->user()?->email),
  auth: { mode: 'jwt', token: @json($apiJwt) },
});
```

### Django

Pass a short-lived JWT from your view template, then:

```js
widget.identify({
  id: '{{ user.pk }}',
  email: '{{ user.email }}',
  auth: { mode: 'jwt', token: '{{ user_api_jwt }}' },
});
```

### Spring Boot

After your SPA receives the access token from `/oauth2/token`, call `identify()` with `mode: 'jwt'`.

### Express

```js
// After passport / your session middleware exposes req.user + jwt
res.render('app', { userId: req.user.id, jwt: issueWidgetJwt(req.user) });
```

### ASP.NET

```js
widget.identify({
  id: window.__user.id,
  auth: { mode: 'jwt', token: window.__accessToken },
});
```
