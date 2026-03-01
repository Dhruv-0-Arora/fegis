import { state, applyOutgoingReplacements } from './interceptors/shared.ts';
import type { Replacement } from './interceptors/shared.ts';
import { handleChatGPTStream } from './interceptors/chatgpt.ts';

const isChatGPT = window.location.hostname.includes('chatgpt.com');
const isGemini = window.location.hostname.includes('gemini.google.com');

if (isChatGPT || isGemini) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'PII_SHIELD_EXT' && e.data.type === 'SYNC_REPLACEMENTS') {
      state.isAutoReplace = e.data.autoReplace;
      const unique = new Map<string, string>();
      for (const r of e.data.replacements || []) {
        unique.set(r.fake, r.original);
      }
      state.activeReplacements = Array.from(unique.entries()).map(([fake, original]) => ({ original, fake } as Replacement));
    }
  });

  // -----------------------------------------------------
  // 1) Intercept Fetch Requests (Outgoing & Incoming ChatGPT)
  // -----------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    if (state.activeReplacements.length > 0) {
      if (args[1] && args[1].body && typeof args[1].body === 'string') {
        args[1].body = applyOutgoingReplacements(args[1].body);
      }
    }

    const response = await originalFetch.apply(this, args);

    // Incoming stream: only replace fake→original when autoReplace is ON.
    // When OFF, the raw response (containing fakes/tokens) passes through unchanged
    // and the DOM mutation observer handles display.
    if (state.isAutoReplace && state.activeReplacements.length > 0) {
      if (isChatGPT) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
        const method = (args[1]?.method || (args[0] as Request)?.method || 'GET').toUpperCase();
        const contentType = response.headers.get('content-type') || '';
        const isEventStream = contentType.includes('text/event-stream');
        // Only intercept POST to the conversation endpoint (the actual chat stream)
        const isConversationPost = method === 'POST' && /\/conversation\/?$/.test(url.split('?')[0]);
        
        if (isEventStream || isConversationPost) {
          console.log('[PII Shield] Intercepting ChatGPT stream:', url);
          return handleChatGPTStream(response);
        }
      }
    }

    return response;
  };

  // -----------------------------------------------------
  // 2) Intercept XHR (Outgoing ONLY)
  // -----------------------------------------------------
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body: Document | XMLHttpRequestBodyInit | null | undefined) {
    if (state.activeReplacements.length > 0) {
      if (typeof body === 'string') {
        body = applyOutgoingReplacements(body);
      }
    }

    return originalXHRSend.call(this, body);
  };

  // -----------------------------------------------------
  // 3) Intercept WebSocket (Outgoing ONLY)
  // -----------------------------------------------------
  const NativeWebSocket = window.WebSocket;
  class InterceptedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (state.activeReplacements.length > 0) {
        if (typeof data === 'string') {
          data = applyOutgoingReplacements(data);
        }
      }
      super.send(data);
    }
  }
  window.WebSocket = InterceptedWebSocket as any;

  console.log(`[PII Shield] OUTGOING Network Interceptor initialized for ${isChatGPT ? 'ChatGPT' : 'Gemini'}`);
}
