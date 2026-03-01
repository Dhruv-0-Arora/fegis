export async function parseImage(data: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'OCR_IMAGE', data: Array.from(new Uint8Array(data)) },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (response?.error) {
          reject(new Error(response.error))
          return
        }
        resolve(response?.text ?? '')
      }
    )
  })
}
