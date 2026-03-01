import { detectSite } from './sites.ts'
import { analyzeText, analyzeTextWithML } from '../detectors/engine.ts'
import { createHighlightLayer, renderHighlights, cleanup, showTooltip, scheduleHide, setReplaceCallback, updateInspectPanelData, hideInspectPanel, resetActiveMode } from './highlighter.ts'
import { setCurrentMatches, setupInterceptor, setupResponseUnmasking } from './interceptor.ts'
import { watchForInput, stopWatching } from './observer.ts'
import { loadTokenMap, loadReplacementMap, getFakeReplacement, saveReplacementMap, saveTokenMap, getTokenMap, getReplacementMap, getTokenForMatch, getKnownFakeValues } from '../tokens/manager.ts'
import type { PIIMatch, ExtensionSettings, PIIType } from '../types.ts'

let enabled = true
let enabledTypes: PIIType[] = ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH']
let customBlockList: string[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let currentInputEl: HTMLElement | null = null
let lastProcessedText = ''
let currentMatches: PIIMatch[] = []
let dead = false
let storedOriginalText: string | null = null
let storedMatches: PIIMatch[] = []

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
  console.log('[PII Shield] Extension context invalidated -- shutting down gracefully')
  cleanup()
  stopWatching()
  if (debounceTimer) clearTimeout(debounceTimer)
  currentInputEl = null
}

function getInputText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value
  }
  return el.innerText || el.textContent || ''
}

async function processInput(el: HTMLElement) {
  if (!enabled || dead) return

  let text = getInputText(el)
  if (text === lastProcessedText) return

  if (storedOriginalText !== null) {
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
  } else {
    lastProcessedText = text
  }

  if (!text.trim()) {
    renderHighlights('', [])
    setCurrentMatches([])
    currentMatches = []
    updateInspectPanelData('', [], {}, {})
    return
  }

  // Show regex results immediately for responsiveness
  const rawMatches = analyzeText(text, enabledTypes, customBlockList)
  const knownFakes = getKnownFakeValues()
  const regexMatches = rawMatches.filter(m => !knownFakes.has(m.text))
  currentMatches = regexMatches
  renderHighlights(text, regexMatches)
  setCurrentMatches(regexMatches)
  updateInspectPanelData(text, regexMatches, getTokenMap(), getReplacementMap())

  // Then augment with ML results asynchronously
  try {
    const mlMatches = await analyzeTextWithML(text, enabledTypes, customBlockList)
    if (lastProcessedText === text && !dead) {
      const filteredMl = mlMatches.filter(m => !knownFakes.has(m.text))
      currentMatches = filteredMl
      renderHighlights(text, filteredMl)
      setCurrentMatches(filteredMl)
      updateInspectPanelData(text, filteredMl, getTokenMap(), getReplacementMap())
    }
  } catch {
    // ML unavailable; regex results already displayed
  }

  safeSendMessage({
    action: 'UPDATE_STATS',
    matchCount: currentMatches.length,
    types: currentMatches.map((m: PIIMatch) => m.type),
  })
}

function debouncedProcess(el: HTMLElement) {
  if (dead) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => processInput(el), 200)
}

function handleModeSwitch(mode: 'original' | 'labels' | 'replaced') {
  if (!currentInputEl) return

  if (storedOriginalText === null) {
    storedOriginalText = getInputText(currentInputEl)
    storedMatches = [...currentMatches]
  }

  if (mode === 'original') {
    lastProcessedText = storedOriginalText
    currentMatches = [...storedMatches]
    adapter.setInputText(currentInputEl, storedOriginalText)
    renderHighlights(storedOriginalText, storedMatches)
    setCurrentMatches(currentMatches)
    updateInspectPanelData(storedOriginalText, storedMatches, getTokenMap(), getReplacementMap())
    return
  }

  if (storedMatches.length === 0) return

  const forwardSorted = [...storedMatches].sort((a, b) => a.start - b.start)
  let result = ''
  let lastEnd = 0
  const highlightMatches: PIIMatch[] = []

  for (const match of forwardSorted) {
    result += storedOriginalText.slice(lastEnd, match.start)
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
  setCurrentMatches([])
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

  inputEl.addEventListener('input', () => debouncedProcess(inputEl))
  inputEl.addEventListener('keyup', () => debouncedProcess(inputEl))
  inputEl.addEventListener('paste', () => {
    setTimeout(() => processInput(inputEl), 50)
  })
  inputEl.addEventListener('focus', () => debouncedProcess(inputEl))

  processInput(inputEl)
}

function onInputLost(_el: HTMLElement) {
  hideInspectPanel()
  cleanup()
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
      enabledTypes = s.enabledTypes
      customBlockList = s.customBlockList || []
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
    const mark = (e.target as HTMLElement).closest?.('.pii-shield-mark') as HTMLElement | null
    if (mark?.dataset.fakeValue && mark.dataset.type && mark.dataset.original) {
      showTooltip(
        e.clientX,
        e.clientY,
        mark.dataset.type as PIIType,
        mark.dataset.fakeValue,
        mark.dataset.original
      )
    }
  })

  document.addEventListener('mouseout', (e) => {
    if (dead) return
    const mark = (e.target as HTMLElement).closest?.('.pii-shield-mark')
    if (mark) {
      scheduleHide()
    }
  })
}

try {
  chrome.runtime?.onMessage?.addListener((msg) => {
    if (dead) return
    if (msg.action === 'SETTINGS_UPDATED') {
      const s = msg.settings as ExtensionSettings
      enabled = s.enabled
      enabledTypes = s.enabledTypes
      customBlockList = s.customBlockList || []
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
