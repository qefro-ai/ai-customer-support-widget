/** Escape text before any markdown substitution. Model output is untrusted. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** https, http, or a same-origin path. Rejects javascript:, data:, and protocol-relative URLs. */
export function safeMediaUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 2048) return null;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        if (/[\s"'<>]/.test(trimmed)) return null;
        return trimmed;
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
}

export interface FormFieldCheck {
    input?: string | null;
    required?: boolean;
    value: string;
}

/** Client-side usability check. The server that receives the action remains authoritative. */
export function formFieldError(field: FormFieldCheck): string | null {
    const value = field.value.trim();
    if (field.required && !value) return 'Required';
    if (!value) return null;
    const kind = (field.input || 'text').toLowerCase();
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter an email address';
    if (kind === 'tel' && !/^[0-9+().\-\s]{6,}$/.test(value)) return 'Enter a phone number';
    if (kind === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return 'Enter a number';
    return null;
}

/** Markdown to HTML. Callers must still pass the result through DOMPurify. */
export function formatAssistantContent(content: string): string {
    let formatted = escapeHtml(content);
    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    formatted = formatMarkdownTables(formatted);
    formatted = formatted.replace(/^(?:\*|-)\s+(.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(?:<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    formatted = formatted
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        );
    formatted = linkifyBareUrls(formatted);
    const parts = formatted.split(/(<pre>[\s\S]*?<\/pre>|<div class="ai-widget-tool-card">[\s\S]*?<\/div>)/);
    return parts
        .map((part) => {
            if (part.startsWith('<pre>') || part.startsWith('<div class="ai-widget-tool-card">')) return part;
            return part.replace(/\n/g, '<br>');
        })
        .join('')
        .trim();
}

function linkifyBareUrls(html: string): string {
    const placeholders: string[] = [];
    const protect = (input: string, pattern: RegExp): string =>
        input.replace(pattern, (match) => {
            const token = `\u0000PH${placeholders.length}\u0000`;
            placeholders.push(match);
            return token;
        });

    let protectedHtml = protect(html, /<a\b[^>]*>[\s\S]*?<\/a>/gi);
    protectedHtml = protect(protectedHtml, /<pre>[\s\S]*?<\/pre>/gi);
    protectedHtml = protect(protectedHtml, /<code>[\s\S]*?<\/code>/gi);

    protectedHtml = protectedHtml.replace(/\bhttps?:\/\/[^\s<]+/gi, (raw) => {
        let href = raw;
        let trailing = '';
        while (/[.,;:!?]$/.test(href)) {
            trailing = href.slice(-1) + trailing;
            href = href.slice(0, -1);
        }
        const openParens = (href.match(/\(/g) || []).length;
        const closeParens = (href.match(/\)/g) || []).length;
        if (href.endsWith(')') && closeParens > openParens) {
            trailing = ')' + trailing;
            href = href.slice(0, -1);
        }
        if (!safeMediaUrl(href)) return raw;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${trailing}`;
    });

    return protectedHtml.replace(/\u0000PH(\d+)\u0000/g, (_, index: string) => placeholders[Number(index)] ?? '');
}

function formatMarkdownTables(content: string): string {
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let i = 0;

    const splitRow = (line: string): string[] => {
        const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((c) => c.trim());
    };
    const isSep = (line: string): boolean => {
        const cells = splitRow(line);
        return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
    };

    while (i < lines.length) {
        const headerLine = lines[i];
        const sepLine = lines[i + 1];
        if (
            headerLine &&
            sepLine &&
            headerLine.includes('|') &&
            isSep(sepLine) &&
            splitRow(headerLine).length >= 2
        ) {
            const headers = splitRow(headerLine);
            const rows: string[][] = [];
            let j = i + 2;
            while (j < lines.length && lines[j].includes('|') && !isSep(lines[j])) {
                const cells = splitRow(lines[j]);
                if (cells.some((c) => c.length > 0)) {
                    rows.push(headers.map((_, idx) => cells[idx] ?? ''));
                }
                j++;
            }
            if (rows.length > 0) {
                const thead = headers
                    .map((h) => `<th scope="col">${h.replace(/`([^`]+)`/g, '$1')}</th>`)
                    .join('');
                const tbody = rows
                    .map(
                        (row) =>
                            `<tr>${row
                                .map((c, ci) => {
                                    const text = c.replace(/`([^`]+)`/g, '$1');
                                    return ci === 0
                                        ? `<td scope="row"><code>${text}</code></td>`
                                        : `<td>${text}</td>`;
                                })
                                .join('')}</tr>`,
                    )
                    .join('');
                out.push(
                    `<div class="ai-widget-tool-card"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`,
                );
                i = j;
                continue;
            }
        }
        out.push(lines[i]);
        i++;
    }
    return out.join('\n');
}
