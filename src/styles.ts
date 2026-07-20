/**
 * Widget styles injection
 */

import type { WidgetConfig } from './index';

export function injectStyles(config: WidgetConfig): void {
  const existing = document.getElementById('ai-widget-styles') as HTMLStyleElement | null;
  if (existing) {
    // Refresh CSS variables when remounting with a new theme/color
    existing.textContent = buildStyles(config);
    return;
  }

  const style = document.createElement('style');
  style.id = 'ai-widget-styles';
  style.textContent = buildStyles(config);
  document.head.appendChild(style);
}

function buildStyles(config: WidgetConfig): string {
  const primary = sanitizeCssColor(config.primaryColor);
  return `
    #ai-widget-container {
      --ai-primary: ${primary};
      --ai-primary-dark: color-mix(in srgb, ${primary} 85%, black);
      --ai-bg: ${config.theme === 'dark' ? 'rgba(30, 30, 46, 0.92)' : 'rgba(255, 255, 255, 0.92)'};
      --ai-bg-secondary: ${config.theme === 'dark' ? 'rgba(42, 42, 62, 0.5)' : 'rgba(245, 245, 247, 0.7)'};
      --ai-text: ${config.theme === 'dark' ? '#e4e4e7' : '#18181b'};
      --ai-text-secondary: ${config.theme === 'dark' ? '#a1a1aa' : '#71717a'};
      --ai-border: ${config.theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'};
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #ai-widget-container.bottom-right {
      bottom: 20px;
      bottom: calc(env(safe-area-inset-bottom) + 20px);
      right: 20px;
      right: calc(env(safe-area-inset-right) + 20px);
    }

    #ai-widget-container.bottom-left {
      bottom: 20px;
      bottom: calc(env(safe-area-inset-bottom) + 20px);
      left: 20px;
      left: calc(env(safe-area-inset-left) + 20px);
    }

    .ai-widget-trigger {
      position: relative;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--ai-primary), var(--ai-primary-dark));
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 0 15px color-mix(in srgb, var(--ai-primary) 30%, transparent);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(12px);
    }

    .ai-widget-trigger:hover {
      transform: scale(1.05) translateY(-2px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22), 0 0 25px color-mix(in srgb, var(--ai-primary) 45%, transparent);
    }

    .ai-widget-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      background: #ef4444;
      color: white;
      font-size: 11px;
      font-weight: 600;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
      animation: ai-badge-pulse 2s ease-in-out infinite;
    }

    @keyframes ai-badge-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }

    #ai-widget-container.open .ai-widget-trigger {
      display: none;
    }

    .ai-widget-panel {
      display: none;
      flex-direction: column;
      width: min(380px, calc(100vw - 32px));
      height: min(550px, calc(100dvh - 104px));
      max-height: calc(100dvh - 104px);
      background: var(--ai-bg);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
      overflow: hidden;
      border: 1px solid var(--ai-border);
      backdrop-filter: blur(20px);
      box-sizing: border-box;
    }

    #ai-widget-container.open .ai-widget-panel {
      display: flex;
      animation: ai-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes ai-slide-in {
      from {
        opacity: 0;
        transform: translateY(20px) scale(0.96);
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
      background: linear-gradient(135deg, var(--ai-primary), var(--ai-primary-dark));
      color: white;
      font-weight: 600;
      font-size: 16px;
    }

    .ai-widget-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ai-widget-tabs {
      display: flex;
      gap: 4px;
      padding: 8px 12px 0;
      background: var(--ai-bg);
      border-bottom: 1px solid var(--ai-border);
    }

    .ai-widget-tab {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--ai-text-secondary);
      font-size: 13px;
      font-weight: 600;
      padding: 8px 10px;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .ai-widget-tab.active {
      color: var(--ai-primary);
      background: var(--ai-bg-secondary);
    }

    .ai-widget-inbox-badge {
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--ai-primary);
      color: white;
      font-size: 10px;
      font-weight: 700;
      align-items: center;
      justify-content: center;
    }

    .ai-widget-inbox-panel {
      display: none;
      flex: 1;
      overflow-y: auto;
      background: var(--ai-bg);
    }

    #ai-widget-container.inbox-open .ai-widget-messages,
    #ai-widget-container.inbox-open .ai-widget-input-container {
      display: none;
    }

    #ai-widget-container.inbox-open .ai-widget-inbox-panel {
      display: flex;
      flex-direction: column;
    }

    .ai-widget-inbox-list {
      display: flex;
      flex-direction: column;
      padding: 8px;
      gap: 6px;
    }

    .ai-widget-inbox-empty {
      color: var(--ai-text-secondary);
      font-size: 13px;
      line-height: 1.4;
      padding: 24px 16px;
      text-align: center;
    }

    .ai-widget-inbox-item {
      position: relative;
      text-align: left;
      border: 1px solid var(--ai-border);
      background: var(--ai-bg-secondary);
      color: var(--ai-text);
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
    }

    .ai-widget-inbox-item:hover,
    .ai-widget-inbox-item.active {
      border-color: color-mix(in srgb, var(--ai-primary) 45%, var(--ai-border));
      background: color-mix(in srgb, var(--ai-primary) 8%, var(--ai-bg-secondary));
    }

    .ai-widget-inbox-item-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .ai-widget-inbox-item-preview {
      font-size: 12px;
      color: var(--ai-text-secondary);
      line-height: 1.35;
    }

    .ai-widget-inbox-item-unread {
      position: absolute;
      top: 10px;
      right: 10px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--ai-primary);
      color: white;
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ai-widget-voice {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s, transform 0.2s;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ai-widget-voice:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .ai-widget-voice[aria-pressed="true"] {
      opacity: 1;
    }

    .ai-widget-voice.loading {
      animation: ai-pulse 1s ease-in-out infinite;
    }

    .ai-widget-voice.speaking {
      animation: ai-pulse 0.6s ease-in-out infinite;
    }

    .ai-widget-voice.error {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @keyframes ai-pulse {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; }
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
      position: relative;
    }

    .ai-widget-message-copy-btn {
      position: absolute;
      bottom: -12px;
      right: 0;
      background: var(--ai-bg-primary);
      border: 1px solid var(--ai-border);
      color: var(--ai-text-muted);
      border-radius: 4px;
      padding: 4px;
      cursor: pointer;
      opacity: 0;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }

    .ai-widget-message.assistant:hover .ai-widget-message-copy-btn {
      opacity: 1;
    }

    @media (hover: none) {
      .ai-widget-message-copy-btn {
        opacity: 0.85;
      }
    }

    .ai-widget-message-copy-btn:hover {
      color: var(--ai-primary);
      border-color: var(--ai-primary);
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
      unicode-bidi: plaintext;
      text-align: start;
    }

    .ai-widget-message.user .ai-widget-message-content {
      background: linear-gradient(135deg, var(--ai-primary), var(--ai-primary-dark));
      color: white;
      border-bottom-right-radius: 4px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.05);
    }

    .ai-widget-message.assistant .ai-widget-message-content {
      background: var(--ai-bg-secondary);
      color: var(--ai-text);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--ai-border);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.02);
    }

    .ai-widget-message-content code {
      background: rgba(0, 0, 0, 0.1);
      padding: 2px 4px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
    }

    .ai-widget-message-content pre {
      background: rgba(0, 0, 0, 0.1);
      padding: 12px;
      border-radius: 8px;
      margin: 8px 0;
      overflow-x: auto;
      font-family: 'SF Mono', Monaco, monospace;
    }

    .ai-widget-message-content pre code {
      background: none;
      padding: 0;
      display: block;
      white-space: pre;
    }

    .ai-widget-message-content ul {
      margin: 8px 0;
      padding-left: 20px;
    }

    .ai-widget-message-content li {
      margin-bottom: 4px;
    }

    .ai-widget-message-content a {
      color: var(--ai-primary);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .ai-widget-message.user .ai-widget-message-content a {
      color: white;
    }

    .ai-widget-tool-card {
      margin: 10px 0 4px;
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid var(--ai-border);
      background: var(--ai-bg-primary, #fff);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .ai-widget-tool-card table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      line-height: 1.4;
    }

    .ai-widget-tool-card th {
      text-align: left;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.04);
      border-bottom: 1px solid var(--ai-border);
      font-weight: 600;
      white-space: nowrap;
      color: var(--ai-text);
    }

    .ai-widget-tool-card td {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      white-space: nowrap;
      color: var(--ai-text);
    }

    .ai-widget-tool-card tr:last-child td {
      border-bottom: none;
    }

    .ai-widget-tool-card code {
      font-size: 11.5px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.06);
    }

    .ai-widget-sources {
      margin-top: 8px;
      padding: 0 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: ai-fade-in 0.3s ease;
    }

    @keyframes ai-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ai-widget-sources-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ai-text-secondary);
      font-weight: 700;
      margin-bottom: 2px;
    }

    .ai-widget-sources-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .ai-widget-source-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--ai-bg-secondary);
      border: 1px solid var(--ai-border);
      color: var(--ai-text-secondary);
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      text-decoration: none !important;
      transition: all 0.2s ease;
      font-weight: 500;
      max-width: 140px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ai-widget-source-pill span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ai-widget-source-pill:hover {
      background: var(--ai-primary);
      color: white;
      border-color: var(--ai-primary);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    }

    .ai-widget-source-icon {
      flex-shrink: 0;
      opacity: 0.7;
    }

    .ai-widget-source-pill:hover .ai-widget-source-icon {
      opacity: 1;
    }

    .ai-widget-typing {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: var(--ai-bg-secondary);
      border-radius: 16px;
      width: fit-content;
      align-self: flex-start;
    }

    .ai-widget-typing-dots {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .ai-widget-typing-dots span {
      width: 6px;
      height: 6px;
      background: var(--ai-text-secondary);
      border-radius: 50%;
      animation: ai-typing 1.4s infinite;
    }

    .ai-widget-typing-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .ai-widget-typing-dots span:nth-child(3) {
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

    .ai-widget-status-text {
      color: var(--ai-text-secondary);
      font-size: 13px;
      font-style: italic;
    }

    .ai-widget-input-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--ai-border);
      background: var(--ai-bg);
    }

    .ai-widget-inline-status {
      display: none;
      padding: 10px 16px;
      border-top: 1px solid var(--ai-border);
      background: var(--ai-bg-secondary);
      color: var(--ai-text-secondary);
      font-size: 12px;
      line-height: 1.45;
    }

    .ai-widget-inline-status.visible {
      display: block;
    }

    .ai-widget-inline-status.error {
      background: rgba(239, 68, 68, 0.08);
      color: #fca5a5;
    }

    .ai-widget-inline-status.info {
      color: var(--ai-text-secondary);
    }

    .ai-widget-mic {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border: none;
      background: transparent;
      color: var(--ai-text-secondary);
      cursor: pointer;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .ai-widget-mic:hover {
      background: var(--ai-bg-secondary);
      color: var(--ai-text);
    }

    .ai-widget-mic.listening {
      background: var(--ai-primary);
      color: white;
      animation: ai-mic-pulse 1.5s ease-in-out infinite;
    }

    .ai-widget-mic.error {
      color: #ef4444;
    }

    @keyframes ai-mic-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
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

    .ai-widget-send:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .ai-widget-send:disabled:hover {
      background: var(--ai-primary);
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
    @media (max-width: 640px) {
      #ai-widget-container.bottom-right {
        right: 12px;
        right: calc(env(safe-area-inset-right) + 12px);
        bottom: 12px;
        bottom: calc(env(safe-area-inset-bottom) + 12px);
      }

      #ai-widget-container.bottom-left {
        left: 12px;
        left: calc(env(safe-area-inset-left) + 12px);
        bottom: 12px;
        bottom: calc(env(safe-area-inset-bottom) + 12px);
      }

      .ai-widget-panel {
        width: calc(100vw - 24px);
        height: min(calc(100dvh - 24px), 720px);
        max-height: calc(100dvh - 24px);
        border-radius: 20px;
      }

      .ai-widget-messages {
        padding: 14px;
      }
    }

    .ai-widget-lead-overlay {
      position: absolute;
      top: 52px; /* right under header */
      left: 0;
      right: 0;
      bottom: 0;
      background: ${config.theme === 'dark' ? 'rgba(15, 23, 42, 0.65)' : 'rgba(255, 255, 255, 0.65)'};
      backdrop-filter: blur(24px) saturate(210%) contrast(90%);
      -webkit-backdrop-filter: blur(24px) saturate(210%) contrast(90%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 24px;
      z-index: 10;
      animation: ai-fade-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-sizing: border-box;
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .ai-widget-lead-overlay.fade-out {
      animation: ai-slide-out-fade 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    @keyframes ai-slide-out-fade {
      from {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      to {
        opacity: 0;
        transform: translateY(-24px) scale(0.95);
      }
    }

    @keyframes ai-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ai-widget-lead-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      box-sizing: border-box;
    }

    .ai-widget-lead-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--ai-text);
      margin: 0 0 4px 0;
      text-align: center;
      letter-spacing: -0.02em;
    }

    .ai-widget-lead-subtitle {
      font-size: 13px;
      color: var(--ai-text-secondary);
      margin: 0 0 16px 0;
      text-align: center;
      line-height: 1.45;
    }

    .ai-widget-lead-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ai-widget-lead-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--ai-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      transition: color 0.2s ease;
    }

    .ai-widget-lead-field:focus-within .ai-widget-lead-label {
      color: var(--ai-primary);
    }

    .ai-widget-lead-input {
      border: 1px solid var(--ai-border);
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      font-family: inherit;
      background: ${config.theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.015)'};
      color: var(--ai-text);
      outline: none;
      transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
      box-sizing: border-box;
      width: 100%;
    }

    .ai-widget-lead-input:focus {
      border-color: var(--ai-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--ai-primary) 15%, transparent);
      background: ${config.theme === 'dark' ? 'rgba(255, 255, 255, 0.06)' : '#ffffff'};
    }

    .ai-widget-lead-input.invalid {
      border-color: #ef4444 !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15) !important;
      animation: ai-shake 0.3s ease-in-out;
    }

    @keyframes ai-shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-4px); }
      40%, 80% { transform: translateX(4px); }
    }

    .ai-widget-lead-submit {
      margin-top: 8px;
      padding: 12px;
      border-radius: 10px;
      background: var(--ai-primary);
      color: white;
      font-weight: 600;
      font-size: 14px;
      border: none;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px color-mix(in srgb, var(--ai-primary) 30%, transparent);
    }

    .ai-widget-lead-submit:hover {
      background: var(--ai-primary-dark);
      transform: translateY(-1.5px);
      box-shadow: 0 6px 16px color-mix(in srgb, var(--ai-primary) 40%, transparent);
    }

    .ai-widget-lead-submit:active {
      transform: translateY(0);
    }

    .ai-widget-lead-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .ai-widget-lead-skip {
      margin-top: 10px;
      padding: 10px;
      border: none;
      background: transparent;
      color: var(--ai-text-muted, #94a3b8);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .ai-widget-lead-skip:hover {
      color: var(--ai-text, #e2e8f0);
    }

    .ai-widget-lead-error {
      color: #ef4444;
      font-size: 12px;
      margin-top: 4px;
      display: none;
      text-align: left;
      font-weight: 500;
      animation: ai-slide-down-bounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes ai-slide-down-bounce {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .ai-widget-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: ai-spin 0.8s linear infinite;
    }

    @keyframes ai-spin {
      to { transform: rotate(360deg); }
    }

    .ai-widget-new-chat,
    .ai-widget-tts-trigger,
    .ai-widget-handoff-trigger {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 0.2s, transform 0.2s, background 0.2s;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ai-widget-new-chat:hover,
    .ai-widget-tts-trigger:hover,
    .ai-widget-handoff-trigger:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.15);
      transform: scale(1.05);
    }

    /* Keep white on primary header — primary-on-primary made the icon vanish */
    .ai-widget-tts-trigger.active {
      opacity: 1;
      color: white;
      background: rgba(255, 255, 255, 0.22);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    }

    .ai-widget-feedback {
      display: flex;
      gap: 6px;
      margin-top: 4px;
      padding-left: 4px;
      animation: ai-fade-in 0.25s ease;
    }

    .ai-widget-feedback-btn {
      background: var(--ai-bg-secondary);
      border: 1px solid var(--ai-border);
      color: var(--ai-text-secondary);
      border-radius: 6px;
      padding: 4px 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .ai-widget-feedback-btn:hover {
      color: var(--ai-text);
      background: var(--ai-border);
      transform: scale(1.05);
    }

    .ai-widget-feedback-btn.active {
      color: white;
      border-color: transparent;
    }

    .ai-widget-feedback-btn.up.active {
      background: #22c55e;
    }

    .ai-widget-feedback-btn.down.active {
      background: #ef4444;
    }

    .ai-widget-feedback-btn:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }

    .ai-widget-handoff-container {
      width: 100%;
    }

    .ai-widget-handoff-title {
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--ai-text);
    }

    .ai-widget-handoff-choices {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }

    .ai-widget-handoff-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--ai-bg-secondary);
      border: 1px solid var(--ai-border);
      color: var(--ai-text);
      border-radius: 8px;
      text-decoration: none !important;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
      width: 100%;
      box-sizing: border-box;
      text-align: left;
    }

    .ai-widget-handoff-btn svg {
      color: var(--ai-primary);
      transition: transform 0.2s ease;
    }

    .ai-widget-handoff-btn:hover {
      background: ${config.theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#ffffff'};
      border-color: var(--ai-primary);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      transform: translateY(-1px);
    }

    .ai-widget-handoff-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      transform: none;
    }

    .ai-widget-handoff-btn:disabled:hover {
      background: var(--ai-bg-secondary);
      border-color: var(--ai-border);
      box-shadow: none;
      transform: none;
    }

    .ai-widget-handoff-btn:hover svg {
      transform: scale(1.1) translateX(2px);
    }

    .ai-widget-footer {
      text-align: center;
      padding: 6px 0 10px;
      font-size: 11px;
      color: var(--ai-text-secondary);
      background: var(--ai-bg);
      border-top: 1px solid var(--ai-border);
      letter-spacing: 0.02em;
    }
  `;
}

/** Hex colors only — blocks CSS breakout via primaryColor. */
export function sanitizeCssColor(raw: string | undefined | null, fallback = '#7c3aed'): string {
  const s = (raw || '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    return s.toLowerCase();
  }
  return fallback;
}
