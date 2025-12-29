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
function getConfig(): WidgetConfig {
    const script = document.currentScript as HTMLScriptElement;
    if (!script) {
        throw new Error('AI Widget: Script tag not found');
    }

    const token = script.dataset.token;
    if (!token) {
        throw new Error('AI Widget: data-token is required');
    }

    return {
        token,
        endpoint: script.dataset.endpoint || 'https://api.example.ai',
        theme: (script.dataset.theme as 'light' | 'dark') || 'light',
        position: (script.dataset.position as 'bottom-right' | 'bottom-left') || 'bottom-right',
        primaryColor: script.dataset.primaryColor || '#6366f1',
        welcomeMessage: script.dataset.welcomeMessage || 'Hi! How can I help you today?',
        // Optional workspace ID for scoped retrieval and system prompts
        workspaceId: script.dataset.workspaceId || undefined,
        // Optional JSON context passed via `data-context` on the script tag
        context: script.dataset.context ? JSON.parse(script.dataset.context) : undefined,
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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        try {
            const config = getConfig();
            injectStyles(config);
            new Widget(config);
        } catch (error) {
            console.error('AI Widget initialization failed:', error);
        }
    }
})();

// Export for programmatic use
export { Widget };
