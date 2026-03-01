import { detectSite } from './sites.ts'
import { analyzeText } from '../detectors/engine.ts'
import { createHighlightLayer, renderHighlights, cleanup, showTooltip, scheduleHide, setReplaceCallback, updateInspectPanelData, hideInspectPanel, resetActiveMode, hideTooltip, hideBadge, getState, cleanupAllUI } from './highlighter.ts'
import { setCurrentMatches, setFileBlocked, setupInterceptor, setupResponseUnmasking, reapplyUnmasking } from './interceptor.ts'
import { watchForInput, stopWatching } from './observer.ts'
import { loadTokenMap, loadReplacementMap, getFakeReplacement, saveReplacementMap, saveTokenMap, getTokenMap, getReplacementMap, getTokenForMatch, getKnownFakeValues } from '../tokens/manager.ts'
import { setupFileHandler, updateFileHandlerSettings, type FileDetectionResult } from './file-handler.ts'
import { showFileWarning, showScanningIndicator, hideScanningIndicator } from './file-warning.ts'
import type { PIIMatch, ExtensionSettings, PIIType } from '../types.ts'

let enabled = true
let autoReplace = false
let activeMode: 'original' | 'labels' | 'replaced' = 'replaced'
let enabledTypes: PIIType[] = ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH']
let customBlockList: string[] = []
let ignoredTokens = new Set<string>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null
let currentInputEl: HTMLElement | null = null
let lastProcessedText = ''
let currentMatches: PIIMatch[] = []
let dead = false
let storedOriginalText: string | null = null
let storedMatches: PIIMatch[] = []
let scanningIndicator: HTMLDivElement | null = null
let activeScanCount = 0
let cleanupFileHandler: (() => void) | null = null

const adapter = detectSite()

function isContextValid(): boolean {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime?.id)
  } catch {
    return false
  }
}

function safeSendMessage(msg: Record<string, unknown>, cb?: (res: unknown) => void) {
  if (!isContextValid()) return
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) { /* context died between check and call */ }
      else if (cb) cb(res)
    })
  } catch {
    gracefulShutdown()
  }
}

function gracefulShutdown() {
  if (dead) return
  dead = true
  console.log('[Fegis] Extension context invalidated -- shutting down gracefully')
  cleanup()
  stopWatching()
  if (debounceTimer) clearTimeout(debounceTimer)
  if (syncTimer) clearInterval(syncTimer)
  currentInputEl = null
}

function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value
  }
  return el.innerText || el.textContent || ''
}

function syncReplacements() {
  const replacements = currentMatches.map(m => {
    // Auto-replace mode always uses tokens; manual mode respects user's choice
    const useTokens = autoReplace || activeMode === 'labels';
    return { original: m.text, fake: useTokens ? getTokenForMatch(m) : getFakeReplacement(m) };
  });
  window.postMessage({
    source: 'PII_SHIELD_EXT',
    type: 'SYNC_REPLACEMENTS',
    autoReplace,
    replacements
  }, '*');
  saveTokenMap();
  saveReplacementMap();
}

/**
 * Strip PII-shield highlight wrappers from the input element so they
 * don't bleed into the chat history when the message is committed.
 */
function stripHighlightWrappersFromInput() {
  if (!currentInputEl) return
  // The highlight marks live in the overlay, not the actual input, so they
  // shouldn't be in the input DOM.  But for contenteditable elements, the
  // site may copy inner HTML. Defensively remove any .pii-shield-mark or
  // .pii-shield-unmasked spans that somehow ended up inside the input.
  const marks = currentInputEl.querySelectorAll('.pii-shield-mark, .pii-shield-unmasked, .pii-shield-highlight-layer')
  marks.forEach(mark => {
    const parent = mark.parentNode
    if (!parent) return
    // Replace the mark element with its text content
    const text = document.createTextNode(mark.textContent || '')
    parent.replaceChild(text, mark)
  })
}

/**
 * Full cleanup on message send: strip DOM wrappers, hide all UI, reset state.
 */
function cleanupOnSend() {
  stripHighlightWrappersFromInput()
  cleanupAllUI()
  currentMatches = []
  setCurrentMatches([], autoReplace)
  storedOriginalText = null
  storedMatches = []
  lastProcessedText = ''
  resetActiveMode()
}



function processInput(el: HTMLElement) {
  if (!enabled || dead) return

  let text = getInputText(el)
  if (text === lastProcessedText) return

  if (storedOriginalText !== null) {
    // If the input was cleared (empty) or shrunk, the site cleared it after send.
    // Do NOT restore the original text — just clean up stored state.
    if (!text.trim() || text.length < lastProcessedText.length * 0.5) {
      storedOriginalText = null
      storedMatches = []
      resetActiveMode()
      lastProcessedText = text
    } else {
      const replacedText = lastProcessedText
      let restoredText: string

      if (text.length > replacedText.length && text.startsWith(replacedText)) {
        restoredText = storedOriginalText + text.slice(replacedText.length)
      } else if (text.length > replacedText.length && text.endsWith(replacedText)) {
        restoredText = text.slice(0, text.length - replacedText.length) + storedOriginalText
      } else {
        restoredText = storedOriginalText
      }

      storedOriginalText = null
      storedMatches = []
      resetActiveMode()

      text = restoredText
      lastProcessedText = text
      adapter.setInputText(el, text)
    }
  } else {
    lastProcessedText = text
  }

  if (!text.trim()) {
    renderHighlights('', [])
    setCurrentMatches([], autoReplace)
    currentMatches = []
    updateInspectPanelData('', [], {}, {})
    return
  }

  const rawMatches = analyzeText(text, enabledTypes, customBlockList)
  const knownFakes = getKnownFakeValues()
  let matches = rawMatches.filter(m => !knownFakes.has(m.text))
  matches = matches.filter(m => !ignoredTokens.has(m.text + ':' + m.type))
  currentMatches = matches
  renderHighlights(text, matches, autoReplace)
  setCurrentMatches(matches, autoReplace)
  syncReplacements()
  updateInspectPanelData(text, matches, getTokenMap(), getReplacementMap())

  safeSendMessage({
    action: 'UPDATE_STATS',
    matchCount: matches.length,
    types: matches.map((m: PIIMatch) => m.type),
  })
}

function debouncedProcess(el: HTMLElement) {
  if (dead) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => processInput(el), 200)
}

function handleModeSwitch(mode: 'original' | 'labels' | 'replaced') {
  if (!currentInputEl) return
  activeMode = mode

  if (storedOriginalText === null) {
    storedOriginalText = getInputText(currentInputEl)
    storedMatches = [...currentMatches]
  }

  if (mode === 'original') {
    const origText = storedOriginalText
    const origMatches = [...storedMatches]
    storedOriginalText = null
    storedMatches = []
    currentMatches = origMatches
    lastProcessedText = origText
    adapter.setInputText(currentInputEl, origText)
    renderHighlights(origText, origMatches)
    setCurrentMatches(currentMatches)
    updateInspectPanelData(origText, origMatches, getTokenMap(), getReplacementMap())
    return
  }

  if (storedMatches.length === 0) return

  const forwardSorted = [...storedMatches].sort((a, b) => a.start - b.start)
  let result = ''
  let lastEnd = 0
  const highlightMatches: PIIMatch[] = []

  for (const match of forwardSorted) {
    result += storedOriginalText.slice(lastEnd, match.start)
    getTokenForMatch(match) // Guarantee it's in the token map so reverse-lookup succeeds!
    const replacement = mode === 'labels' ? getTokenForMatch(match) : getFakeReplacement(match)
    const newStart = result.length
    result += replacement
    highlightMatches.push({
      text: replacement,
      type: match.type,
      start: newStart,
      end: result.length,
      score: match.score,
    })
    lastEnd = match.end
  }
  result += storedOriginalText.slice(lastEnd)

  currentMatches = []
  setCurrentMatches([], autoReplace)
  renderHighlights('', [], autoReplace)
  syncReplacements()

  // Set lastProcessedText BEFORE setInputText so processInput's early-return
  // (text === lastProcessedText) fires before storedOriginalText restoration logic
  lastProcessedText = result
  adapter.setInputText(currentInputEl, result)
  renderHighlights(result, highlightMatches)
  saveTokenMap()
  saveReplacementMap()
}

function onInputFound(inputEl: HTMLElement) {
  if (dead) return
  currentInputEl = inputEl
  setReplaceCallback(handleModeSwitch)
  createHighlightLayer(inputEl)

  // Expose autoReplace to interceptor and highlighter
  ;(window as any).__PII_SHIELD_AUTO_REPLACE__ = () => autoReplace

  inputEl.addEventListener('input', () => debouncedProcess(inputEl))
  inputEl.addEventListener('keyup', () => debouncedProcess(inputEl))
  inputEl.addEventListener('paste', () => {
    setTimeout(() => processInput(inputEl), 50)
  })
  inputEl.addEventListener('focus', () => debouncedProcess(inputEl))

  // Hide badge and panel on blur, carefully checking if we clicked our UI
  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      const active = document.activeElement;
      const state = getState();
      if (state && active) {
        if (state.badgeDiv.contains(active) || state.inspectPanelDiv.contains(active)) {
          return;
        }
      }
      hideBadge();
      hideInspectPanel();
    }, 100);
  });

  // Keep DOM state synced for React/Nextjs sites that clear inputs natively bypassing "input" event
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(() => {
    if (dead) return;
    const currentText = getInputText(inputEl);
    if (currentText !== lastProcessedText) {
      processInput(inputEl);
    }
  }, 250);

  // Hide badge when user clicks into the text box (not on a PII mark highlight)
  inputEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest?.('.pii-shield-mark')) {
      hideBadge()
      hideInspectPanel()
    }
  })

  // Bug fix #1: hide badge/panel/tooltip and strip highlights when user sends message (Enter key)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Delay cleanup slightly so the site can capture the input first
      setTimeout(() => cleanupOnSend(), 10)
    }
  })

  cleanupFileHandler?.()
  cleanupFileHandler = setupFileHandler(
    inputEl,
    (result: FileDetectionResult) => {
      setFileBlocked(true)
      showFileWarning(
        result,
        () => { setFileBlocked(true) },
        () => { setFileBlocked(false) }
      )
    },
    () => {
      activeScanCount++
      if (activeScanCount === 1) {
        scanningIndicator = showScanningIndicator()
      }
    },
    () => {
      activeScanCount = Math.max(0, activeScanCount - 1)
      if (activeScanCount === 0) {
        hideScanningIndicator(scanningIndicator)
        scanningIndicator = null
      }
    }
  )

  processInput(inputEl)

  // --- Send Button cleanup hook ---
  // Also hook into the send button to clean up when clicked
  const sendBtn = adapter.getSendButton()
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      // Delay slightly to let the site process the click first
      setTimeout(() => cleanupOnSend(), 50)
    }, true)
  }

  // --- Input cleared detection ---
  // Watch for the input content being cleared (e.g., site clears after send)
  // to clean up orphaned UI elements.
  const inputObserver = new MutationObserver(() => {
    if (dead) return
    const currentText = getInputText(inputEl)
    if (currentText.trim() === '' && currentMatches.length > 0) {
      // Input was cleared while we had matches — message was likely sent
      cleanupOnSend()
    }
  })
  inputObserver.observe(inputEl, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['value']
  })
}

function onInputLost(_el: HTMLElement) {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  hideInspectPanel()
  cleanup()
  cleanupFileHandler?.()
  cleanupFileHandler = null
  setFileBlocked(false)
  hideScanningIndicator(scanningIndicator)
  scanningIndicator = null
  activeScanCount = 0
  currentInputEl = null
  lastProcessedText = ''
  currentMatches = []
  storedOriginalText = null
  storedMatches = []
}

function init() {
  if (!isContextValid()) return

  loadTokenMap()
  loadReplacementMap()

  safeSendMessage({ action: 'GET_SETTINGS' }, (res) => {
    const r = res as { settings?: ExtensionSettings } | undefined
    if (r?.settings) {
      const s = r.settings
      enabled = s.enabled
      autoReplace = s.autoReplace || false
      enabledTypes = s.enabledTypes
      customBlockList = s.customBlockList || []
      updateFileHandlerSettings(enabledTypes, customBlockList)
      syncReplacements()
    }
  })

  watchForInput(
    () => adapter.getInputElement(),
    onInputFound,
    onInputLost
  )

  setupInterceptor(adapter)
  setupResponseUnmasking(adapter)

  document.addEventListener('mouseover', (e) => {
    if (dead) return
    const target = e.target as HTMLElement

    // Handle hover on input PII highlight marks
    const mark = target.closest?.('.pii-shield-mark') as HTMLElement | null
    if (mark?.dataset.token && mark.dataset.type && mark.dataset.original) {
      console.log(`[PII Shield] Hovering mark: text=${mark.textContent}, token=${mark.dataset.token}, type=${mark.dataset.type}, orig=${mark.dataset.original}`);
      showTooltip(
        e.clientX,
        e.clientY,
        mark.dataset.type as PIIType,
        mark.dataset.token,
        mark.dataset.original,
        'outgoing'
      )
      return
    }

    // Handle hover on response unmasked spans
    const unmasked = target.closest?.('.pii-shield-unmasked') as HTMLElement | null
    if (unmasked?.dataset.piiToken) {
      const piiType = (unmasked.dataset.piiType || 'NAME') as PIIType
      showTooltip(
        e.clientX,
        e.clientY,
        piiType,
        unmasked.dataset.piiSentAs || unmasked.dataset.piiToken,
        unmasked.dataset.piiOriginal || unmasked.textContent || '',
        'incoming'
      )
      return
    }
  })

  document.addEventListener('mouseout', (e) => {
    if (dead) return
    const target = e.target as HTMLElement
    const mark = target.closest?.('.pii-shield-mark')
    const unmasked = target.closest?.('.pii-shield-unmasked')
    if (mark || unmasked) {
      scheduleHide()
    }
  })

  // Global click-away handler to dismiss UI elements
  document.addEventListener('mousedown', (e) => {
    if (dead) return;
    const target = e.target as HTMLElement;
    const mark = target.closest?.('.pii-shield-mark');
    const badge = target.closest?.('.pii-shield-badge');
    const panel = target.closest?.('.pii-shield-inspect-panel');
    const tooltip = target.closest?.('.pii-shield-tooltip');

    if (!mark && !badge && !panel && !tooltip) {
      hideBadge();
      hideInspectPanel();
      hideTooltip();
    }
  }, true);

  // Click a highlighted mark → replace just that one occurrence, OR click ignore
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const ignoreBtn = target.closest('.pii-ignore-btn') as HTMLElement | null;
    
    if (ignoreBtn) {
      const { type, original } = ignoreBtn.dataset;
      if (type && original) {
        ignoredTokens.add(original + ':' + type);
        if (currentInputEl) {
          lastProcessedText = '';
          processInput(currentInputEl);
        }
        hideTooltip();
        return;
      }
    }

    const mark = target.closest?.('.pii-shield-mark') as HTMLElement | null
    if (!mark || !currentInputEl) return

    if (autoReplace) return // In auto-replace mode, clicking does not replace since it's automatic.

    const { type, fakeValue, original } = mark.dataset
    if (!type || !fakeValue || !original) return

    const matchIdx = currentMatches.findIndex(
      (m) => m.text === original && m.type === (type as PIIType)
    )
    if (matchIdx === -1) return

    const match = currentMatches[matchIdx]
    getTokenForMatch(match) // Guarantee it's in the token map so reverse-lookup succeeds!

    const text = adapter.getInputText(currentInputEl)
    const newText = text.slice(0, match.start) + fakeValue + text.slice(match.end)

    // Remove from currentMatches immediately so the block-check clears
    currentMatches = currentMatches.filter((_, i) => i !== matchIdx)
    setCurrentMatches(currentMatches, autoReplace)
    syncReplacements()

    hideTooltip()
    // Let the normal input → debounce → processInput cycle re-detect remaining items
    adapter.setInputText(currentInputEl, newText)
  }, true)
}

try {
  chrome.runtime?.onMessage?.addListener((msg) => {
    if (dead) return
    if (msg.action === 'SETTINGS_UPDATED') {
      const s = msg.settings as ExtensionSettings
      enabled = s.enabled
      autoReplace = s.autoReplace || false
      enabledTypes = s.enabledTypes
      customBlockList = s.customBlockList || []
      updateFileHandlerSettings(enabledTypes, customBlockList)
      syncReplacements()
      reapplyUnmasking(autoReplace)
      if (currentInputEl) {
        lastProcessedText = ''
        processInput(currentInputEl)
      }
    }
  })
} catch {
  // context already invalid at load time
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
