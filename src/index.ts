/**
 * B2B AI Chat Widget
 * 
 * One-line embed:
 * <script src="https://cdn.example.ai/widget.js" 
 *         data-token="YOUR_WIDGET_TOKEN"
 *         data-theme="light"
 *         data-position="bottom-right">
 * </script>
 */

import { Widget } from './widget';
import { injectStyles } from './styles';

// Get configuration from script tag
function getConfig(scriptElement: HTMLScriptElement): WidgetConfig {
    if (!scriptElement) {
        throw new Error('AI Widget: Script tag not found');
    }

    const token = scriptElement.dataset.token;
    if (!token) {
        throw new Error('AI Widget: data-token is required');
    }

    return {
        token,
        endpoint: scriptElement.dataset.endpoint || 'https://api.example.ai',
        theme: (scriptElement.dataset.theme as 'light' | 'dark') || 'light',
        position: (scriptElement.dataset.position as 'bottom-right' | 'bottom-left') || 'bottom-right',
        primaryColor: scriptElement.dataset.primaryColor || '#6366f1',
        welcomeMessage: scriptElement.dataset.welcomeMessage || 'Hi! How can I help you today?',
        // Optional workspace ID for scoped retrieval and system prompts
        workspaceId: scriptElement.dataset.workspaceId || undefined,
        // Optional JSON context passed via `data-context` on the script tag
        context: scriptElement.dataset.context ? JSON.parse(scriptElement.dataset.context) : undefined,
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

// Auto-initialize
(function () {
    // Capture the script element synchronously while it's executing
    const currentScript = document.currentScript as HTMLScriptElement;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init(currentScript));
    } else {
        init(currentScript);
    }

    function init(scriptElement: HTMLScriptElement) {
        try {
            const config = getConfig(scriptElement);
            injectStyles(config);
            new Widget(config);
        } catch (error) {
            console.error('AI Widget initialization failed:', error);
        }
    }
})();

// Export for programmatic use
export { Widget };
