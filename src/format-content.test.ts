import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, formFieldError, formatAssistantContent, safeMediaUrl } from './format-content.ts';

test('malicious html stays escaped', () => {
    const html = formatAssistantContent('<script>alert(1)</script>\n[click](javascript:alert(1))');
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes('javascript:'), true);
    assert.equal(html.includes('href="javascript:'), false);
    assert.match(html, /&lt;script&gt;/);
});

test('markdown links and tables render without raw html', () => {
    const html = formatAssistantContent(
        '**Order** [track](https://example.com/o/1)\n\n| Item | Qty |\n| --- | --- |\n| Mug | 2 |',
    );
    assert.match(html, /<strong>Order<\/strong>/);
    assert.match(html, /href="https:\/\/example.com\/o\/1"/);
    assert.match(html, /<th scope="col">Item<\/th>/);
    assert.match(html, /<td scope="row"><code>Mug<\/code><\/td>/);
    assert.match(html, /Mug/);
    assert.equal(html.includes('<img'), false);
});

test('streaming-sized unicode and rtl text is preserved', () => {
    const source = 'الطلب 1042\n📦 ready';
    const html = formatAssistantContent(source);
    assert.match(html, /الطلب 1042/);
    assert.match(html, /📦 ready/);
    assert.equal(escapeHtml(source).includes('<'), false);
});

test('media urls reject scripts and protocol-relative values', () => {
    assert.equal(safeMediaUrl('javascript:alert(1)'), null);
    assert.equal(safeMediaUrl('data:text/html,hi'), null);
    assert.equal(safeMediaUrl('//cdn.example/a.png'), null);
    assert.equal(safeMediaUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
    assert.equal(safeMediaUrl('/media/a.png'), '/media/a.png');
});

test('form checks block empty required fields and bad emails', () => {
    assert.equal(formFieldError({ required: true, value: '  ' }), 'Required');
    assert.equal(formFieldError({ input: 'email', required: true, value: 'not-an-email' }), 'Enter an email address');
    assert.equal(formFieldError({ input: 'email', required: true, value: 'a@b.co' }), null);
    assert.equal(formFieldError({ input: 'number', value: '12' }), null);
});
