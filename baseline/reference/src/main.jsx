import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const platform = window.api?.platform || (navigator.userAgent.includes('Linux') ? 'linux' : 'other');
document.documentElement.dataset.platform = platform;
// Preserve the original font loading on other platforms; Linux uses local fonts.
if (platform !== 'linux') {
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500&display=swap';
  document.head.append(fonts);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
