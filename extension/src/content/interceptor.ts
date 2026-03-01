import type { SiteAdapter, PIIMatch, TokenMap } from '../types.ts'
import { getTokenMap, getReplacementMap } from '../tokens/manager.ts'
import { showBlockWarning } from './highlighter.ts'

let lastMatches: PIIMatch[] = []
let interceptActive = false
let isAutoReplace = false

export function setCurrentMatches(matches: PIIMatch[], autoReplace: boolean = false) {
  lastMatches = matches
  isAutoReplace = autoReplace
}

export function setupInterceptor(adapter: SiteAdapter) {
  if (interceptActive) return
  interceptActive = true

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isAutoReplace) return
      const inputEl = adapter.getInputElement()
      if (!inputEl || lastMatches.length === 0) return
      if (document.activeElement !== inputEl && !inputEl.contains(document.activeElement)) return

      const text = adapter.getInputText(inputEl)
      if (!text.trim()) return

      e.preventDefault()
      e.stopPropagation()

      showBlockWarning()
    }
  }, true)

  const sendBtn = adapter.getSendButton()
  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      if (isAutoReplace) return
      if (lastMatches.length === 0) return

      const inputEl = adapter.getInputElement()
      if (!inputEl) return

      const text = adapter.getInputText(inputEl)
      if (!text.trim()) return

      e.preventDefault()
      e.stopPropagation()

      showBlockWarning()
    }, true)
  }
}

export function setupResponseUnmasking(_adapter: SiteAdapter) {
  const observer = new MutationObserver((mutations) => {
    const tokenMap = getTokenMap()
    if (Object.keys(tokenMap).length === 0) return

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            unmaskResponseElement(node as HTMLElement, tokenMap);
          }
        }
      } else if (mutation.type === 'characterData') {
        if (mutation.target.nodeType === Node.TEXT_NODE && mutation.target.parentElement) {
          unmaskResponseElement(mutation.target.parentElement, tokenMap);
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unmaskResponseElement(container: HTMLElement, _tokenMap: TokenMap) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const textNodes: Text[] = []

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node)
  }

  // Build fake→original and original→fake maps from replacement map
  const replacementMap = getReplacementMap()
  const fakeToOriginal: Record<string, string> = {};
  const fakeToType: Record<string, string> = {};
  const originalToFake: Record<string, string> = {};
  for (const [key, fake] of Object.entries(replacementMap)) {
    // key is "TYPE:originalText"
    const colonIdx = key.indexOf(':');
    if (colonIdx > -1 && typeof fake === 'string') {
      const piiType = key.substring(0, colonIdx);
      const original = key.substring(colonIdx + 1);
      if (original) {
        fakeToOriginal[fake] = original;
        fakeToType[fake] = piiType;
        originalToFake[original] = fake;
      }
    }
  }

  // Build reverse lookup: original value → token
  const originalToToken: Record<string, string> = {};
  const originalToType: Record<string, string> = {};
  for (const [token, orig] of Object.entries(_tokenMap)) {
    originalToToken[orig] = token;
    // Extract type from token like [address_1] → ADDRESS
    const typeMatch = token.match(/^\[([a-z]+)_\d+\]$/);
    if (typeMatch) {
      originalToType[orig] = typeMatch[1].toUpperCase();
    }
  }

  // Helper: given a value (original PII text), resolve its anonymized token.
  // Returns '[xxx_N]' format or 'unknown' if not found.
  function resolveToken(value: string): string {
    if (originalToToken[value]) return originalToToken[value];
    // Fallback: scan token map values
    for (const [tok, orig] of Object.entries(_tokenMap)) {
      if (orig === value) return tok;
    }
    return 'unknown';
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement
    if (!parent) continue;
    
    // Do not process text inside input boxes or already unmasked nodes
    if (parent.closest('.pii-shield-unmasked') || 
        parent.closest('.pii-shield-user-msg') ||
        parent.closest('.pii-shield-highlight-layer') ||
        parent.closest('.pii-shield-tooltip') ||
        parent.closest('.pii-shield-badge') ||
        parent.closest('textarea') || 
        parent.closest('[contenteditable="true"]') ||
        parent.tagName === 'TEXTAREA' || 
        parent.tagName === 'INPUT' ||
        parent.tagName === 'SCRIPT' ||
        parent.tagName === 'STYLE' ||
        parent.tagName === 'NOSCRIPT') continue;

    const originalText = textNode.textContent || ''
    if (!originalText.trim()) continue;

    // Build the search patterns
    const patterns: string[] = [];

    // 1. Match tokens like [name_1], [address_1], etc.
    patterns.push('\\[[a-z]+_\\d+\\]');

    // 2. Token map keys (the tokens themselves, e.g. "[address_1]")
    //    and values (the originals, e.g. "123 Main St")
    for (const [token, originalVal] of Object.entries(_tokenMap)) {
      patterns.push(escapeRegExp(token));
      patterns.push(escapeRegExp(originalVal));
    }

    // 3. Fake-to-original entries
    for (const [fake, originalVal] of Object.entries(fakeToOriginal)) {
      patterns.push(escapeRegExp(fake));
      patterns.push(escapeRegExp(originalVal));
    }

    // Deduplicate and filter empty
    const uniquePatterns = [...new Set(patterns)].filter(p => p.length > 0);
    if (uniquePatterns.length === 0) continue;

    const regex = new RegExp(`(${uniquePatterns.join('|')})`, 'g');
    
    if (!regex.test(originalText)) continue;

    // We found a match in this text node. Let's split it!
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    // reset regex
    regex.lastIndex = 0;
    
    let match;
    while ((match = regex.exec(originalText)) !== null) {
      const matchText = match[0];
      const beforeText = originalText.substring(lastIndex, match.index);
      if (beforeText) {
        fragment.appendChild(document.createTextNode(beforeText));
      }

      const span = document.createElement('span');
      span.style.textUnderlineOffset = '4px';
      span.style.cursor = 'help';

      if (_tokenMap[matchText]) {
        // matchText is a token like [address_1] → show original or token based on toggle
        const tokenType = matchText.match(/^\[([a-z]+)_\d+\]$/)?.[1]?.toUpperCase() || 'NAME';
        span.className = 'pii-shield-unmasked';
        span.style.textDecoration = isAutoReplace ? 'underline dashed #a3be8c' : 'underline dashed #81a1c1';
        span.dataset.piiSentAs = matchText;
        span.dataset.piiToken = matchText;
        span.dataset.piiOriginal = _tokenMap[matchText];
        span.dataset.piiType = tokenType;
        span.textContent = isAutoReplace ? _tokenMap[matchText] : matchText;
      } else if (fakeToOriginal[matchText]) {
        // matchText is a fake value → find the corresponding token
        const origVal = fakeToOriginal[matchText];
        const token = resolveToken(origVal);
        const piiType = fakeToType[matchText] || originalToType[origVal] || 'NAME';
        span.className = 'pii-shield-unmasked';
        span.style.textDecoration = isAutoReplace ? 'underline dashed #a3be8c' : 'underline dashed #81a1c1';
        span.dataset.piiSentAs = matchText;
        span.dataset.piiToken = token;
        span.dataset.piiOriginal = origVal;
        span.dataset.piiType = piiType;
        span.dataset.piiFake = matchText;
        span.textContent = isAutoReplace ? origVal : matchText;
      } else {
        // matchText is an original value that appeared in the response
        // (likely because the stream already replaced fake→original)
        const token = resolveToken(matchText);
        const piiType = originalToType[matchText] || 'NAME';
        const fakeVal = originalToFake[matchText] || '';
        span.className = 'pii-shield-unmasked';
        span.style.textDecoration = isAutoReplace ? 'underline dashed #a3be8c' : 'underline dashed #ebcb8b';
        span.dataset.piiSentAs = isAutoReplace ? token : (fakeVal || token);
        span.dataset.piiToken = token;
        span.dataset.piiOriginal = matchText;
        span.dataset.piiType = piiType;
        span.dataset.piiFake = fakeVal;
        span.textContent = isAutoReplace ? matchText : (fakeVal || token);
      }
      
      fragment.appendChild(span);
      lastIndex = regex.lastIndex;
    }

    const afterText = originalText.substring(lastIndex);
    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

/**
 * Immediately re-apply or revert unmasking on all existing `.pii-shield-unmasked` spans.
 * Called when the user toggles Auto Replace on/off.
 *  - autoReplace ON  → show original PII text
 *  - autoReplace OFF → show token/fake text (what ChatGPT saw)
 */
export function reapplyUnmasking(autoReplace: boolean) {
  isAutoReplace = autoReplace;
  const spans = document.querySelectorAll<HTMLElement>('.pii-shield-unmasked');
  for (const span of spans) {
    const original = span.dataset.piiOriginal || '';
    const token = span.dataset.piiToken || '';
    const fake = span.dataset.piiFake || '';

    if (autoReplace) {
      // Show original PII text
      span.textContent = original;
      span.style.textDecoration = 'underline dashed #a3be8c';
    } else {
      // Show what was actually sent: prefer fake value if one exists, otherwise token
      span.textContent = fake || token;
      span.style.textDecoration = 'underline dashed #81a1c1';
    }
  }
}
