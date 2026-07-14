/**
 * Qefro AI Chat Widget
 *
 * Script embed:
 * <script src="https://cdn.qefro.com/widget.js"
 *         data-token="YOUR_WIDGET_TOKEN"
 *         data-endpoint="https://api.qefro.com"
 *         data-theme="light"
 *         data-position="bottom-right">
 * </script>
 *
 * Programmatic:
 * import { Widget } from '@qefro-ai/widget';
 */

import { Widget } from './widget';
import { injectStyles, sanitizeCssColor } from './styles';

function tryParseJSON(value: string): Record<string, any> | undefined {
    try {
        return JSON.parse(value);
    } catch {
        console.error('AI Widget: Invalid JSON in data-context attribute');
        return undefined;
    }
}

function findEmbedScript(): HTMLScriptElement | null {
    const candidates: Array<HTMLScriptElement | null> = [
        document.currentScript as HTMLScriptElement | null,
        document.getElementById('qefro-widget-script') as HTMLScriptElement | null,
        document.querySelector('script[data-token][src*="widget"]') as HTMLScriptElement | null,
        document.querySelector('script[id="qefro-widget-script"]') as HTMLScriptElement | null,
    ];
    for (const el of candidates) {
        if (el?.dataset?.token) return el;
    }
    return null;
}

function getConfig(scriptElement: HTMLScriptElement): WidgetConfig {
    const token = scriptElement.dataset.token;
    if (!token) {
        throw new Error('AI Widget: data-token is required');
    }

    return {
        token,
        endpoint: scriptElement.dataset.endpoint || 'https://api.qefro.com',
        theme: (scriptElement.dataset.theme as 'light' | 'dark') || 'light',
        position: (scriptElement.dataset.position as 'bottom-right' | 'bottom-left') || 'bottom-right',
        primaryColor: sanitizeCssColor(scriptElement.dataset.primaryColor, '#7c3aed'),
        welcomeMessage: scriptElement.dataset.welcomeMessage || 'Hi! How can I help you today?',
        workspaceId: scriptElement.dataset.workspaceId || undefined,
        context: scriptElement.dataset.context ? tryParseJSON(scriptElement.dataset.context) : undefined,
    };
}

export interface WidgetConfig {
    token: string;
    endpoint: string;
    theme: 'light' | 'dark';
    position: 'bottom-right' | 'bottom-left';
    primaryColor: string;
    welcomeMessage: string;
    workspaceId?: string;
    context?: Record<string, any>;
}

function autoInit(scriptElement: HTMLScriptElement | null): void {
    if (!scriptElement) return;
    try {
        const config = getConfig(scriptElement);
        injectStyles(config);
        new Widget(config);
    } catch (error) {
        console.error('AI Widget initialization failed:', error);
    }
}

// Auto-initialize only for <script data-token> embeds — not npm imports
(function () {
    const embedScript = findEmbedScript();
    if (!embedScript) return;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => autoInit(findEmbedScript()));
    } else {
        autoInit(embedScript);
    }
})();

export { Widget, injectStyles };
