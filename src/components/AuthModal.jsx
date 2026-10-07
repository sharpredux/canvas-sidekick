import { useEffect, useRef, useState } from 'react';

export default function AuthModal({ onAuthenticated, defaultSchoolUrl = '' }) {
  const [isOpen, setIsOpen] = useState(true); // Open by default if no session (mocked logic)
  const [status, setStatus] = useState('idle');
  const [schoolUrl, setSchoolUrl] = useState(defaultSchoolUrl);
  const [prevDefaultSchoolUrl, setPrevDefaultSchoolUrl] = useState(defaultSchoolUrl);
  const [loginError, setLoginError] = useState(null);
  const pendingUrlRef = useRef('');
  const completionTimerRef = useRef(null);

  if (defaultSchoolUrl !== prevDefaultSchoolUrl) {
    setPrevDefaultSchoolUrl(defaultSchoolUrl);
    setSchoolUrl(defaultSchoolUrl);
  }

  useEffect(() => {
    if (!window.api) return undefined;

    const unsubscribeSuccess = window.api.onCanvasLoginSuccess((authenticatedUrl) => {
      setLoginError(null);
      setStatus('success');
      completionTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        onAuthenticated(authenticatedUrl || pendingUrlRef.current);
      }, 500);
    });

    const unsubscribeFailure = window.api.onCanvasLoginFailed((reason) => {
      setStatus('idle');
      const messages = {
        timeout: 'Login timed out.',
        'invalid-url': 'Enter a valid Canvas URL.',
        'load-failed': 'Canvas could not be opened.'
      };
      setLoginError(messages[reason] || 'Login was cancelled.');
    });

    return () => {
      if (typeof unsubscribeSuccess === 'function') unsubscribeSuccess();
      if (typeof unsubscribeFailure === 'function') unsubscribeFailure();
      clearTimeout(completionTimerRef.current);
    };
  }, [onAuthenticated]);

  if (!isOpen) return null;

  const handleLogin = (e) => {
    e.preventDefault();
    if (!schoolUrl) return;

    // Clear any previous error
    setLoginError(null);

    // Ensure the URL is properly formatted
    let finalUrl = schoolUrl.trim();
    if (!finalUrl.startsWith('http')) {
      finalUrl = `https://${finalUrl}`;
    }

    pendingUrlRef.current = finalUrl;
    setStatus('authenticating');
    if (window.api) {
      window.api.loginCanvas(finalUrl);
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
    <div className="auth-modal">
      <button
        type="button"
        className="close-btn auth-close"
        aria-label="Close Canvas Sidekick"
        onClick={closeApp}
      >
        <svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
          <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
        </svg>
      </button>

      <div className="auth-content">
        <svg className="auth-logo" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
          <path d="M480-120 200-272v-240L40-600l440-240 440 240-160 88v240L480-120Zm0-332 274-148-274-148-274 148 274 148Zm0 241 200-108v-151L480-360 280-470v151l200 108Zm0-241Zm0 90Zm0 0Z"/>
        </svg>
        <h2 className="auth-title">Connect to Canvas</h2>

        {status === 'success' ? (
          <div className="auth-success" role="status">Authenticated Successfully!</div>
        ) : (
          <form className="auth-form" onSubmit={handleLogin}>
            <input
              className="auth-url"
              type="text"
              aria-label="Canvas URL"
              aria-invalid={Boolean(loginError)}
              aria-describedby={loginError ? 'canvas-login-error' : undefined}
              placeholder="canvas.edu"
              value={schoolUrl}
              onChange={(e) => { setSchoolUrl(e.target.value); setLoginError(null); }}
              required
              disabled={status === 'authenticating'}
            />
            {loginError && (
              <span className="auth-error" id="canvas-login-error" role="alert">
                {loginError}
              </span>
            )}
            <button
              className="auth-login"
              type="submit"
              disabled={status === 'authenticating' || !schoolUrl}
            >
              {status === 'authenticating' ? 'Waiting...' : 'Log in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
