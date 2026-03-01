import type { ExtensionSettings, TokenMap } from '../types.ts'

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  enabledTypes: ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH'],
  customBlockList: [],
}

let cachedSettings: ExtensionSettings | null = null
let sessionStats = { totalMasked: 0, types: {} as Record<string, number> }

async function getSettings(): Promise<ExtensionSettings> {
  if (cachedSettings) return cachedSettings
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      cachedSettings = (result.settings as ExtensionSettings) || { ...DEFAULT_SETTINGS }
      resolve(cachedSettings)
    })
  })
}

async function updateSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings()
  const updated = { ...current, ...patch }
  cachedSettings = updated
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: updated }, () => {
      chrome.tabs.query({ active: true }, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: 'SETTINGS_UPDATED',
              settings: updated,
            }).catch(() => {})
          }
        }
      })
      resolve(updated)
    })
  })
}

async function getTokenMap(): Promise<TokenMap> {
  return new Promise((resolve) => {
    chrome.storage.session.get('tokenMap', (result) => {
      resolve((result.tokenMap as TokenMap) || {})
    })
  })
}

async function saveTokenMap(tokenMap: TokenMap): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ tokenMap }, () => resolve())
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = async () => {
    switch (message.action) {
      case 'GET_SETTINGS': {
        const settings = await getSettings()
        return { settings }
      }
      case 'UPDATE_SETTINGS': {
        const settings = await updateSettings(message.settings)
        return { settings }
      }
      case 'GET_TOKEN_MAP': {
        const tokenMap = await getTokenMap()
        return { tokenMap }
      }
      case 'SAVE_TOKEN_MAP': {
        await saveTokenMap(message.tokenMap)
        return { ok: true }
      }
      case 'GET_REPLACEMENT_MAP': {
        const replacementMap = await new Promise<Record<string, string>>((resolve) => {
          chrome.storage.session.get('replacementMap', (r) => {
            resolve((r.replacementMap as Record<string, string>) || {})
          })
        })
        return { replacementMap }
      }
      case 'UPDATE_STATS': {
        sessionStats.totalMasked += message.matchCount || 0
        if (message.types) {
          for (const type of message.types) {
            sessionStats.types[type] = (sessionStats.types[type] || 0) + 1
          }
        }
        return { ok: true }
      }
      case 'GET_STATS': {
        return { stats: sessionStats }
      }
      default:
        return { error: 'Unknown action' }
    }
  }

  handler().then(sendResponse)
  return true
})

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Fegis] Extension installed')
  chrome.storage.local.get('settings', (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS })
    }
  })
})
