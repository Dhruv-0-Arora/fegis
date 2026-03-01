import mammoth from 'mammoth'

export async function parseDOCX(data: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: data })
  return result.value
}
