/**
 * Main Widget class with STT support
 */

import type { WidgetConfig } from './index';
import { SpeechToText, STTState } from './tts/stt';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface ChatResponse {
    type: 'token' | 'conversationId' | 'done' | 'error' | 'status';
    content?: string;
    id?: string;
    messageId?: string;
    message?: string;
}

export class Widget {
    private config: WidgetConfig;
    private container: HTMLElement;
    private messagesContainer: HTMLElement;
    private input: HTMLTextAreaElement;
    private ws: WebSocket | null = null;
    private conversationId: string | null = null;
    private messages: Message[] = [];
    private isOpen = false;
    private isTyping = false;
    private stt: SpeechToText;
    private micButton: HTMLButtonElement | null = null;
    private unreadCount = 0;  // Track unread messages for badge
    private badge: HTMLElement | null = null;

    constructor(config: WidgetConfig) {
        this.config = config;
        this.container = this.createContainer();
        this.messagesContainer = this.container.querySelector('.ai-widget-messages')!;
        this.input = this.container.querySelector('.ai-widget-input')!;
        this.micButton = this.container.querySelector('.ai-widget-mic');

        // Initialize STT (Speech-to-Text)
        this.stt = new SpeechToText();
        this.stt.setOnResult(this.handleSTTResult.bind(this));
        this.stt.setOnStateChange(this.handleSTTStateChange.bind(this));

        this.setupEventListeners();
        this.addWelcomeMessage();
        this.updateMicButton();

        // Initialize badge reference
        this.badge = this.container.querySelector('.ai-widget-badge');

        // Play notification sound and show badge after a short delay
        setTimeout(() => {
            this.playNotificationSound();
            this.updateBadge();
        }, 1000);
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.id = 'ai-widget-container';
        container.className = `ai-widget ${this.config.theme} ${this.config.position}`;

        container.innerHTML = `
      <button class="ai-widget-trigger" aria-label="Open chat">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="ai-widget-badge" style="display: none;">1</span>
      </button>
      <div class="ai-widget-panel">
        <div class="ai-widget-header">
          <span>AI Assistant</span>
          <div class="ai-widget-header-actions">
            <!-- Voice button hidden for now - TTS needs improvement -->
            <!--
            <button class="ai-widget-voice" aria-label="Toggle voice" title="Voice is off">
              <svg class="voice-off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <line x1="23" y1="9" x2="17" y2="15"></line>
                <line x1="17" y1="9" x2="23" y2="15"></line>
              </svg>
              <svg class="voice-on" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            </button>
            -->
            <button class="ai-widget-close" aria-label="Close chat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="ai-widget-messages"></div>
        <div class="ai-widget-input-container">
          <button class="ai-widget-mic" aria-label="Voice input" title="Click to speak">
            <svg class="mic-idle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <svg class="mic-active" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" style="display:none">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          <textarea 
            class="ai-widget-input" 
            placeholder="Type or speak your message..." 
            rows="1"
          ></textarea>
          <button class="ai-widget-send" aria-label="Send message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(container);
        return container;
    }

    private setupEventListeners(): void {
        // Toggle panel
        const trigger = this.container.querySelector('.ai-widget-trigger')!;
        trigger.addEventListener('click', () => this.toggle());

        const close = this.container.querySelector('.ai-widget-close')!;
        close.addEventListener('click', () => this.close());

        // Mic button (STT)
        if (this.micButton) {
            this.micButton.addEventListener('click', () => this.toggleMic());
        }

        // Send message
        const send = this.container.querySelector('.ai-widget-send')!;
        send.addEventListener('click', () => this.sendMessage());

        // Enter to send
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.input.addEventListener('input', () => {
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
        });
    }

    private addWelcomeMessage(): void {
        this.addMessage({
            id: 'welcome',
            role: 'assistant',
            content: this.config.welcomeMessage,
            timestamp: new Date(),
        });
        // Welcome message counts as unread
        this.unreadCount = 1;
    }

    private toggle(): void {
        this.isOpen = !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);
        if (this.isOpen) {
            this.input.focus();
            this.connectWebSocket();
            // Clear unread count when opened
            this.unreadCount = 0;
            this.updateBadge();
        }
    }

    private close(): void {
        this.isOpen = false;
        this.container.classList.remove('open');
    }

    private async connectWebSocket(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        const wsUrl = this.config.endpoint
            .replace('https://', 'wss://')
            .replace('http://', 'ws://');

        this.ws = new WebSocket(`${wsUrl}/ws/chat?token=${this.config.token}`);

        this.ws.onopen = () => {
            console.log('AI Widget: WebSocket connected');
        };

        this.ws.onmessage = (event) => {
            this.handleWebSocketMessage(event.data);
        };

        this.ws.onerror = (error) => {
            console.error('AI Widget: WebSocket error', error);
        };

        this.ws.onclose = () => {
            console.log('AI Widget: WebSocket closed');
            this.ws = null;
        };
    }

    private handleWebSocketMessage(data: string): void {
        try {
            const response: ChatResponse = JSON.parse(data);

            switch (response.type) {
                case 'conversationId':
                    this.conversationId = response.id!;
                    break;

                case 'token':
                    this.appendToLastMessage(response.content!);
                    break;

                case 'done':
                    this.isTyping = false;
                    this.hideTypingIndicator();
                    break;

                case 'error':
                    this.isTyping = false;
                    this.hideTypingIndicator();
                    this.addMessage({
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: 'Sorry, an error occurred. Please try again.',
                        timestamp: new Date(),
                    });
                    break;

                case 'status':
                    this.updateTypingIndicator(response.message || 'Processing...');
                    break;
            }
        } catch (error) {
            console.error('AI Widget: Failed to parse message', error);
        }
    }

    private async sendMessage(): Promise<void> {
        const content = this.input.value.trim();
        if (!content || this.isTyping) return;

        // Add user message
        this.addMessage({
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: new Date(),
        });

        // Clear input
        this.input.value = '';
        this.input.style.height = 'auto';

        // Show typing indicator
        this.isTyping = true;
        this.showTypingIndicator();

        // Connect if needed
        await this.connectWebSocket();

        // Send via WebSocket
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                message: content,
                conversationId: this.conversationId,
                // Include workspace ID for scoped retrieval and system prompts
                workspaceId: this.config.workspaceId || undefined,
                // include optional context to help retrieval / routing on the server
                context: (this.config as any).context || undefined,
            }));

            // Prepare for streamed response with unique ID
            const streamingId = `streaming-${Date.now()}`;
            this.addMessage({
                id: streamingId,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
            });
        } else {
            // Fallback to HTTP
            this.sendViaHttp(content);
        }
    }

    private async sendViaHttp(content: string): Promise<void> {
        try {
            const response = await fetch(`${this.config.endpoint}/api/v1/widget/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`,
                },
                body: JSON.stringify({
                    message: content,
                    conversationId: this.conversationId,
                    context: (this.config as any).context || undefined,
                }),
            });

            if (!response.ok) {
                throw new Error('Request failed');
            }

            // Handle SSE stream
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            // Add placeholder message
            this.addMessage({
                id: 'streaming',
                role: 'assistant',
                content: '',
                timestamp: new Date(),
            });

            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'token') {
                            this.appendToLastMessage(data.content);
                        } else if (data.type === 'conversationId') {
                            this.conversationId = data.id;
                        } else if (data.type === 'done') {
                            this.isTyping = false;
                            this.hideTypingIndicator();
                        }
                    }
                }
            }
        } catch (error) {
            console.error('AI Widget: HTTP request failed', error);
            this.isTyping = false;
            this.hideTypingIndicator();
            this.addMessage({
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Sorry, I could not process your request.',
                timestamp: new Date(),
            });
        }
    }

    private addMessage(message: Message): void {
        this.messages.push(message);

        const el = document.createElement('div');
        el.className = `ai-widget-message ${message.role}`;
        el.dataset.id = message.id;
        el.innerHTML = `<div class="ai-widget-message-content">${this.formatContent(message.content)}</div>`;

        this.messagesContainer.appendChild(el);
        this.scrollToBottom();
    }

    private appendToLastMessage(token: string): void {
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content += token;

            const el = this.messagesContainer.querySelector(`[data-id="${lastMessage.id}"] .ai-widget-message-content`);
            if (el) {
                el.innerHTML = this.formatContent(lastMessage.content);
            }
        }
        this.scrollToBottom();
    }

    private formatContent(content: string): string {
        // 1. Handle code blocks (```code```)
        let formatted = content.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

        // 2. Handle unordered lists (- item or * item)
        // Ensure we don't break existing tags or over-match
        formatted = formatted.replace(/^(?:\*|-)\s+(.+)$/gm, '<li>$1</li>');
        // Wrap contiguous li tags in ul
        formatted = formatted.replace(/(?:<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

        // 3. Handle bold, italic, inline code (only if not inside code block)
        // This is simplified; true markdown parsing is complex
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // 4. Handle newlines mapping to <br> (but not inside pre blocks)
        // We'll split by <pre> blocks and only apply to other parts
        const parts = formatted.split(/(<pre>[\s\S]*?<\/pre>)/);
        return parts.map(part => {
            if (part.startsWith('<pre>')) return part;
            return part.replace(/\n/g, '<br>');
        }).join('').trim();
    }

    private showTypingIndicator(): void {
        const indicator = document.createElement('div');
        indicator.className = 'ai-widget-typing';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        this.messagesContainer.appendChild(indicator);
        this.scrollToBottom();
    }

    private hideTypingIndicator(): void {
        const indicator = this.messagesContainer.querySelector('.ai-widget-typing');
        indicator?.remove();
    }

    private updateTypingIndicator(message: string): void {
        let indicator = this.messagesContainer.querySelector('.ai-widget-typing');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'ai-widget-typing';
            this.messagesContainer.appendChild(indicator);
        }
        indicator.innerHTML = `<span class="ai-widget-status-text">${message}</span><span></span><span></span><span></span>`;
        this.scrollToBottom();
    }

    private scrollToBottom(): void {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // STT (Speech-to-Text) methods
    private toggleMic(): void {
        if (!this.stt.isSupported()) {
            console.warn('[Widget] STT not supported in this browser');
            return;
        }
        this.stt.toggle();
    }

    private handleSTTResult(transcript: string, isFinal: boolean): void {
        if (isFinal) {
            // Final result - set input and optionally auto-send
            this.input.value = transcript;
            // Auto-resize
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
            // Focus input so user can edit or press Enter
            this.input.focus();
        } else {
            // Interim result - show live transcription
            this.input.value = transcript;
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
        }
    }

    private handleSTTStateChange(state: STTState): void {
        this.updateMicButton();
    }

    private updateMicButton(): void {
        if (!this.micButton) return;

        const state = this.stt.getState();
        const micIdle = this.micButton.querySelector('.mic-idle') as HTMLElement;
        const micActive = this.micButton.querySelector('.mic-active') as HTMLElement;

        // Hide button if not supported
        if (state === 'unsupported') {
            this.micButton.style.display = 'none';
            return;
        }

        this.micButton.classList.remove('listening', 'error');

        if (micIdle && micActive) {
            if (state === 'listening') {
                micIdle.style.display = 'none';
                micActive.style.display = 'block';
                this.micButton.classList.add('listening');
                this.micButton.title = 'Listening... Click to stop';
            } else {
                micIdle.style.display = 'block';
                micActive.style.display = 'none';
                this.micButton.title = 'Click to speak';
            }
        }

        if (state === 'error') {
            this.micButton.classList.add('error');
            this.micButton.title = 'Microphone access denied';
        }
    }

    // Notification methods
    private playNotificationSound(): void {
        try {
            // Create a pleasant notification chime using Web Audio API
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Pleasant two-tone chime
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
            oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1); // Higher note

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (e) {
            console.log('[Widget] Could not play notification sound:', e);
        }
    }

    private updateBadge(): void {
        if (!this.badge) return;

        if (this.unreadCount > 0 && !this.isOpen) {
            this.badge.textContent = String(this.unreadCount);
            this.badge.style.display = 'flex';
        } else {
            this.badge.style.display = 'none';
        }
    }

    // Public API
    public open(): void {
        if (!this.isOpen) this.toggle();
    }

    public setContext(context: Record<string, any>): void {
        // Store context for next message (merged into existing context)
        this.config = { ...this.config, context: { ...(this.config.context || {}), ...(context || {}) } };
        console.log('AI Widget: Context set', this.config.context);
    }
}
