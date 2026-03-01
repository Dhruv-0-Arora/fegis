import Tesseract from 'tesseract.js'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import mammoth from 'mammoth'

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs')

const PDF_TYPES = ['application/pdf']
const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

let ocrWorker: Tesseract.Worker | null = null

async function getOcrWorker(): Promise<Tesseract.Worker> {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng')
  }
  return ocrWorker
}

async function parsePDF(data: ArrayBuffer): Promise<string> {
  const pdf: PDFDocumentProxy = await getDocument({ data }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(pageText)
  }

  return pages.join('\n')
}

async function parseDOCX(data: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  return result.value
}

async function parseImage(data: Uint8Array): Promise<string> {
  const w = await getOcrWorker()
  const blob = new Blob([data.buffer as ArrayBuffer])
  const url = URL.createObjectURL(blob)
  const result = await w.recognize(url)
  URL.revokeObjectURL(url)
  return result.data.text
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'OFFSCREEN_PARSE') return false

  const data = new Uint8Array(message.data as number[])
  const mimeType = message.mimeType as string

  ;(async () => {
    try {
      let text: string

      if (PDF_TYPES.includes(mimeType)) {
        text = await parsePDF(data.buffer)
      } else if (DOCX_TYPES.includes(mimeType)) {
        text = await parseDOCX(data.buffer)
      } else if (mimeType.startsWith('image/')) {
        text = await parseImage(data)
      } else {
        sendResponse({ error: `Unsupported file type: ${mimeType}` })
        return
      }

      sendResponse({ text })
    } catch (err) {
      sendResponse({ error: (err as Error).message })
    }
  })()

  return true
})
