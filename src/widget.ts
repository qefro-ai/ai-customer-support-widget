/**
 * Main Widget class
 */

import type { WidgetConfig } from './index';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface ChatResponse {
    type: 'token' | 'conversation_id' | 'done' | 'error';
    content?: string;
    id?: string;
    message_id?: string;
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

    constructor(config: WidgetConfig) {
        this.config = config;
        this.container = this.createContainer();
        this.messagesContainer = this.container.querySelector('.ai-widget-messages')!;
        this.input = this.container.querySelector('.ai-widget-input')!;

        this.setupEventListeners();
        this.addWelcomeMessage();
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
      </button>
      <div class="ai-widget-panel">
        <div class="ai-widget-header">
          <span>AI Assistant</span>
          <button class="ai-widget-close" aria-label="Close chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="ai-widget-messages"></div>
        <div class="ai-widget-input-container">
          <textarea 
            class="ai-widget-input" 
            placeholder="Type your message..." 
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
    }

    private toggle(): void {
        this.isOpen = !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);
        if (this.isOpen) {
            this.input.focus();
            this.connectWebSocket();
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
                case 'conversation_id':
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
                conversation_id: this.conversationId,
            }));

            // Prepare for streamed response
            this.addMessage({
                id: 'streaming',
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
                    conversation_id: this.conversationId,
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
                        } else if (data.type === 'conversation_id') {
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
        // Simple markdown-like formatting
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
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

    private scrollToBottom(): void {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // Public API
    public open(): void {
        if (!this.isOpen) this.toggle();
    }

    public setContext(context: Record<string, any>): void {
        // Store context for next message
        console.log('AI Widget: Context set', context);
    }
}
