export type PIIType =
  | 'NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'FINANCIAL'
  | 'SSN'
  | 'ID'
  | 'ADDRESS'
  | 'SECRET'
  | 'URL'
  | 'DATE'
  | 'CUSTOM'
  | 'PATH'

export interface PIIMatch {
  text: string
  type: PIIType
  start: number
  end: number
  score: number
}

export interface DetectionRule {
  pattern: RegExp
  type: PIIType
  score: number
  contextBefore?: RegExp
  contextAfter?: RegExp
  dist?: number
  keywords?: string[]
  validator?: (text: string, ctx?: MatchContext) => boolean
}

export interface MatchContext {
  index: number
  text: string
}

export interface TokenMap {
  [token: string]: string
}

export interface TokenizeResult {
  maskedText: string
  tokenMap: TokenMap
}

export interface SiteAdapter {
  name: string
  getInputElement: () => HTMLElement | null
  getSendButton: () => HTMLElement | null
  getResponseContainer: () => HTMLElement | null
  getInputText: (el: HTMLElement) => string
  setInputText: (el: HTMLElement, text: string) => void
  isContentEditable: boolean
}

export interface ExtensionSettings {
  enabled: boolean
  enabledTypes: PIIType[]
  customBlockList: string[]
  autoReplace?: boolean
}

export type MessageAction =
  | { action: 'ANALYZE_TEXT'; text: string }
  | { action: 'ML_ANALYZE'; text: string }
  | { action: 'GET_SETTINGS' }
  | { action: 'UPDATE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { action: 'GET_TOKEN_MAP' }
  | { action: 'SAVE_TOKEN_MAP'; tokenMap: TokenMap }
  | { action: 'GET_STATS' }
