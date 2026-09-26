import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './blueprint-narsil.css'
import App from './App.tsx'
import { AppProvider } from './AppContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
