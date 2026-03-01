import type { SiteAdapter } from '../types.ts'

function querySelector(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

function getVisibleInput(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    'textarea, [contenteditable="true"], [role="textbox"]'
  )
  const visible = Array.from(candidates).filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  return visible.length > 0 ? visible[visible.length - 1] : null
}

function getTextFromElement(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value
  }
  return el.innerText || el.textContent || ''
}

function setTextOnElement(el: HTMLElement, text: string) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, text)
    } else {
      el.value = text
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    el.innerText = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

const chatgptAdapter: SiteAdapter = {
  name: 'ChatGPT',
  isContentEditable: true,
  getInputElement: () => querySelector([
    '#prompt-textarea',
    'div[contenteditable="true"][id="prompt-textarea"]',
    'textarea[data-id="root"]',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'form button[type="submit"]',
  ]),
  getResponseContainer: () => querySelector([
    'div[data-message-author-role="assistant"]:last-of-type',
    '.agent-turn:last-of-type',
  ]),
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

const claudeAdapter: SiteAdapter = {
  name: 'Claude',
  isContentEditable: true,
  getInputElement: () => querySelector([
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    'fieldset div[contenteditable="true"]',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'fieldset button:last-of-type',
  ]),
  getResponseContainer: () => {
    const msgs = document.querySelectorAll<HTMLElement>('[data-is-streaming], .font-claude-message')
    return msgs.length > 0 ? msgs[msgs.length - 1] : null
  },
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

const geminiAdapter: SiteAdapter = {
  name: 'Gemini',
  isContentEditable: true,
  getInputElement: () => querySelector([
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][aria-label]',
    'rich-textarea div[contenteditable="true"]',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[aria-label="Send message"]',
    'button.send-button',
    'mat-icon-button[aria-label="Send message"]',
  ]),
  getResponseContainer: () => querySelector([
    'message-content:last-of-type',
    'model-response:last-of-type',
  ]),
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

const grokAdapter: SiteAdapter = {
  name: 'Grok',
  isContentEditable: true,
  getInputElement: () => querySelector([
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    '.query-bar div[contenteditable="true"]',
    'div[contenteditable="true"][tabindex="0"]',
    'textarea',
    'div[contenteditable="true"]',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[aria-label="Submit"]',
    'button[type="submit"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
  ]),
  getResponseContainer: () => {
    const msgs = document.querySelectorAll<HTMLElement>('.message-bubble, [data-testid*="message"], [class*="response"]')
    return msgs.length > 0 ? msgs[msgs.length - 1] : null
  },
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

const copilotAdapter: SiteAdapter = {
  name: 'Copilot',
  isContentEditable: true,
  getInputElement: () => querySelector([
    '#searchbox textarea',
    'textarea[placeholder]',
    'cib-text-input textarea',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
  ]),
  getResponseContainer: () => querySelector([
    'cib-message-group[source="bot"]:last-of-type',
  ]),
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

const deepseekAdapter: SiteAdapter = {
  name: 'DeepSeek',
  isContentEditable: false,
  getInputElement: () => querySelector([
    'textarea#chat-input',
    'textarea',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'div[role="button"][aria-disabled]',
    'button[type="submit"]',
  ]),
  getResponseContainer: () => {
    const msgs = document.querySelectorAll<HTMLElement>('.markdown-body')
    return msgs.length > 0 ? msgs[msgs.length - 1] : null
  },
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

function showClipboardToast() {
  const existing = document.querySelector('.pii-shield-clipboard-toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = 'pii-shield-clipboard-toast'
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #2E3440;
    border: 1px solid #88C0D0;
    color: #ECEFF4;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    gap: 8px;
    animation: pii-toast-in 0.2s ease-out;
  `
  toast.innerHTML = `<span style="color:#A3BE8C;">&#10003;</span> Copied redacted text — paste it into the input`
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

const perplexityAdapter: SiteAdapter = {
  name: 'Perplexity',
  isContentEditable: false,
  getInputElement: () => querySelector([
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="follow-up"]',
    'textarea',
  ]) || getVisibleInput(),
  getSendButton: () => querySelector([
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    'button.bg-super',
  ]),
  getResponseContainer: () => {
    const msgs = document.querySelectorAll<HTMLElement>('.prose, .markdown-content')
    return msgs.length > 0 ? msgs[msgs.length - 1] : null
  },
  getInputText: getTextFromElement,
  setInputText: (_el: HTMLElement, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showClipboardToast()
    })
  },
}

const fallbackAdapter: SiteAdapter = {
  name: 'Generic',
  isContentEditable: false,
  getInputElement: getVisibleInput,
  getSendButton: () => null,
  getResponseContainer: () => null,
  getInputText: getTextFromElement,
  setInputText: setTextOnElement,
}

export function detectSite(): SiteAdapter {
  const host = window.location.hostname
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return chatgptAdapter
  if (host.includes('claude.ai')) return claudeAdapter
  if (host.includes('gemini.google.com')) return geminiAdapter
  if (host.includes('grok.com') || host.includes('x.com')) return grokAdapter
  if (host.includes('copilot.microsoft.com')) return copilotAdapter
  if (host.includes('chat.deepseek.com')) return deepseekAdapter
  if (host.includes('perplexity.ai')) return perplexityAdapter
  return fallbackAdapter
}
