import { createRoot } from 'react-dom/client'
import type { DesktopApi } from '../shared/workflow.ts'
import { App } from './app.tsx'
import './style.css'

declare global {
  interface Window { meshwork: DesktopApi }
}

createRoot(document.getElementById('root')!).render(<App />)
