import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SplineHeaderBg from './components/SplineHeaderBg'
import HeroDemo from './components/HeroDemo'
import InstallSection from './components/InstallSection'
import './index.css'

const splineEl = document.getElementById('spline-header-bg')
if (splineEl) {
  createRoot(splineEl).render(
    <StrictMode>
      <SplineHeaderBg />
    </StrictMode>,
  )
}

const demoEl = document.getElementById('hero-demo')
if (demoEl) {
  createRoot(demoEl).render(
    <StrictMode>
      <HeroDemo />
    </StrictMode>,
  )
}

const installEl = document.getElementById('install-section')
if (installEl) {
  createRoot(installEl).render(
    <StrictMode>
      <InstallSection />
    </StrictMode>,
  )
}
