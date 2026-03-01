import { useState, useEffect } from 'react'

type Platform = 'unix' | 'windows'

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  return 'unix'
}

const BASE_URL = 'https://cheesehacks26.vercel.app'

const commands: Record<Platform, string> = {
  unix: `curl -fsSL ${BASE_URL}/install.sh | bash`,
  windows: `irm "${BASE_URL}/install.ps1" -OutFile install.ps1; .\\install.ps1`,
}

const labels: Record<Platform, string> = {
  unix: 'macOS / Linux',
  windows: 'Windows',
}

const prompts: Record<Platform, string> = {
  unix: '$',
  windows: '>',
}

const installPaths: Record<Platform, string> = {
  unix: '~/Library/Application Support/Fegis/extension',
  windows: '%LOCALAPPDATA%\\Fegis\\extension',
}

export default function InstallSection() {
  const [platform, setPlatform] = useState<Platform>('unix')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  function copyCommand() {
    navigator.clipboard.writeText(commands[platform]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
      <span
        className="material-symbols-outlined text-6xl mb-6 block"
        style={{ color: 'var(--accent-color)' }}
      >
        terminal
      </span>

      <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-[#ECEFF4]">
        Install Fegis
      </h2>
      <p className="text-[#D8DEE9]/80 mb-10 text-lg">
        One command. 30 seconds. No account needed.
      </p>

      {/* Platform tabs */}
      <div className="inline-flex rounded-lg overflow-hidden border border-white/10 mb-6">
        {(['unix', 'windows'] as Platform[]).map((p) => (
          <button
            key={p}
            onClick={() => { setPlatform(p); setCopied(false) }}
            className="px-5 py-2.5 text-sm font-semibold transition-all"
            style={{
              background: platform === p ? 'var(--accent-color)' : 'rgba(59,66,82,0.5)',
              color: platform === p ? '#2E3440' : '#D8DEE9',
            }}
          >
            {labels[p]}
          </button>
        ))}
      </div>

      {/* Command block */}
      <div
        className="relative rounded-xl text-left overflow-hidden mx-auto"
        style={{
          background: '#272C35',
          border: '1px solid rgba(76,86,106,0.5)',
          maxWidth: '640px',
        }}
      >
        {/* Title bar dots */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#BF616A]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#EBCB8B]/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#A3BE8C]/70" />
          <span className="ml-3 text-xs text-[#4C566A] font-mono">
            {platform === 'unix' ? 'Terminal' : 'PowerShell'}
          </span>
        </div>

        <div className="flex items-start gap-3 p-4 pr-14">
          <span className="text-[#4C566A] font-mono text-sm select-none shrink-0 pt-0.5">
            {prompts[platform]}
          </span>
          <code className="text-sm font-mono text-[#A3BE8C] break-all leading-relaxed">
            {commands[platform]}
          </code>
        </div>

        {/* Copy button */}
        <button
          onClick={copyCommand}
          className="absolute top-[46px] right-3 p-1.5 rounded-md transition-all hover:bg-white/10"
          title="Copy to clipboard"
        >
          <span
            className="material-symbols-outlined text-lg"
            style={{ color: copied ? '#A3BE8C' : '#4C566A' }}
          >
            {copied ? 'check' : 'content_copy'}
          </span>
        </button>
      </div>

      {/* Post-install steps */}
      <div className="mt-8 text-sm text-[#D8DEE9]/60 space-y-1">
        <p>Then in Chrome:</p>
        <p className="font-mono text-[#D8DEE9]/80">
          Developer mode → Load unpacked → <span className="text-[#88C0D0]">{installPaths[platform]}</span>
        </p>
      </div>

      <p className="mt-6 text-sm text-[#4C566A]">
        Requires Chrome 88+ &bull; Open source &bull; Free
      </p>
    </div>
  )
}
