import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The app's own tokens, fonts and keyboard styles, then the site's layout on top.
import '../../src/index.css'
import './site.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
