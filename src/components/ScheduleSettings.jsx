import { useState, useEffect } from 'react';

export default function ScheduleSettings({ onManualRefresh, currentSize, onSizeChange, lastRefreshTime }) {
  const [refreshing, setRefreshing] = useState(false);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [minutesAgo, setMinutesAgo] = useState(null);

  useEffect(() => {
    if (!lastRefreshTime) {
      setMinutesAgo(null);
      return;
    }
    const update = () => {
      const diff = Math.floor((Date.now() - lastRefreshTime) / 60000);
      setMinutesAgo(diff);
    };
    update();
    const id = setInterval(update, 30000); // Check every 30s
    return () => clearInterval(id);
  }, [lastRefreshTime]);

  useEffect(() => {
    async function fetchStartup() {
      if (window.api?.getStartupStatus) {
        const isEnabled = await window.api.getStartupStatus();
        setLaunchOnStartup(isEnabled);
      }
    }
    fetchStartup();
  }, []);

  const handleToggleStartup = () => {
    const newState = !launchOnStartup;
    setLaunchOnStartup(newState);
    if (window.api?.setStartupStatus) {
      window.api.setStartupStatus(newState);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onManualRefresh();
    setTimeout(() => setRefreshing(false), 800);
  };

  const sizes = ['Small', 'Medium', 'Large'];
  const activeIndex = sizes.indexOf(currentSize) >= 0 ? sizes.indexOf(currentSize) : 0;

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: '4px', gap: '12px'
    }}>
      <div style={{
        background: 'var(--md-sys-color-surface-container-high)',
        borderRadius: 'var(--md-sys-shape-corner-medium)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ font: 'var(--md-sys-typescale-label-large)', color: '#FFFFFF' }}>
            Widget Size
          </span>
          <span style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-on-surface-variant)' }}>
            Select a preset to snap the dimensions.
          </span>
        </div>
        
        <div className="settings-segment-container">
          <div 
            className="settings-gliding-pill" 
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {sizes.map((size) => (
            <button
              key={size}
              onClick={() => onSizeChange(size)}
              className={`settings-segment-btn ${currentSize === size ? 'active' : ''}`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--md-sys-color-surface-container-high)',
        borderRadius: 'var(--md-sys-shape-corner-medium)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ font: 'var(--md-sys-typescale-label-large)', color: '#FFFFFF' }}>
              Launch on Startup
            </span>
            <span style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-on-surface-variant)' }}>
              Start widget automatically
            </span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={launchOnStartup} onChange={handleToggleStartup} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div style={{
        background: 'var(--md-sys-color-surface-container-high)',
        borderRadius: 'var(--md-sys-shape-corner-medium)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              background: 'var(--md-sys-color-primary-container)', color: '#000000', border: 'none',
              padding: '6px 12px', borderRadius: 'var(--md-sys-shape-corner-full)', font: 'var(--md-sys-typescale-label-small)',
              fontWeight: 600, cursor: refreshing ? 'default' : 'pointer',
              opacity: refreshing ? 0.7 : 1
            }}
          >
            {refreshing ? 'Syncing...' : 'Force Sync'}
          </button>
          <span style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-on-surface-variant)' }}>
            {minutesAgo !== null ? (minutesAgo === 0 ? 'Just now' : `${minutesAgo}m ago`) : 'v0.0.0'}
          </span>
        </div>
      </div>
    </div>
  );
}
