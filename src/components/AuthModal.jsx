import { useState } from 'react';

export default function AuthModal({ onAuthenticated, defaultSchoolUrl = '' }) {
  const [isOpen, setIsOpen] = useState(true); // Open by default if no session (mocked logic)
  const [status, setStatus] = useState('idle');
  const [schoolUrl, setSchoolUrl] = useState(defaultSchoolUrl);
  const [prevDefaultSchoolUrl, setPrevDefaultSchoolUrl] = useState(defaultSchoolUrl);

  if (defaultSchoolUrl !== prevDefaultSchoolUrl) {
    setPrevDefaultSchoolUrl(defaultSchoolUrl);
    setSchoolUrl(defaultSchoolUrl);
  }

  // We bind the listener directly inside handleLogin to capture the URL.

  if (!isOpen) return null;

  const handleLogin = (e) => {
    e.preventDefault();
    if (!schoolUrl) return;

    // Ensure the URL is properly formatted
    let finalUrl = schoolUrl.trim();
    if (!finalUrl.startsWith('http')) {
      finalUrl = `https://${finalUrl}`;
    }

    setStatus('authenticating');
    if (window.api) {
      window.api.loginCanvas(finalUrl);
      
      // Override the old event listener to ensure we capture the finalUrl
      window.api.onCanvasLoginSuccess(() => {
        setStatus('success');
        setTimeout(() => {
          setIsOpen(false);
          onAuthenticated(finalUrl);
        }, 1500);
      });
    } else {
      // Mock for standard web browser dev
      setTimeout(() => {
        setStatus('success');
        setTimeout(() => {
          setIsOpen(false);
          onAuthenticated(finalUrl);
        }, 1500);
      }, 2000);
    }
  };

  const closeApp = () => {
    if (window.api && window.api.closeApp) {
      window.api.closeApp();
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: '#000000',
      zIndex: 100, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '12px',
      textAlign: 'center', boxSizing: 'border-box',
      borderRadius: 'var(--md-sys-shape-corner-extra-large)'
    }}>
      <div style={{
        color: 'var(--md-sys-color-primary)', /* Vibrant Cyan */
        marginBottom: '12px'
      }}>
        {/* Close Button Top Right */}
        <button 
          className="close-btn" 
          onClick={closeApp}
          style={{ position: 'absolute', top: '16px', right: '16px' }}
        >
          <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
          </svg>
        </button>

        {/* Simplified Watch-style Icon */}
        <svg width="32" height="32" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M480-120 200-272v-240L40-600l440-240 440 240-160 88v240L480-120Zm0-332 274-148-274-148-274 148 274 148Zm0 241 200-108v-151L480-360 280-470v151l200 108Zm0-241Zm0 90Zm0 0Z"/>
        </svg>
      </div>

      <h2 style={{ font: 'var(--md-sys-typescale-title-small)', margin: '0 0 12px 0' }}>
        Connect to Canvas
      </h2>

      {status === 'success' ? (
        <div style={{ font: 'var(--md-sys-typescale-label-large)', color: 'var(--md-sys-color-primary)' }}>
          Authenticated Successfully!
        </div>
      ) : (
        <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input 
            type="text" 
            placeholder="canvas.edu" 
            value={schoolUrl}
            onChange={(e) => setSchoolUrl(e.target.value)}
            required
            disabled={status === 'authenticating'}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 'var(--md-sys-shape-corner-full)',
              border: 'none',
              background: 'var(--md-sys-color-surface-container-high)',
              color: '#FFFFFF',
              font: 'var(--md-sys-typescale-label-medium)',
              boxSizing: 'border-box',
              textAlign: 'center'
            }}
          />
          <button 
            type="submit"
            disabled={status === 'authenticating' || !schoolUrl}
            style={{
              background: 'var(--md-sys-color-primary-container)', /* Neon Green */
              color: '#000000', /* Maximum contrast */
              border: 'none',
              padding: '10px 12px',
              borderRadius: 'var(--md-sys-shape-corner-full)',
              font: 'var(--md-sys-typescale-label-medium)',
              fontWeight: 600,
              cursor: (status === 'authenticating' || !schoolUrl) ? 'default' : 'pointer',
              opacity: (status === 'authenticating' || !schoolUrl) ? 0.7 : 1,
              width: '100%'
            }}
          >
            {status === 'authenticating' ? 'Waiting...' : 'Log in'}
          </button>
        </form>
      )}
    </div>
  );
}
