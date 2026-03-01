import { useState, useEffect } from 'react'
import type { ExtensionSettings, PIIType } from '../types.ts'
import { useApi } from '../context.tsx'

const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
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
  const [customTerm, setCustomTerm] = useState('')

  useEffect(() => {
    api.getSettings((res) => {
      if (res?.settings) setSettings(res.settings)
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

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="logo-row">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#8FBCBB" />
                <stop offset="50%" stopColor="#88C0D0" />
                <stop offset="100%" stopColor="#81A1C1" />
              </linearGradient>
            </defs>
            <rect width="24" height="24" rx="7" fill="url(#logoGrad)" />
            <path d="M12 6C9.79 6 8 7.79 8 10c0 1.48.81 2.77 2 3.46V15a1 1 0 001 1h2a1 1 0 001-1v-1.54c1.19-.69 2-1.98 2-3.46 0-2.21-1.79-4-4-4z" fill="#eceff4" />
            <rect x="10" y="17" width="4" height="1.5" rx=".75" fill="rgba(236,239,244,0.7)" />
          </svg>
          <h1>Fegis</h1>
        </div>
        <label className="toggle-row">
          <span>{settings.enabled ? 'Active' : 'Disabled'}</span>
          <div className={`toggle ${settings.enabled ? 'on' : ''}`} onClick={() => updateSettings({ enabled: !settings.enabled })}>
            <div className="toggle-knob" />
          </div>
        </label>
      </header>

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
