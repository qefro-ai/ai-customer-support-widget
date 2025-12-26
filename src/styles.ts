/**
 * Widget styles injection
 */

import type { WidgetConfig } from './index';

export function injectStyles(config: WidgetConfig): void {
    const style = document.createElement('style');
    style.textContent = `
    #ai-widget-container {
      --ai-primary: ${config.primaryColor};
      --ai-primary-dark: color-mix(in srgb, ${config.primaryColor} 85%, black);
      --ai-bg: ${config.theme === 'dark' ? '#1e1e2e' : '#ffffff'};
      --ai-bg-secondary: ${config.theme === 'dark' ? '#2a2a3e' : '#f5f5f7'};
      --ai-text: ${config.theme === 'dark' ? '#e4e4e7' : '#18181b'};
      --ai-text-secondary: ${config.theme === 'dark' ? '#a1a1aa' : '#71717a'};
      --ai-border: ${config.theme === 'dark' ? '#3f3f46' : '#e4e4e7'};
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #ai-widget-container.bottom-right {
      bottom: 20px;
      right: 20px;
    }

    #ai-widget-container.bottom-left {
      bottom: 20px;
      left: 20px;
    }

    .ai-widget-trigger {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--ai-primary);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .ai-widget-trigger:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    }

    #ai-widget-container.open .ai-widget-trigger {
      display: none;
    }

    .ai-widget-panel {
      display: none;
      flex-direction: column;
      width: 380px;
      height: 550px;
      background: var(--ai-bg);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      border: 1px solid var(--ai-border);
    }

    #ai-widget-container.open .ai-widget-panel {
      display: flex;
      animation: ai-slide-in 0.3s ease;
    }

    @keyframes ai-slide-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .ai-widget-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: var(--ai-primary);
      color: white;
      font-weight: 600;
      font-size: 16px;
    }

    .ai-widget-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      opacity: 0.8;
      transition: opacity 0.2s;
      padding: 4px;
    }

    .ai-widget-close:hover {
      opacity: 1;
    }

    .ai-widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ai-widget-message {
      max-width: 85%;
      animation: ai-message-in 0.2s ease;
    }

    @keyframes ai-message-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .ai-widget-message.user {
      align-self: flex-end;
    }

    .ai-widget-message.assistant {
      align-self: flex-start;
    }

    .ai-widget-message-content {
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .ai-widget-message.user .ai-widget-message-content {
      background: var(--ai-primary);
      color: white;
      border-bottom-right-radius: 4px;
    }

    .ai-widget-message.assistant .ai-widget-message-content {
      background: var(--ai-bg-secondary);
      color: var(--ai-text);
      border-bottom-left-radius: 4px;
    }

    .ai-widget-message-content code {
      background: rgba(0, 0, 0, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
    }

    .ai-widget-typing {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
      background: var(--ai-bg-secondary);
      border-radius: 16px;
      width: fit-content;
      align-self: flex-start;
    }

    .ai-widget-typing span {
      width: 8px;
      height: 8px;
      background: var(--ai-text-secondary);
      border-radius: 50%;
      animation: ai-typing 1.4s infinite;
    }

    .ai-widget-typing span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .ai-widget-typing span:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes ai-typing {
      0%, 60%, 100% {
        transform: translateY(0);
        opacity: 0.5;
      }
      30% {
        transform: translateY(-4px);
        opacity: 1;
      }
    }

    .ai-widget-input-container {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--ai-border);
      background: var(--ai-bg);
    }

    .ai-widget-input {
      flex: 1;
      border: 1px solid var(--ai-border);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 14px;
      resize: none;
      font-family: inherit;
      background: var(--ai-bg);
      color: var(--ai-text);
      outline: none;
      transition: border-color 0.2s;
    }

    .ai-widget-input:focus {
      border-color: var(--ai-primary);
    }

    .ai-widget-input::placeholder {
      color: var(--ai-text-secondary);
    }

    .ai-widget-send {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--ai-primary);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .ai-widget-send:hover {
      background: var(--ai-primary-dark);
    }

    /* Scrollbar styling */
    .ai-widget-messages::-webkit-scrollbar {
      width: 6px;
    }

    .ai-widget-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .ai-widget-messages::-webkit-scrollbar-thumb {
      background: var(--ai-border);
      border-radius: 3px;
    }

    /* Mobile responsive */
    @media (max-width: 420px) {
      .ai-widget-panel {
        width: calc(100vw - 40px);
        height: calc(100vh - 120px);
      }
    }
  `;
    document.head.appendChild(style);
}
