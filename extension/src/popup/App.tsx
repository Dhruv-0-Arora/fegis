import { useState, useEffect } from 'react'
import type { ExtensionSettings, TokenMap, PIIType } from '../types.ts'
import { useApi } from '../context.tsx'

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  autoReplace: false,
  enabledTypes: ['NAME', 'EMAIL', 'PHONE', 'FINANCIAL', 'SSN', 'ID', 'ADDRESS', 'SECRET', 'URL', 'DATE', 'PATH'],
  customBlockList: [],
}

const PII_TYPE_LABELS: Record<PIIType, string> = {
  NAME: 'Names',
  EMAIL: 'Emails',
  PHONE: 'Phone Numbers',
  FINANCIAL: 'Financial (CC, IBAN)',
  SSN: 'SSN',
  ID: 'IDs / Passports',
  ADDRESS: 'Addresses',
  SECRET: 'Secrets (API Keys)',
  URL: 'URLs',
  DATE: 'Dates',
  CUSTOM: 'Custom Terms',
  PATH: 'File Paths',
}

function App() {
  const api = useApi()
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [tokenMap, setTokenMap] = useState<TokenMap>({})
  const [replacementMap, setReplacementMap] = useState<Record<string, string>>({})
  const [customTerm, setCustomTerm] = useState('')

  useEffect(() => {
    api.getSettings((res) => {
      if (res?.settings) setSettings(res.settings)
    })
    api.getTokenMap((res) => {
      if (res?.tokenMap) setTokenMap(res.tokenMap)
    })
    api.getReplacementMap((res) => {
      if (res?.replacementMap) setReplacementMap(res.replacementMap)
    })
  }, [api])

  const updateSettings = (patch: Partial<ExtensionSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    api.updateSettings(patch)
  }

  const toggleType = (type: PIIType) => {
    const types = settings.enabledTypes.includes(type)
      ? settings.enabledTypes.filter((t) => t !== type)
      : [...settings.enabledTypes, type]
    updateSettings({ enabledTypes: types })
  }

  const addCustomTerm = () => {
    const term = customTerm.trim()
    if (!term || settings.customBlockList.includes(term)) return
    updateSettings({ customBlockList: [...settings.customBlockList, term] })
    setCustomTerm('')
  }

  const removeCustomTerm = (term: string) => {
    updateSettings({ customBlockList: settings.customBlockList.filter((t) => t !== term) })
  }

  const tokenEntries = Object.entries(tokenMap)
  const typeCounts: Record<string, number> = {}
  for (const [token] of tokenEntries) {
    const type = token.replace(/^\[/, '').replace(/_\d+\]$/, '')
    typeCounts[type] = (typeCounts[type] || 0) + 1
  }

  const replacementEntries = Object.entries(replacementMap).map(([key, fake]) => {
    const colon = key.indexOf(':')
    return { type: key.slice(0, colon), original: key.slice(colon + 1), fake }
  })

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="logo-row">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L4 6v5c0 5.15 3.35 9.95 8 11.3C16.65 20.95 20 16.15 20 11V6l-8-4z" fill="#88C0D0"/>
            <path d="M10.5 11.5V10a1.5 1.5 0 0 1 3 0v1.5" stroke="#2E3440" strokeWidth="1.4" strokeLinecap="round"/>
            <rect x="9" y="11" width="6" height="4.5" rx="1" fill="#2E3440"/>
            <circle cx="12" cy="13.1" r="0.85" fill="#88C0D0"/>
          </svg>
          <h1>Fegis</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
          <label className="toggle-row">
            <span>{settings.enabled ? 'Active' : 'Disabled'}</span>
            <div className={`toggle ${settings.enabled ? 'on' : ''}`} onClick={() => updateSettings({ enabled: !settings.enabled })}>
              <div className="toggle-knob" />
            </div>
          </label>
          <label className="toggle-row">
            <span style={{ color: settings.autoReplace ? '#A3BE8C' : undefined }}>
              {settings.autoReplace ? 'Auto Replace (Beta)' : 'Auto Replace (Off)'}
            </span>
            <div className={`toggle ${settings.autoReplace ? 'on' : ''}`} onClick={() => updateSettings({ autoReplace: !settings.autoReplace })}>
              <div className="toggle-knob" />
            </div>
          </label>
        </div>
      </header>

      {/* Auto Replace panels — only shown when Beta mode is active */}
      {settings.autoReplace && tokenEntries.length > 0 && (
        <section className="section">
          <h2>Session Summary</h2>
          <div className="stats-grid">
            {Object.entries(typeCounts).map(([type, count]) => (
              <div key={type} className="stat-chip">
                <span className="stat-count">{count}</span>
                <span className="stat-label">{type.toLowerCase()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {settings.autoReplace && replacementEntries.length > 0 && (
        <section className="section">
          <h2>Replacement Map</h2>
          <p style={{ fontSize: '11px', color: '#4C566A', marginBottom: '8px' }}>
            Same original value always maps to the same replacement.
          </p>
          <div className="token-list">
            {replacementEntries.map(({ type, original, fake }) => (
              <div key={`${type}:${original}`} className="token-row">
                <span className="token-key" style={{ color: '#81A1C1', fontSize: '10px', flexShrink: 0 }}>{type}</span>
                <span className="token-value" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{original}</span>
                <span className="token-arrow">&rarr;</span>
                <span className="token-value" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#A3BE8C' }}>{fake}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {settings.autoReplace && tokenEntries.length > 0 && (
        <section className="section">
          <h2>Token Mappings</h2>
          <div className="token-list">
            {tokenEntries.map(([token, original]) => (
              <div key={token} className="token-row">
                <code className="token-key">{token}</code>
                <span className="token-arrow">&rarr;</span>
                <span className="token-value">{original}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Detection Types</h2>
        <div className="type-grid">
          {(Object.entries(PII_TYPE_LABELS) as [PIIType, string][])
            .filter(([t]) => t !== 'CUSTOM')
            .map(([type, label]) => (
              <label key={type} className="type-check">
                <input
                  type="checkbox"
                  checked={settings.enabledTypes.includes(type)}
                  onChange={() => toggleType(type)}
                />
                <span>{label}</span>
              </label>
            ))}
        </div>
      </section>

      <section className="section">
        <h2>Custom Block List</h2>
        <div className="custom-input-row">
          <input
            type="text"
            placeholder="Add term to always mask..."
            value={customTerm}
            onChange={(e) => setCustomTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomTerm()}
          />
          <button onClick={addCustomTerm}>Add</button>
        </div>
        {settings.customBlockList.length > 0 && (
          <div className="custom-list">
            {settings.customBlockList.map((term) => (
              <div key={term} className="custom-chip">
                <span>{term}</span>
                <button className="chip-remove" onClick={() => removeCustomTerm(term)}>&times;</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default App
