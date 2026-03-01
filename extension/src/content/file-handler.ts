import { isSupportedFileType } from '../parsers/index.ts'
import { analyzeText } from '../detectors/engine.ts'
import type { PIIMatch, PIIType } from '../types.ts'

export interface FileDetectionResult {
  fileName: string
  matches: PIIMatch[]
  extractedText: string
  fileKeys: string[]
}

type OnPIIDetected = (result: FileDetectionResult) => void
type OnFileClean = (fileName: string) => void
type OnScanStart = () => void
type OnScanEnd = () => void

let enabledTypes: PIIType[] = ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH']
let customBlockList: string[] = []

const whitelistedFiles = new Set<string>()

export function updateFileHandlerSettings(types: PIIType[], blockList: string[]) {
  enabledTypes = types
  customBlockList = blockList
}

export function whitelistFile(key: string) {
  whitelistedFiles.add(key)
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}`
}

function isContextValid(): boolean {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime?.id)
  } catch {
    return false
  }
}

function safeSendMessage(msg: Record<string, unknown>): Promise<{ text?: string; error?: string }> {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve({ error: 'Extension context invalidated' })
      return
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message })
        } else {
          resolve(res ?? { error: 'No response from background' })
        }
      })
    } catch {
      resolve({ error: 'Extension context invalidated' })
    }
  })
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

async function parseFileText(file: File): Promise<string> {
  const data = await readFileAsArrayBuffer(file)
  const response = await safeSendMessage({
    action: 'PARSE_FILE',
    data: Array.from(new Uint8Array(data)),
    mimeType: file.type,
    fileName: file.name,
  })
  if (response.error) {
    console.warn('[Fegis] File parse error:', response.error)
    return ''
  }
  return response.text ?? ''
}

export function setupFileHandler(
  inputEl: HTMLElement,
  onPIIDetected: OnPIIDetected,
  onFileClean: OnFileClean,
  onScanStart: OnScanStart,
  onScanEnd: OnScanEnd
): () => void {
  const container = inputEl.closest('[class*="chat"], [class*="conversation"], main, form') ?? inputEl.parentElement ?? inputEl

  function getSupportedNonWhitelisted(files: FileList | File[]): File[] {
    return Array.from(files).filter(f => isSupportedFileType(f.type) && !whitelistedFiles.has(fileKey(f)))
  }

  async function scanFiles(files: File[]) {
    if (!isContextValid() || files.length === 0) return

    onScanStart()

    try {
      const allMatches: PIIMatch[] = []
      const flaggedNames: string[] = []
      const flaggedKeys: string[] = []
      let allText = ''
      const cleanKeys: string[] = []

      for (const file of files) {
        if (!isContextValid()) return
        const text = await parseFileText(file)
        if (!text.trim()) {
          cleanKeys.push(fileKey(file))
          continue
        }

        const matches = analyzeText(text, enabledTypes, customBlockList)
        if (matches.length > 0) {
          allMatches.push(...matches)
          flaggedNames.push(file.name)
          flaggedKeys.push(fileKey(file))
          allText += (allText ? '\n\n' : '') + text
        } else {
          cleanKeys.push(fileKey(file))
        }
      }

      for (const key of cleanKeys) {
        whitelistedFiles.add(key)
      }

      if (allMatches.length > 0) {
        onPIIDetected({
          fileName: flaggedNames.join(', '),
          matches: allMatches,
          extractedText: allText,
          fileKeys: flaggedKeys,
        })
      } else {
        onFileClean(files.map(f => f.name).join(', '))
      }
    } catch (err) {
      console.warn('[Fegis] File processing error:', err)
    } finally {
      onScanEnd()
    }
  }

  function onDrop(e: DragEvent) {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const toScan = getSupportedNonWhitelisted(files)
    if (toScan.length === 0) return

    e.preventDefault()
    e.stopImmediatePropagation()

    scanFiles(toScan)
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const blob = item.getAsFile()
        if (blob) files.push(blob)
      }
    }
    if (files.length === 0) return

    const toScan = getSupportedNonWhitelisted(files)
    if (toScan.length === 0) return

    e.preventDefault()
    e.stopImmediatePropagation()

    scanFiles(toScan)
  }

  container.addEventListener('drop', onDrop as EventListener, true)
  container.addEventListener('paste', onPaste as EventListener, true)
  inputEl.addEventListener('paste', onPaste as EventListener, true)

  return () => {
    container.removeEventListener('drop', onDrop as EventListener, true)
    container.removeEventListener('paste', onPaste as EventListener, true)
    inputEl.removeEventListener('paste', onPaste as EventListener, true)
  }
}
