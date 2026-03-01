import { isSupportedFileType } from '../parsers/index.ts'
import { analyzeText } from '../detectors/engine.ts'
import type { PIIMatch, PIIType } from '../types.ts'

export interface FileDetectionResult {
  fileName: string
  matches: PIIMatch[]
  extractedText: string
}

type OnPIIDetected = (result: FileDetectionResult) => void
type OnScanStart = () => void
type OnScanEnd = () => void

let enabledTypes: PIIType[] = ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH']
let customBlockList: string[] = []

export function updateFileHandlerSettings(types: PIIType[], blockList: string[]) {
  enabledTypes = types
  customBlockList = blockList
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

async function processFile(
  file: File,
  onPIIDetected: OnPIIDetected,
  onScanStart: OnScanStart,
  onScanEnd: OnScanEnd
) {
  if (!isContextValid()) return

  onScanStart()

  try {
    const data = await readFileAsArrayBuffer(file)
    const mimeType = file.type

    if (!isContextValid()) return

    const response = await safeSendMessage({
      action: 'PARSE_FILE',
      data: Array.from(new Uint8Array(data)),
      mimeType,
      fileName: file.name,
    })

    if (response.error) {
      console.warn('[Fegis] File parse error:', response.error)
      return
    }

    const extractedText = response.text ?? ''
    if (!extractedText.trim()) return

    const matches = analyzeText(extractedText, enabledTypes, customBlockList)
    if (matches.length > 0) {
      onPIIDetected({ fileName: file.name, matches, extractedText })
    }
  } catch (err) {
    console.warn('[Fegis] File processing error:', err)
  } finally {
    onScanEnd()
  }
}

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type })
}

export function setupFileHandler(
  inputEl: HTMLElement,
  onPIIDetected: OnPIIDetected,
  onScanStart: OnScanStart,
  onScanEnd: OnScanEnd
): () => void {
  const container = inputEl.closest('[class*="chat"], [class*="conversation"], main, form') ?? inputEl.parentElement ?? inputEl

  function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (isSupportedFileType(file.type)) {
        processFile(file, onPIIDetected, onScanStart, onScanEnd)
      }
    }
  }

  function onDrop(e: DragEvent) {
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      handleFiles(files)
    }
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.kind === 'file' && isSupportedFileType(item.type)) {
        const blob = item.getAsFile()
        if (blob) {
          const file = blobToFile(blob, `pasted-${Date.now()}.${blob.type.split('/')[1] || 'png'}`)
          processFile(file, onPIIDetected, onScanStart, onScanEnd)
        }
      }
    }
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
