import type { SiteAdapter, PIIMatch, TokenMap } from '../types.ts'
import { detokenize, getTokenMap } from '../tokens/manager.ts'
import { showBlockWarning } from './highlighter.ts'

let lastMatches: PIIMatch[] = []
let interceptActive = false

export function setCurrentMatches(matches: PIIMatch[]) {
  lastMatches = matches
}

export function setupInterceptor(adapter: SiteAdapter) {
  if (interceptActive) return
  interceptActive = true

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

export function setupResponseUnmasking(adapter: SiteAdapter) {
  const observer = new MutationObserver(() => {
    const container = adapter.getResponseContainer()
    if (!container) return

    const tokenMap = getTokenMap()
    if (Object.keys(tokenMap).length === 0) return

    const text = container.innerText || ''
    if (!/\[[a-z]+_\d+\]/.test(text)) return

    unmaskResponseElement(container, tokenMap)
  })

  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

function unmaskResponseElement(container: HTMLElement, _tokenMap: TokenMap) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const textNodes: Text[] = []

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    if (/\[[a-z]+_\d+\]/.test(node.textContent || '')) {
      textNodes.push(node)
    }
  }

  for (const textNode of textNodes) {
    const original = textNode.textContent || ''
    const unmasked = detokenize(original)
    if (unmasked !== original) {
      const span = document.createElement('span')
      span.className = 'pii-shield-unmasked'
      span.title = 'Unmasked by Fegis'
      span.textContent = unmasked
      textNode.parentNode?.replaceChild(span, textNode)
    }
  }
}
