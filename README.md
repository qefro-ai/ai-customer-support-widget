# @qefro-ai/widget

Embeddable AI customer-support chat widget for [Qefro](https://qefro.com).

## CDN (script tag)

```html
<script
  src="https://cdn.qefro.com/widget.js"
  data-token="YOUR_WIDGET_TOKEN"
  data-endpoint="https://api.qefro.com"
  data-theme="light"
  data-position="bottom-right"
  data-primary-color="#7c3aed"
  data-welcome-message="Hi! How can I help you today?">
</script>
```

Version-pinned (immutable cache):

```html
<script src="https://cdn.qefro.com/widget@1.1.0.js" data-token="..." data-endpoint="https://api.qefro.com"></script>
```

Or via jsDelivr after npm publish:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@qefro-ai/widget@1.1.0/dist/widget.iife.js"
  data-token="YOUR_WIDGET_TOKEN"
  data-endpoint="https://api.qefro.com">
</script>
```

`https://api.qefro.com/widget.js` redirects to the CDN for backwards compatibility.

### Script attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-token` | yes | Widget token from the Qefro portal |
| `data-endpoint` | no | API base URL (default `https://api.qefro.com`) |
| `data-theme` | no | `light` or `dark` |
| `data-position` | no | `bottom-right` or `bottom-left` |
| `data-primary-color` | no | Accent color |
| `data-welcome-message` | no | First assistant message |
| `data-workspace-id` | no | Scope retrieval to one workspace |
| `data-context` | no | JSON string of extra context |

## npm

```bash
npm install @qefro-ai/widget
```

```ts
import { Widget } from '@qefro-ai/widget';

const widget = new Widget({
  token: 'YOUR_WIDGET_TOKEN',
  endpoint: 'https://api.qefro.com',
  theme: 'light',
  position: 'bottom-right',
  primaryColor: '#7c3aed',
  welcomeMessage: 'Hi! How can I help you today?',
});

widget.open();
widget.setContext({ userId: 'user-123', email: 'user@example.com' });
```

## Development

```bash
npm install
npm run build   # emits dist/widget.iife.js, widget.js (ES), widget.umd.cjs
npm run dev
```

## Release

1. Bump version in `package.json`
2. Tag and push: `git tag v1.1.0 && git push origin v1.1.0`
3. GitHub Actions publishes to npm and pushes the CDN Docker image to GHCR

Requires repo secrets: `NPM_TOKEN`, and GHCR permissions for `GITHUB_TOKEN`.
