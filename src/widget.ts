/**
 * Main Widget class with STT support
 */

import type { WidgetConfig } from './index';
import { WhisperSTT, WhisperSTTState as STTState } from './tts/whisper-stt';
import { TTSController } from './tts/index';
import DOMPurify from 'dompurify';
import { injectStyles, sanitizeCssColor } from './styles';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface Source {
    url: string;
    title: string;
}

interface PersistedMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

interface InboxThread {
    conversationId: string;
    title: string;
    preview: string;
    messages: PersistedMessage[];
    updatedAt: number;
    unread: number;
}

interface InboxStore {
    version: 2;
    activeId: string | null;
    threads: Record<string, InboxThread>;
}

/** @deprecated v1 single-conversation shape — migrated on load */
interface PersistedConversationV1 {
    conversationId: string;
    messages: PersistedMessage[];
    updatedAt: number;
}

interface ChatResponse {
    type: 'token' | 'conversationId' | 'done' | 'error' | 'status' | 'sources' | 'agentMessage';
    content?: string;
    id?: string;
    messageId?: string;
    message?: string;
    sources?: Source[];
    conversationId?: string;
}

interface ServerMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at?: string;
    createdAt?: string;
}


export class Widget {
    private config: WidgetConfig;
    private container: HTMLElement;
    private messagesContainer: HTMLElement;
    private input: HTMLTextAreaElement;
    private sendButton: HTMLButtonElement;
    private inlineStatus: HTMLElement;
    private ws: WebSocket | null = null;
    private connectionPromise: Promise<void> | null = null;
    private reconnectTimer: number | null = null;
    private reconnectAttempt = 0;
    private renderFrame: number | null = null;
    private conversationId: string | null = null;
    private messages: Message[] = [];
    private inboxStore: InboxStore = { version: 2, activeId: null, threads: {} };
    private viewMode: 'chat' | 'inbox' = 'chat';
    private isOpen = false;
    private isTyping = false;
    private stt: WhisperSTT;
    private tts: TTSController;
    private micButton: HTMLButtonElement | null = null;
    private ttsButton: HTMLButtonElement | null = null;
    private unreadCount = 0;  // Track unread messages for badge
    private badge: HTMLElement | null = null;
    private settings: {
        primaryColor: string;
        widgetPosition: string;
        welcomeMessage: string;
        leadCaptureEnabled: boolean;
        leadCaptureFields: string[];
        showSourcesInWidget: boolean;
        handoffConfig?: {
            email_recipient?: string | null;
            whatsapp_number?: string | null;
            has_webhook?: boolean;
            message?: string | null;
        } | null;
    } | null = null;
    private isLeadSubmitted = false;

    constructor(config: WidgetConfig) {
        this.config = config;
        injectStyles(config);
        this.container = this.createContainer();
        this.messagesContainer = this.container.querySelector('.ai-widget-messages')!;
        this.input = this.container.querySelector('.ai-widget-input')!;
        this.sendButton = this.container.querySelector('.ai-widget-send')!;
        this.inlineStatus = this.container.querySelector('.ai-widget-inline-status')!;
        this.micButton = this.container.querySelector('.ai-widget-mic');

        // Initialize STT (Speech-to-Text)
        this.stt = new WhisperSTT('./whisper.worker.ts', this.config.speechLanguage);
        this.stt.setOnResult((transcript) => this.handleSTTResult(transcript, true));
        this.stt.setOnStateChange(this.handleSTTStateChange.bind(this));
        this.stt.setOnProgress((progress) => {
            if (progress < 0) {
                this.showStatus('Loading Whisper STT from cache...', 'info');
            } else if (progress >= 100) {
                this.showStatus('Initializing model... (this takes a moment)', 'info');
            } else {
                this.showStatus(`Downloading Whisper STT model... ${Math.round(progress)}%`, 'info');
            }
        });

        // Initialize TTS
        this.tts = new TTSController({
            apiUrl: this.config.endpoint,
            apiToken: this.config.token,
            workspaceId: this.config.workspaceId || null
        });
        
        this.setupEventListeners();
        this.restoreConversation();
        this.updateMicButton();
        this.updateSendButtonState();

        // Initialize badge reference
        this.badge = this.container.querySelector('.ai-widget-badge');

        // Play notification sound and show badge after a short delay
        // (only for fresh welcome — restored chats should stay quiet)
        if (!this.conversationId) {
            setTimeout(() => {
                this.playNotificationSound();
                this.updateBadge();
            }, 1000);
        }

        this.fetchSettings();
    }

    private storageKey(): string {
        return `ai-widget-conversation-${this.config.token}`;
    }

    private inboxStorageKey(): string {
        return `ai-widget-inbox-${this.config.token}`;
    }

    /** Stable visitor session — binds server conversations to this browser */
    private visitorSession(): string {
        const key = `ai-widget-session-${this.config.token}`;
        const existing = localStorage.getItem(key);
        if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
            return existing;
        }
        const raw =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        const id = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `s${Date.now()}`;
        localStorage.setItem(key, id);
        return id;
    }

    private sessionHeaders(): HeadersInit {
        return {
            'x-widget-session': this.visitorSession(),
        };
    }

    private emptyStore(): InboxStore {
        return { version: 2, activeId: null, threads: {} };
    }

    private threadTitle(messages: Message[] | PersistedMessage[]): string {
        const user = messages.find((m) => m.role === 'user' && m.content.trim());
        if (!user) return 'Conversation';
        const text = user.content.trim().replace(/\s+/g, ' ');
        return text.length > 42 ? `${text.slice(0, 42)}…` : text;
    }

    private threadPreview(messages: Message[] | PersistedMessage[]): string {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.content.trim()) {
                const text = m.content.trim().replace(/\s+/g, ' ');
                return text.length > 64 ? `${text.slice(0, 64)}…` : text;
            }
        }
        return '';
    }

    private persistInboxStore(): void {
        try {
            localStorage.setItem(this.inboxStorageKey(), JSON.stringify(this.inboxStore));
        } catch (error) {
            console.warn('AI Widget: Failed to persist inbox', error);
        }
    }

    private persistConversation(): void {
        if (!this.conversationId) return;

        const meaningful = this.messages.filter(
            (m) => m.id !== 'welcome' && m.content.trim().length > 0
        );
        if (meaningful.length === 0) return;

        const persisted: PersistedMessage[] = meaningful.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp.toISOString(),
        }));

        const existing = this.inboxStore.threads[this.conversationId];
        this.inboxStore.threads[this.conversationId] = {
            conversationId: this.conversationId,
            title: this.threadTitle(persisted),
            preview: this.threadPreview(persisted),
            messages: persisted,
            updatedAt: Date.now(),
            unread: existing?.unread ?? 0,
        };
        this.inboxStore.activeId = this.conversationId;
        this.persistInboxStore();
        this.updateInboxBadge();
    }

    private loadInboxStore(): InboxStore {
        try {
            const raw = localStorage.getItem(this.inboxStorageKey());
            if (raw) {
                const parsed = JSON.parse(raw) as InboxStore;
                if (parsed?.version === 2 && parsed.threads && typeof parsed.threads === 'object') {
                    // Drop stale threads older than 30 days
                    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
                    for (const id of Object.keys(parsed.threads)) {
                        if ((parsed.threads[id].updatedAt || 0) < cutoff) {
                            delete parsed.threads[id];
                        }
                    }
                    return parsed;
                }
            }

            // Migrate v1 single-conversation key
            const legacyRaw = localStorage.getItem(this.storageKey());
            if (legacyRaw) {
                const legacy = JSON.parse(legacyRaw) as PersistedConversationV1;
                if (legacy?.conversationId && Array.isArray(legacy.messages)) {
                    const store = this.emptyStore();
                    store.activeId = legacy.conversationId;
                    store.threads[legacy.conversationId] = {
                        conversationId: legacy.conversationId,
                        title: this.threadTitle(legacy.messages),
                        preview: this.threadPreview(legacy.messages),
                        messages: legacy.messages,
                        updatedAt: legacy.updatedAt || Date.now(),
                        unread: 0,
                    };
                    localStorage.setItem(this.inboxStorageKey(), JSON.stringify(store));
                    localStorage.removeItem(this.storageKey());
                    return store;
                }
            }
        } catch {
            // fall through
        }
        return this.emptyStore();
    }

    private inboxIds(): string[] {
        return Object.keys(this.inboxStore.threads);
    }

    private totalInboxUnread(): number {
        return Object.values(this.inboxStore.threads).reduce((sum, t) => sum + (t.unread || 0), 0);
    }

    private updateInboxBadge(): void {
        const badge = this.container.querySelector('.ai-widget-inbox-badge') as HTMLElement | null;
        const count = this.totalInboxUnread();
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : String(count);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    private renderMessagesFromList(list: Message[], options: { persist?: boolean } = {}): void {
        this.messagesContainer.innerHTML = '';
        this.messages = [];
        for (const msg of list) {
            this.addMessage(msg, { persist: options.persist ?? false });
        }
    }

    private restoreConversation(): void {
        this.inboxStore = this.loadInboxStore();
        this.updateInboxBadge();

        const activeId = this.inboxStore.activeId;
        const active = activeId ? this.inboxStore.threads[activeId] : null;

        if (!active || active.messages.length === 0) {
            this.conversationId = null;
            this.addWelcomeMessage();
            return;
        }

        this.conversationId = active.conversationId;
        this.renderMessagesFromList(
            active.messages
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: new Date(m.timestamp),
                })),
            { persist: false }
        );

        if (this.messages.length === 0) {
            this.addWelcomeMessage();
            return;
        }

        // Pull latest messages (incl. agent replies while the page was closed)
        // then keep the socket subscribed so live agent replies still arrive.
        void this.syncConversationFromServer().finally(() => {
            this.connectWebSocket().catch(() => {
                // HTTP fallback still works on send
            });
        });
    }

    private async syncConversationFromServer(targetId?: string): Promise<void> {
        const conversationId = targetId || this.conversationId;
        if (!conversationId) return;

        try {
            const response = await fetch(
                `${this.config.endpoint}/api/v1/widget/conversations/${conversationId}/messages?limit=100&session=${encodeURIComponent(this.visitorSession())}`,
                {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                        ...this.sessionHeaders(),
                    },
                }
            );

            if (!response.ok) {
                // A 401 means this cached thread belongs to an old or different
                // visitor session and cannot be resumed safely.
                if (response.status === 401 || response.status === 404) {
                    delete this.inboxStore.threads[conversationId];
                    if (this.inboxStore.activeId === conversationId) {
                        this.inboxStore.activeId = null;
                    }
                    this.persistInboxStore();
                    if (this.conversationId === conversationId) {
                        this.conversationId = null;
                        this.messagesContainer.innerHTML = '';
                        this.messages = [];
                        this.addWelcomeMessage();
                    }
                    this.updateInboxBadge();
                    if (this.viewMode === 'inbox') this.renderInboxList();
                }
                return;
            }

            const data = (await response.json()) as ServerMessage[] | { messages: ServerMessage[] };
            const serverMessages = Array.isArray(data) ? data : data.messages || [];
            const restored = serverMessages
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .map((m) => ({
                    id: m.id,
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                    timestamp: new Date(m.created_at || m.createdAt || Date.now()),
                }));

            if (restored.length === 0) return;

            const persisted: PersistedMessage[] = restored.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp.toISOString(),
            }));
            const existing = this.inboxStore.threads[conversationId];
            this.inboxStore.threads[conversationId] = {
                conversationId,
                title: this.threadTitle(persisted),
                preview: this.threadPreview(persisted),
                messages: persisted,
                updatedAt: Date.now(),
                unread: existing?.unread ?? 0,
            };
            this.persistInboxStore();

            if (this.conversationId === conversationId && this.viewMode === 'chat') {
                this.renderMessagesFromList(restored, { persist: false });
            }
            if (this.viewMode === 'inbox') this.renderInboxList();
            this.updateInboxBadge();
        } catch (error) {
            console.warn('AI Widget: Failed to sync conversation from server', error);
        }
    }

    private resumeConversationOnSocket(): void {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        const ids = this.inboxIds();
        if (this.conversationId && !ids.includes(this.conversationId)) {
            ids.push(this.conversationId);
        }
        if (ids.length === 0) return;

        // Bulk watch all inbox + active threads for agent replies
        this.ws.send(
            JSON.stringify({
                type: 'watch',
                conversationIds: ids.slice(0, 20),
            })
        );

        // Also resume active for older backends that only understand resume
        if (this.conversationId) {
            this.ws.send(
                JSON.stringify({
                    type: 'resume',
                    conversationId: this.conversationId,
                })
            );
        }
    }

    private setViewMode(mode: 'chat' | 'inbox'): void {
        this.viewMode = mode;
        this.container.classList.toggle('inbox-open', mode === 'inbox');
        const chatTab = this.container.querySelector('.ai-widget-tab-chat');
        const inboxTab = this.container.querySelector('.ai-widget-tab-inbox');
        const inboxPanel = this.container.querySelector('.ai-widget-inbox-panel');
        chatTab?.classList.toggle('active', mode === 'chat');
        inboxTab?.classList.toggle('active', mode === 'inbox');
        chatTab?.setAttribute('aria-selected', mode === 'chat' ? 'true' : 'false');
        inboxTab?.setAttribute('aria-selected', mode === 'inbox' ? 'true' : 'false');
        inboxPanel?.setAttribute('aria-hidden', mode === 'inbox' ? 'false' : 'true');
        if (mode === 'inbox') {
            this.renderInboxList();
        }
    }

    private renderInboxList(): void {
        const list = this.container.querySelector('.ai-widget-inbox-list');
        if (!list) return;

        const threads = Object.values(this.inboxStore.threads).sort(
            (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
        );

        if (threads.length === 0) {
            list.innerHTML = `<div class="ai-widget-inbox-empty">No past conversations yet. Start chatting, then tap + to keep them here.</div>`;
            return;
        }

        list.innerHTML = threads
            .map((t) => {
                const unread = t.unread > 0
                    ? `<span class="ai-widget-inbox-item-unread">${t.unread > 9 ? '9+' : t.unread}</span>`
                    : '';
                const active = t.conversationId === this.conversationId ? ' active' : '';
                return `
                <button type="button" class="ai-widget-inbox-item${active}" data-id="${t.conversationId}">
                  <div class="ai-widget-inbox-item-title">${this.escapeHtml(t.title || 'Conversation')}</div>
                  <div class="ai-widget-inbox-item-preview">${this.escapeHtml(t.preview || '')}</div>
                  ${unread}
                </button>`;
            })
            .join('');

        list.querySelectorAll('.ai-widget-inbox-item').forEach((el) => {
            el.addEventListener('click', () => {
                const id = (el as HTMLElement).dataset.id;
                if (id) void this.openInboxThread(id);
            });
        });
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private async openInboxThread(conversationId: string): Promise<void> {
        const thread = this.inboxStore.threads[conversationId];
        if (!thread) return;

        // Snapshot current draft/active chat before switching
        this.snapshotActiveToInbox();

        this.conversationId = conversationId;
        this.inboxStore.activeId = conversationId;
        thread.unread = 0;
        this.persistInboxStore();
        this.updateInboxBadge();

        this.renderMessagesFromList(
            thread.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: new Date(m.timestamp),
            })),
            { persist: false }
        );

        this.setViewMode('chat');
        this.updateSendButtonState();
        this.input.focus();

        await this.syncConversationFromServer(conversationId);
        this.connectWebSocket().catch(() => undefined);
    }

    /** Save the currently open chat into inbox without clearing it. */
    private snapshotActiveToInbox(): void {
        if (!this.conversationId) return;
        const meaningful = this.messages.filter(
            (m) => m.id !== 'welcome' && m.content.trim().length > 0
        );
        if (meaningful.length === 0) return;
        this.persistConversation();
    }

    private startNewConversation(): void {
        this.tts.onUserMessage();
        this.hideTypingIndicator();
        this.isTyping = false;
        this.setInlineStatus(null);

        // Keep current thread in inbox, then start a blank chat
        this.snapshotActiveToInbox();
        if (this.conversationId && this.inboxStore.threads[this.conversationId]) {
            this.inboxStore.threads[this.conversationId].unread = 0;
        }

        this.conversationId = null;
        this.inboxStore.activeId = null;
        this.persistInboxStore();
        this.messages = [];
        this.messagesContainer.innerHTML = '';
        this.addWelcomeMessage();
        this.setViewMode('chat');
        this.updateInboxBadge();

        if (this.isOpen) {
            this.unreadCount = 0;
            this.updateBadge();
        }
        this.updateSendButtonState();
        this.input.focus();
        this.setInlineStatus('Started a new conversation. Past chats are in Inbox.', 'info');
        window.setTimeout(() => this.setInlineStatus(null), 2500);

        // Stay connected so inbox threads still receive agent replies
        this.connectWebSocket()
            .then(() => this.resumeConversationOnSocket())
            .catch(() => undefined);
    }

    private handleAgentMessage(conversationId: string, content: string, messageId?: string): void {
        const msg: Message = {
            id: messageId || `agent-reply-${Date.now()}`,
            role: 'assistant',
            content,
            timestamp: new Date(),
        };

        const thread = this.inboxStore.threads[conversationId] || {
            conversationId,
            title: 'Conversation',
            preview: '',
            messages: [],
            updatedAt: Date.now(),
            unread: 0,
        };

        thread.messages = [
            ...thread.messages,
            {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp.toISOString(),
            },
        ];
        thread.preview = this.threadPreview(thread.messages);
        thread.title = thread.title || this.threadTitle(thread.messages);
        thread.updatedAt = Date.now();

        const viewingThis = this.viewMode === 'chat' && this.conversationId === conversationId;
        if (viewingThis) {
            this.addMessage(msg, { persist: false });
            this.tts.processText(content);
            this.tts.onResponseComplete();
            thread.unread = 0;
        } else {
            thread.unread = (thread.unread || 0) + 1;
            if (!this.isOpen) {
                this.unreadCount++;
                this.updateBadge();
            }
        }

        this.inboxStore.threads[conversationId] = thread;
        this.persistInboxStore();
        this.updateInboxBadge();
        if (this.viewMode === 'inbox') this.renderInboxList();
        this.playNotificationSound();
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
            <button class="ai-widget-new-chat" aria-label="New conversation" title="New conversation">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button class="ai-widget-tts-trigger" aria-label="Toggle Voice" title="Toggle Voice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
              </svg>
            </button>
            <button class="ai-widget-handoff-trigger" aria-label="Contact Support" title="Contact Support">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
              </svg>
            </button>
            <button class="ai-widget-close" aria-label="Close chat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="ai-widget-tabs" role="tablist">
          <button type="button" class="ai-widget-tab ai-widget-tab-chat active" role="tab" aria-selected="true">Chat</button>
          <button type="button" class="ai-widget-tab ai-widget-tab-inbox" role="tab" aria-selected="false">
            Inbox
            <span class="ai-widget-inbox-badge" style="display:none">0</span>
          </button>
        </div>
        <div class="ai-widget-messages"></div>
        <div class="ai-widget-inbox-panel" aria-hidden="true">
          <div class="ai-widget-inbox-list"></div>
        </div>
        <div class="ai-widget-inline-status" aria-live="polite"></div>
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

        const newChat = this.container.querySelector('.ai-widget-new-chat')!;
        newChat.addEventListener('click', () => this.startNewConversation());

        const chatTab = this.container.querySelector('.ai-widget-tab-chat')!;
        const inboxTab = this.container.querySelector('.ai-widget-tab-inbox')!;
        chatTab.addEventListener('click', () => this.setViewMode('chat'));
        inboxTab.addEventListener('click', () => this.setViewMode('inbox'));

        const ttsTrigger = this.container.querySelector('.ai-widget-tts-trigger')!;
        this.ttsButton = ttsTrigger as HTMLButtonElement;
        ttsTrigger.addEventListener('click', async () => {
            const enabled = await this.tts.toggle();
            this.ttsButton?.classList.toggle('active', enabled);
            this.ttsButton?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        });

        // Restore TTS button state if it was enabled from previous sessions
        if (this.tts.isEnabled()) {
            this.ttsButton.classList.add('active');
            this.ttsButton.setAttribute('aria-pressed', 'true');
        }

        const handoffTrigger = this.container.querySelector('.ai-widget-handoff-trigger')!;
        handoffTrigger.addEventListener('click', () => this.renderHandoffOptions());

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
            this.updateSendButtonState();
        });
    }

    private updateSendButtonState(): void {
        this.sendButton.disabled = this.isTyping || !this.input.value.trim();
    }

    private setInlineStatus(message: string | null, tone: 'info' | 'error' = 'info'): void {
        this.inlineStatus.classList.remove('visible', 'info', 'error');

        if (!message) {
            this.inlineStatus.textContent = '';
            return;
        }

        this.inlineStatus.textContent = message;
        this.inlineStatus.classList.add('visible', tone);
    }

    private finishTyping(): void {
        this.isTyping = false;
        this.hideTypingIndicator();
        this.updateSendButtonState();
    }

    private restoreLiveAgentButton(button: HTMLButtonElement): void {
        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            Talk to Live Agent
        `;
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
            if (!this.settings?.leadCaptureEnabled || this.isLeadSubmitted) {
                this.input.focus();
                this.connectWebSocket().catch(() => {
                    // HTTP fallback is used on send; ignore open-time WS failures
                });
            } else {
                const nameInput = this.container.querySelector('#lead-name') as HTMLInputElement;
                nameInput?.focus();
            }
            // Clear unread count when opened
            this.unreadCount = 0;
            this.updateBadge();
        }
    }

    private close(): void {
        this.isOpen = false;
        this.container.classList.remove('open');
    }

    private async fetchSettings(): Promise<void> {
        try {
            const response = await fetch(`${this.config.endpoint}/api/v1/widget/settings`, {
                headers: {
                    'x-widget-token': this.config.token,
                }
            });
            if (response.ok) {
                const data = await response.json();
                this.settings = {
                    primaryColor: data.primary_color,
                    widgetPosition: data.widget_position,
                    welcomeMessage: data.welcome_message,
                    leadCaptureEnabled: data.lead_capture_enabled,
                    leadCaptureFields: data.lead_capture_fields,
                    showSourcesInWidget: data.show_sources_in_widget ?? true,
                    handoffConfig: data.handoff_config,
                };
                
                // Dynamically update primary color if provided by server settings
                if (this.settings.primaryColor) {
                    const color = sanitizeCssColor(this.settings.primaryColor, this.config.primaryColor);
                    this.settings.primaryColor = color;
                    this.container.style.setProperty('--ai-primary', color);
                    this.container.style.setProperty('--ai-primary-dark', `color-mix(in srgb, ${color} 85%, black)`);
                }
                
                // If welcome message is different from script tag config, update it
                if (this.settings.welcomeMessage && this.settings.welcomeMessage !== this.config.welcomeMessage) {
                    this.config.welcomeMessage = this.settings.welcomeMessage;
                    const welcomeMsgEl = this.messagesContainer.querySelector('#welcome .ai-widget-message-content');
                    if (welcomeMsgEl) {
                        welcomeMsgEl.textContent = this.settings.welcomeMessage;
                    }
                }
                
                // If lead capture is enabled, check localStorage to see if lead was already submitted
                this.isLeadSubmitted = localStorage.getItem(`ai-widget-lead-submitted-${this.config.token}`) === 'true';
                
                // Initialize the lead capture overlay if needed
                if (this.settings.leadCaptureEnabled && !this.isLeadSubmitted) {
                    this.renderLeadCaptureOverlay();
                }
            }
        } catch (error) {
            console.error('AI Widget: Failed to fetch settings', error);
            this.setInlineStatus('Using default widget settings while the live config is unavailable.', 'info');
        }
    }

    private renderLeadCaptureOverlay(): void {
        this.container.querySelector('.ai-widget-lead-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'ai-widget-lead-overlay';
        
        const fields = this.settings?.leadCaptureFields || [];
        const showPhone = fields.includes('phone') || fields.includes('Phone');
        const showCompany = fields.includes('company') || fields.includes('Company');

        overlay.innerHTML = `
            <h2 class="ai-widget-lead-title">Welcome!</h2>
            <p class="ai-widget-lead-subtitle">Please enter your details to start a conversation with our AI support.</p>
            <form class="ai-widget-lead-form">
                <div class="ai-widget-lead-field">
                    <label class="ai-widget-lead-label" for="lead-name">Name</label>
                    <input class="ai-widget-lead-input" type="text" id="lead-name" placeholder="John Doe" required />
                </div>
                <div class="ai-widget-lead-field">
                    <label class="ai-widget-lead-label" for="lead-email">Email</label>
                    <input class="ai-widget-lead-input" type="email" id="lead-email" placeholder="john@example.com" required />
                </div>
                ${showPhone ? `
                <div class="ai-widget-lead-field">
                    <label class="ai-widget-lead-label" for="lead-phone">Phone</label>
                    <input class="ai-widget-lead-input" type="tel" id="lead-phone" placeholder="+1 (555) 000-0000" required />
                </div>
                ` : ''}
                ${showCompany ? `
                <div class="ai-widget-lead-field">
                    <label class="ai-widget-lead-label" for="lead-company">Company</label>
                    <input class="ai-widget-lead-input" type="text" id="lead-company" placeholder="Acme Corp" required />
                </div>
                ` : ''}
                <div class="ai-widget-lead-error" id="lead-error"></div>
                <button class="ai-widget-lead-submit" type="submit">
                    Start Chatting
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                </button>
            </form>
        `;

        const form = overlay.querySelector('.ai-widget-lead-form') as HTMLFormElement;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('.ai-widget-lead-submit') as HTMLButtonElement;
            const errorDiv = form.querySelector('#lead-error') as HTMLElement;
            
            const nameInput = form.querySelector('#lead-name') as HTMLInputElement;
            const emailInput = form.querySelector('#lead-email') as HTMLInputElement;
            const phoneInput = showPhone ? form.querySelector('#lead-phone') as HTMLInputElement : null;
            const companyInput = showCompany ? form.querySelector('#lead-company') as HTMLInputElement : null;

            const name = nameInput.value.trim();
            const email = emailInput.value.trim();
            const phone = phoneInput ? phoneInput.value.trim() || null : null;
            const company = companyInput ? companyInput.value.trim() || null : null;

            let hasError = false;
            let errorMsg = '';

            const markInvalid = (input: HTMLInputElement) => {
                input.classList.add('invalid');
                setTimeout(() => input.classList.remove('invalid'), 400);
            };

            if (!name) {
                markInvalid(nameInput);
                hasError = true;
                errorMsg = 'Name is required. ';
            }
            if (!email) {
                markInvalid(emailInput);
                hasError = true;
                errorMsg += 'Email is required. ';
            } else if (!/\S+@\S+\.\S+/.test(email)) {
                markInvalid(emailInput);
                hasError = true;
                errorMsg += 'Invalid email format. ';
            }

            if (showPhone && !phone) {
                if (phoneInput) markInvalid(phoneInput);
                hasError = true;
                errorMsg += 'Phone number is required. ';
            }
            if (showCompany && !company) {
                if (companyInput) markInvalid(companyInput);
                hasError = true;
                errorMsg += 'Company name is required. ';
            }

            if (hasError) {
                errorDiv.textContent = errorMsg;
                errorDiv.style.display = 'block';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<div class="ai-widget-spinner"></div>';
            errorDiv.style.display = 'none';

            try {
                const response = await fetch(`${this.config.endpoint}/api/v1/widget/leads`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-widget-token': this.config.token,
                    },
                    body: JSON.stringify({
                        name,
                        email,
                        phone,
                        company,
                        conversation_id: this.conversationId || null,
                    }),
                });

                if (response.ok) {
                    this.isLeadSubmitted = true;
                    localStorage.setItem(`ai-widget-lead-submitted-${this.config.token}`, 'true');
                    
                    overlay.classList.add('fade-out');
                    setTimeout(() => {
                        overlay.remove();
                        this.connectWebSocket().catch(() => {
                            // HTTP fallback is used on send; ignore open-time WS failures
                        });
                        this.input.focus();
                    }, 450);
                } else {
                    const errData = await response.json().catch(() => ({}));
                    errorDiv.textContent = errData.message || 'Failed to submit details. Please try again.';
                    errorDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `
                        Start Chatting
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    `;
                }
            } catch (err) {
                console.error('Lead submission error:', err);
                errorDiv.textContent = 'Connection error. Please try again.';
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    Start Chatting
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                `;
            }
        });

        this.container.querySelector('.ai-widget-panel')?.appendChild(overlay);
    }

    private async connectWebSocket(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) return;
        if (this.connectionPromise) return this.connectionPromise;

        const wsUrl = this.config.endpoint
            .replace('https://', 'wss://')
            .replace('http://', 'ws://');

        this.connectionPromise = new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(
                `${wsUrl}/ws/chat?token=${encodeURIComponent(this.config.token)}&session=${encodeURIComponent(this.visitorSession())}`
            );
            this.ws = ws;

            ws.onopen = () => {
                this.reconnectAttempt = 0;
                this.connectionPromise = null;
                this.setInlineStatus(null);
                this.resumeConversationOnSocket();
                resolve();
            };

            ws.onmessage = (event) => {
                this.handleWebSocketMessage(event.data);
            };

            ws.onerror = () => {
                this.setInlineStatus('Live connection looks unstable. Messages will retry over HTTP if needed.', 'info');
                this.connectionPromise = null;
                reject(new Error('WebSocket connection failed'));
            };

            ws.onclose = () => {
                this.connectionPromise = null;
                this.ws = null;
                if (this.isTyping) {
                    this.tts.onResponseComplete();
                    this.finishTyping();
                    this.setInlineStatus('Connection closed before the reply finished. Please try sending again.', 'error');
                }
                this.scheduleReconnect();
            };
        });
        return this.connectionPromise;
    }

    private scheduleReconnect(): void {
        // Keep the socket alive for open chats AND inbox threads waiting on agent replies
        const hasWatched = !!this.conversationId || this.inboxIds().length > 0;
        if (this.reconnectTimer !== null || (!this.isOpen && !this.isTyping && !hasWatched)) return;
        const delay = Math.min(30_000, 500 * (2 ** this.reconnectAttempt++));
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket().catch(() => this.scheduleReconnect());
        }, delay);
    }

    private handleWebSocketMessage(data: string): void {
        try {
            const response: ChatResponse = JSON.parse(data);

            switch (response.type) {
                case 'conversationId':
                    this.conversationId = response.id!;
                    this.persistConversation();
                    this.resumeConversationOnSocket();
                    break;

                case 'agentMessage':
                    if (response.conversationId && response.content) {
                        this.handleAgentMessage(
                            response.conversationId,
                            response.content,
                            response.messageId
                        );
                    }
                    break;

                case 'token':
                    if (response.conversationId && response.conversationId !== this.conversationId) {
                        this.handleAgentMessage(response.conversationId, response.content || '');
                        break;
                    }
                    const lastMsg = this.messages[this.messages.length - 1];
                    if (!lastMsg || lastMsg.role !== 'assistant') {
                        // Spontaneous message from agent on active chat
                        this.addMessage({
                            id: `agent-reply-${Date.now()}`,
                            role: 'assistant',
                            content: response.content!,
                            timestamp: new Date(),
                        });
                        this.playNotificationSound();
                        if (!this.isOpen) {
                            this.unreadCount++;
                            this.updateBadge();
                        }
                    } else {
                        this.appendToLastMessage(response.content!);
                        this.tts.processText(response.content!);
                    }
                    break;

                case 'sources':
                    if (response.sources && response.sources.length > 0) {
                        this.renderSourcesForLastMessage(response.sources);
                    }
                    break;

                case 'done':
                    this.finishTyping();
                    if (response.sources && response.sources.length > 0) {
                        this.renderSourcesForLastMessage(response.sources);
                    }
                    if (response.messageId) {
                        this.renderFeedbackButtonsForLastMessage(response.messageId);
                    }
                    this.tts.onResponseComplete();
                    this.persistConversation();
                    const checkLastMsg = this.messages[this.messages.length - 1];
                    if (checkLastMsg && checkLastMsg.role === 'assistant' && 
                        checkLastMsg.content.includes("I don't have that specific information in my knowledge base.")) {
                        this.renderHandoffOptions();
                    }
                    break;

                case 'error':
                    if (!this.isTyping) {
                        console.warn('AI Widget: Background socket request failed', response.message);
                        break;
                    }
                    this.finishTyping();
                    this.setInlineStatus('Something went wrong while generating the reply. Please try again.', 'error');
                    this.addMessage({
                        id: Date.now().toString(),
                        role: 'assistant',
                        content: 'Our AI is experiencing high volume. Please leave your email, or a human agent will be with you shortly.',
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

        this.setInlineStatus(null);

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
        this.tts.onUserMessage();

        // Show typing indicator
        this.isTyping = true;
        this.updateSendButtonState();
        this.showTypingIndicator();

        // Connect if needed
        try {
            await this.connectWebSocket();
        } catch {
            await this.sendViaHttp(content);
            return;
        }

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
                    ...this.sessionHeaders(),
                },
                body: JSON.stringify({
                    message: content,
                    conversationId: this.conversationId,
                    workspaceId: this.config.workspaceId || undefined,
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

            let sseBuffer = '';
            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, { stream: true });
                const events = sseBuffer.split(/\r?\n\r?\n/);
                sseBuffer = events.pop() || '';
                for (const event of events) {
                    for (const line of event.split(/\r?\n/)) {
                    if (line.startsWith('data: ')) {
                        const data: ChatResponse = JSON.parse(line.slice(6));
                        if (data.type === 'token') {
                            this.appendToLastMessage(data.content || '');
                            this.tts.processText(data.content || '');
                        } else if (data.type === 'conversationId') {
                            this.conversationId = data.id || null;
                            this.persistConversation();
                        } else if (data.type === 'status') {
                            this.updateTypingIndicator(data.message || 'Processing...');
                        } else if (data.type === 'sources' && data.sources) {
                            this.renderSourcesForLastMessage(data.sources);
                        } else if (data.type === 'done') {
                            this.finishTyping();
                            if (data.sources) this.renderSourcesForLastMessage(data.sources);
                            if (data.messageId) {
                                this.renderFeedbackButtonsForLastMessage(data.messageId);
                            }
                            this.tts.onResponseComplete();
                            this.persistConversation();
                            const checkLastMsg = this.messages[this.messages.length - 1];
                            if (checkLastMsg && checkLastMsg.role === 'assistant' && 
                                checkLastMsg.content.includes("I don't have that specific information in my knowledge base.")) {
                                this.renderHandoffOptions();
                            }
                        }
                    }
                    }
                }
            }

            this.tts.onResponseComplete();
            this.finishTyping();
        } catch (error) {
            console.error('AI Widget: HTTP request failed', error);
            this.finishTyping();
            this.setInlineStatus('Message failed to send. Please check your connection and try again.', 'error');
            this.addMessage({
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Our AI is experiencing high volume. Please leave your email, or a human agent will be with you shortly.',
                timestamp: new Date(),
            });
        }
    }

    private addMessage(message: Message, options: { persist?: boolean } = {}): void {
        this.messages.push(message);

        const el = document.createElement('div');
        el.className = `ai-widget-message ${message.role}`;
        el.dataset.id = message.id;
        el.innerHTML = `<div class="ai-widget-message-content">${this.formatContent(message.content)}</div>`;

        this.messagesContainer.appendChild(el);
        this.scrollToBottom();

        if (options.persist !== false) {
            this.persistConversation();
        }
    }

    private appendToLastMessage(token: string): void {
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content += token;

            if (this.renderFrame === null) {
                this.renderFrame = requestAnimationFrame(() => {
                    this.renderFrame = null;
                    const current = this.messages[this.messages.length - 1];
                    if (!current || current.role !== 'assistant') return;
                    const el = this.messagesContainer.querySelector(
                        `[data-id="${current.id}"] .ai-widget-message-content`
                    );
                    if (el) el.innerHTML = this.formatContent(current.content);
                    this.scrollToBottom();
                });
            }
        }
    }

    private renderSourcesForLastMessage(sources: Source[]): void {
        if (this.settings?.showSourcesInWidget === false) {
            return;
        }
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            const el = this.messagesContainer.querySelector(`[data-id="${lastMessage.id}"]`);
            if (el) {
                // Check if sources are already rendered
                if (el.querySelector('.ai-widget-sources')) return;

                const sourcesEl = document.createElement('div');
                sourcesEl.className = 'ai-widget-sources';
                sourcesEl.innerHTML = DOMPurify.sanitize(`
                    <div class="ai-widget-sources-title">Sources:</div>
                    <div class="ai-widget-sources-list">
                        ${sources.map(source => {
                            const url = source.url.startsWith('/') ? `${this.config.endpoint}${source.url}` : source.url;
                            return `
                                <a href="${url}" target="_blank" rel="noopener noreferrer" class="ai-widget-source-pill">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ai-widget-source-icon"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                    <span>${source.title}</span>
                                </a>
                            `;
                        }).join('')}
                    </div>
                `, { ALLOWED_TAGS: ['div', 'a', 'span', 'svg', 'path'], ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd'] });
                el.appendChild(sourcesEl);
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
        const result = parts.map(part => {
            if (part.startsWith('<pre>')) return part;
            return part.replace(/\n/g, '<br>');
        }).join('').trim();
        return DOMPurify.sanitize(result, { ALLOWED_TAGS: ['strong', 'em', 'code', 'pre', 'br', 'a', 'ul', 'li'], ALLOWED_ATTR: ['href', 'target', 'rel'] });
    }

    private typingInterval: number | null = null;

    private showTypingIndicator(): void {
        const indicator = document.createElement('div');
        indicator.className = 'ai-widget-typing';
        indicator.innerHTML = `
            <div class="ai-widget-status-text">Thinking...</div>
            <div class="ai-widget-typing-dots"><span></span><span></span><span></span></div>
        `;
        this.messagesContainer.appendChild(indicator);
        this.scrollToBottom();

        const statuses = ['Thinking...', 'Analyzing knowledge base...', 'Reviewing context...', 'Generating response...'];
        let i = 0;
        this.typingInterval = window.setInterval(() => {
            i = (i + 1) % statuses.length;
            const textEl = indicator.querySelector('.ai-widget-status-text');
            if (textEl) textEl.textContent = statuses[i];
        }, 3500);
    }

    private hideTypingIndicator(): void {
        if (this.typingInterval !== null) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
        }
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
        indicator.replaceChildren();
        const text = document.createElement('span');
        text.className = 'ai-widget-status-text';
        text.textContent = message;
        const d1 = document.createElement('span');
        const d2 = document.createElement('span');
        const d3 = document.createElement('span');
        indicator.append(text, d1, d2, d3);
        this.scrollToBottom();
    }

    private scrollToBottom(): void {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // STT (Speech-to-Text) methods
    private toggleMic(): void {
        // if (!this.stt.isSupported()) {
        //     console.warn('[Widget] STT not supported in this browser');
        //     return;
        // }
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

        this.updateSendButtonState();
    }

    private handleSTTStateChange(state: STTState): void {
        this.updateMicButton();
        if (state === 'loading') {
            this.showStatus('Downloading Whisper STT model (~45MB)...', 'info');
        } else if (state === 'ready') {
            this.showStatus('Whisper STT ready', 'info');
            setTimeout(() => this.showStatus(''), 2000);
        } else if (state === 'listening') {
            this.showStatus('Listening...', 'info');
        } else if (state === 'processing') {
            this.showStatus('Processing audio...', 'info');
        } else if (state === 'error' || state === 'idle') {
            this.showStatus('');
        }
    }

    private showStatus(message: string, type: 'info' | 'error' = 'info'): void {
        if (!this.inlineStatus) return;
        this.inlineStatus.textContent = message;
        this.inlineStatus.style.display = message ? 'block' : 'none';
        
        if (type === 'error') {
            this.inlineStatus.classList.add('error');
        } else {
            this.inlineStatus.classList.remove('error');
        }
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

    // Helper methods for feedback and handoff features
    private renderFeedbackButtonsForLastMessage(messageId: string): void {
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            const el = this.messagesContainer.querySelector(`[data-id="${lastMessage.id}"]`);
            if (el) {
                if (el.querySelector('.ai-widget-feedback')) return;

                const feedbackEl = document.createElement('div');
                feedbackEl.className = 'ai-widget-feedback';
                feedbackEl.innerHTML = `
                    <button class="ai-widget-feedback-btn up" title="Helpful" aria-label="Helpful">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                    </button>
                    <button class="ai-widget-feedback-btn down" title="Not Helpful" aria-label="Not Helpful">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
                    </button>
                `;
                el.appendChild(feedbackEl);

                const upBtn = feedbackEl.querySelector('.up') as HTMLButtonElement;
                const downBtn = feedbackEl.querySelector('.down') as HTMLButtonElement;

                const submitFeedback = async (isHelpful: boolean, clickedBtn: HTMLButtonElement, otherBtn: HTMLButtonElement) => {
                    try {
                        const response = await fetch(`${this.config.endpoint}/api/v1/widget/messages/${messageId}/feedback`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-widget-token': this.config.token,
                            },
                            body: JSON.stringify({
                                is_helpful: isHelpful,
                                comment: null
                            })
                        });

                        if (response.ok) {
                            clickedBtn.classList.add('active');
                            otherBtn.classList.remove('active');
                            clickedBtn.disabled = true;
                            otherBtn.disabled = true;
                        }
                    } catch (e) {
                        console.error('Failed to submit feedback', e);
                    }
                };

                upBtn.addEventListener('click', () => submitFeedback(true, upBtn, downBtn));
                downBtn.addEventListener('click', () => submitFeedback(false, downBtn, upBtn));
            }
        }
    }

    private renderHandoffOptions(): void {
        const existingHandoff = this.messagesContainer.querySelector('.ai-widget-handoff-container');
        if (existingHandoff) {
            existingHandoff.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        const handoffConfig = this.settings?.handoffConfig;
        const el = document.createElement('div');
        el.className = 'ai-widget-message assistant ai-widget-handoff-container';
        
        let optionsHtml = '';
        
        if (handoffConfig?.whatsapp_number) {
            const waNumber = handoffConfig.whatsapp_number.replace(/\D/g, '');
            optionsHtml += `
                <a href="https://wa.me/${waNumber}?text=Hello,%20I%20need%20help%20with%20my%20support%20request.%20Ref:%20${this.conversationId || ''}" 
                   target="_blank" rel="noopener noreferrer" class="ai-widget-handoff-btn wa">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    WhatsApp
                </a>
            `;
        }

        if (handoffConfig?.email_recipient) {
            optionsHtml += `
                <a href="mailto:${handoffConfig.email_recipient}?subject=Support%20Request%20(${this.conversationId || ''})&body=Hi%20Support,%0D%0A%0D%0AI%20need%20assistance.%0D%0A%0D%0AReference%20ID:%20${this.conversationId || ''}" 
                   class="ai-widget-handoff-btn email">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    Email Support
                </a>
            `;
        }

        if (handoffConfig?.has_webhook) {
            optionsHtml += `
                <button class="ai-widget-handoff-btn ticket-trigger">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    Submit Ticket
                </button>
            `;
        }

        optionsHtml += `
            <button class="ai-widget-handoff-btn live-agent">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                Talk to Live Agent
            </button>
        `;

        el.innerHTML = `
            <div class="ai-widget-message-content" style="width: 100%;">
                <div class="ai-widget-handoff-title">Would you like to talk to a human?</div>
                <div class="ai-widget-handoff-choices">
                    ${optionsHtml}
                </div>
                <div class="ai-widget-ticket-form" style="display: none; margin-top: 12px; width: 100%;">
                    <textarea class="ai-widget-ticket-desc" placeholder="Describe your issue..." rows="3" style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 8px; border: 1px solid var(--ai-border); background: var(--ai-bg-secondary); color: var(--ai-text); resize: none; margin-bottom: 8px; font-family: inherit; font-size: 13px;"></textarea>
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="ai-widget-ticket-cancel" style="background: none; border: 1px solid var(--ai-border); color: var(--ai-text); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">Cancel</button>
                        <button class="ai-widget-ticket-submit" style="background: var(--ai-primary); border: none; color: white; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">Submit</button>
                    </div>
                </div>
            </div>
        `;

        this.messagesContainer.appendChild(el);
        this.scrollToBottom();

        const liveBtn = el.querySelector('.live-agent') as HTMLButtonElement;
        if (liveBtn) {
            liveBtn.addEventListener('click', () => {
                this.requestLiveAgentTakeover(el);
            });
        }

        const ticketBtn = el.querySelector('.ticket-trigger') as HTMLButtonElement;
        if (ticketBtn) {
            const ticketForm = el.querySelector('.ai-widget-ticket-form') as HTMLElement;
            const choices = el.querySelector('.ai-widget-handoff-choices') as HTMLElement;
            const cancelBtn = el.querySelector('.ai-widget-ticket-cancel') as HTMLButtonElement;
            const submitBtn = el.querySelector('.ai-widget-ticket-submit') as HTMLButtonElement;
            const descArea = el.querySelector('.ai-widget-ticket-desc') as HTMLTextAreaElement;

            ticketBtn.addEventListener('click', () => {
                choices.style.display = 'none';
                ticketForm.style.display = 'block';
                descArea.focus();
            });

            cancelBtn.addEventListener('click', () => {
                ticketForm.style.display = 'none';
                choices.style.display = 'flex';
            });

            submitBtn.addEventListener('click', async () => {
                const desc = descArea.value.trim();
                if (!desc) {
                    descArea.classList.add('invalid');
                    setTimeout(() => descArea.classList.remove('invalid'), 400);
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting...';

                try {
                    if (this.conversationId) {
                        await fetch(
                            `${this.config.endpoint}/api/v1/widget/conversations/${this.conversationId}/handoff?session=${encodeURIComponent(this.visitorSession())}`,
                            {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-widget-token': this.config.token,
                                ...this.sessionHeaders(),
                            },
                            body: JSON.stringify({ ticket_description: desc }),
                        });
                    }

                    this.addMessage({
                        id: `ticket-msg-${Date.now()}`,
                        role: 'user',
                        content: `Ticket Submitted: ${desc}`,
                        timestamp: new Date()
                    });

                    ticketForm.innerHTML = `<div style="color: var(--ai-primary); font-size: 13px; font-weight: 500;">Ticket submitted successfully! A representative will follow up.</div>`;
                    setTimeout(() => {
                        el.remove();
                    }, 3000);
                } catch (e) {
                    console.error(e);
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit';
                }
            });
        }
    }

    private async requestLiveAgentTakeover(containerEl: HTMLElement): Promise<void> {
        if (!this.conversationId) return;

        const liveBtn = containerEl.querySelector('.live-agent') as HTMLButtonElement;
        if (liveBtn) {
            liveBtn.disabled = true;
            liveBtn.innerHTML = '<div class="ai-widget-spinner" style="width: 14px; height: 14px; margin: 0 auto; border-color: var(--ai-primary);"></div>';
        }

        this.setInlineStatus(null);

        try {
            const response = await fetch(
                `${this.config.endpoint}/api/v1/widget/conversations/${this.conversationId}/handoff?session=${encodeURIComponent(this.visitorSession())}`,
                {
                method: 'POST',
                headers: {
                    'x-widget-token': this.config.token,
                    ...this.sessionHeaders(),
                }
            });

            if (response.ok) {
                this.addMessage({
                    id: `takeover-msg-${Date.now()}`,
                    role: 'assistant',
                    content: 'Live agent takeover requested. A support agent will be with you shortly.',
                    timestamp: new Date()
                });
                containerEl.remove();
            } else {
                throw new Error('Takeover failed');
            }
        } catch (e) {
            console.error(e);
            if (liveBtn) {
                liveBtn.disabled = false;
                this.restoreLiveAgentButton(liveBtn);
            }
            this.setInlineStatus('Could not request a live agent right now. Please try again.', 'error');
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
