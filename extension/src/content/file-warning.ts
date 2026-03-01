import type { PIIMatch, PIIType } from '../types.ts'
import type { FileDetectionResult } from './file-handler.ts'

const TYPE_COLORS: Record<PIIType, string> = {
  NAME: '#5E81AC',
  EMAIL: '#EBCB8B',
  PHONE: '#B48EAD',
  FINANCIAL: '#BF616A',
  SSN: '#BF616A',
  ID: '#D08770',
  ADDRESS: '#8FBCBB',
  SECRET: '#BF616A',
  URL: '#81A1C1',
  DATE: '#A3BE8C',
  CUSTOM: '#D08770',
  PATH: '#A3BE8C',
}

let warningPanel: HTMLDivElement | null = null
let onBlockSend: (() => void) | null = null
let onAllowSend: (() => void) | null = null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function groupByType(matches: PIIMatch[]): Map<PIIType, PIIMatch[]> {
  const map = new Map<PIIType, PIIMatch[]>()
  for (const m of matches) {
    const list = map.get(m.type) ?? []
    list.push(m)
    map.set(m.type, list)
  }
  return map
}

export function showFileWarning(
  result: FileDetectionResult,
  onBlock: () => void,
  onAllow: () => void
) {
  hideFileWarning()

  onBlockSend = onBlock
  onAllowSend = onAllow

  const panel = document.createElement('div')
  panel.className = 'pii-file-warning-panel'

  const grouped = groupByType(result.matches)

  let matchRows = ''
  for (const [type, matches] of grouped) {
    const color = TYPE_COLORS[type] ?? '#81A1C1'
    const uniqueTexts = [...new Set(matches.map(m => m.text))]
    const preview = uniqueTexts
      .slice(0, 3)
      .map(t => `<span style="font-family:'SF Mono',Monaco,monospace;color:#D8DEE9;">${escapeHtml(truncate(t, 40))}</span>`)
      .join(', ')
    const extra = uniqueTexts.length > 3 ? ` +${uniqueTexts.length - 3} more` : ''

    matchRows += `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;border:1px solid ${color};color:${color};border-radius:4px;padding:2px 6px;flex-shrink:0;">${type}</span>
        <span style="font-size:12px;color:#D8DEE9;line-height:1.5;">${preview}${extra ? `<span style="color:#4C566A;font-size:11px;">${extra}</span>` : ''}</span>
      </div>
    `
  }

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid #3B4252;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:8px;height:8px;border-radius:50%;background:#BF616A;box-shadow:0 0 8px rgba(191,97,106,0.5);"></span>
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#D8DEE9;">Sensitive Data in File</span>
      </div>
      <button class="pii-file-warning-close" style="cursor:pointer;background:none;border:1px solid #434C5E;border-radius:6px;color:#D8DEE9;font-size:16px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">&times;</button>
    </div>
    <div style="padding:12px 16px;">
      <div style="font-size:12px;color:#ECEFF4;margin-bottom:8px;">
        <strong>${result.matches.length}</strong> PII item${result.matches.length !== 1 ? 's' : ''} detected in <strong style="color:#88C0D0;">${escapeHtml(result.fileName)}</strong>
      </div>
      <div style="padding:8px 0;">${matchRows}</div>
    </div>
    <div style="display:flex;gap:8px;padding:10px 16px 14px;border-top:1px solid #3B4252;">
      <button class="pii-file-warning-block" style="flex:1;cursor:pointer;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;font-family:inherit;border:1px solid #BF616A;background:rgba(191,97,106,0.15);color:#BF616A;transition:background 0.15s;">Block</button>
      <button class="pii-file-warning-allow" style="flex:1;cursor:pointer;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;font-family:inherit;border:1px solid #434C5E;background:rgba(67,76,94,0.3);color:#D8DEE9;transition:background 0.15s;">Allow &amp; Re-upload</button>
    </div>
  `

  panel.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    bottom: 120px;
    right: 24px;
    width: 400px;
    max-height: 500px;
    overflow-y: auto;
    background: #2E3440;
    border: 1px solid #434C5E;
    border-radius: 14px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.5);
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    color: #ECEFF4;
    animation: pii-panel-in 0.2s ease-out;
  `

  panel.querySelector('.pii-file-warning-close')?.addEventListener('click', () => {
    const cb = onBlockSend
    hideFileWarning()
    cb?.()
  })
  panel.querySelector('.pii-file-warning-block')?.addEventListener('click', () => {
    const cb = onBlockSend
    hideFileWarning()
    cb?.()
  })
  panel.querySelector('.pii-file-warning-allow')?.addEventListener('click', () => {
    const cb = onAllowSend
    hideFileWarning()
    cb?.()
  })

  document.body.appendChild(panel)
  warningPanel = panel
}

export function showScanningIndicator(): HTMLDivElement {
  const indicator = document.createElement('div')
  indicator.className = 'pii-file-scanning'
  indicator.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    bottom: 120px;
    right: 24px;
    padding: 10px 18px;
    background: #3B4252;
    border: 1px solid #434C5E;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #88C0D0;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: pii-panel-in 0.2s ease-out;
  `
  indicator.innerHTML = `
    <span style="display:inline-block;width:12px;height:12px;border:2px solid #88C0D0;border-top-color:transparent;border-radius:50%;animation:pii-spin 0.8s linear infinite;"></span>
    Scanning file for sensitive data...
  `

  const style = document.createElement('style')
  style.textContent = `@keyframes pii-spin { to { transform: rotate(360deg); } }`
  indicator.appendChild(style)

  document.body.appendChild(indicator)
  return indicator
}

export function hideScanningIndicator(indicator: HTMLDivElement | null) {
  indicator?.remove()
}

export function hideFileWarning() {
  warningPanel?.remove()
  warningPanel = null
  onBlockSend = null
  onAllowSend = null
}

export function isFileWarningVisible(): boolean {
  return warningPanel !== null
}

export function showFileCleanNotice(fileName: string) {
  const notice = document.createElement('div')
  notice.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    bottom: 120px;
    right: 24px;
    padding: 10px 18px;
    background: #2E3440;
    border: 1px solid #A3BE8C;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #A3BE8C;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: pii-panel-in 0.2s ease-out;
  `
  notice.textContent = `No PII in ${fileName} — re-upload to attach.`
  document.body.appendChild(notice)
  setTimeout(() => notice.remove(), 3000)
}
