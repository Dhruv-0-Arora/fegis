import { parsePDF } from './pdf-parser.ts'
import { parseDOCX } from './docx-parser.ts'
import { parseImage } from './image-parser.ts'

const PDF_TYPES = ['application/pdf']
const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

export function isSupportedFileType(mimeType: string): boolean {
  return (
    PDF_TYPES.includes(mimeType) ||
    DOCX_TYPES.includes(mimeType) ||
    mimeType.startsWith('image/')
  )
}

export async function parseFile(data: ArrayBuffer, mimeType: string): Promise<string> {
  if (PDF_TYPES.includes(mimeType)) {
    return parsePDF(data)
  }
  if (DOCX_TYPES.includes(mimeType)) {
    return parseDOCX(data)
  }
  if (IMAGE_TYPES.includes(mimeType) || mimeType.startsWith('image/')) {
    return parseImage(data)
  }
  throw new Error(`Unsupported file type: ${mimeType}`)
}
