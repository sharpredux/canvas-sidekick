export default function ZoomJoinButton({ link }) {
  if (!link) return null;

  const handleJoin = (e) => {
    e.stopPropagation();
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(link);
    } else {
      window.open(link, '_blank');
    }
  };

  return (
    <button 
      onClick={handleJoin}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--md-sys-color-primary)', // Vibrant Cyan
        color: '#000000', // Pure black icon for high contrast
        border: 'none',
        width: '28px',
        height: '28px',
        borderRadius: '50%', // Perfect circle
        cursor: 'pointer',
        flexShrink: 0
      }}
      title="Join Zoom Meeting"
    >
      <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor">
        <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l160-160v360L720-460v180q0 33-23.5 56.5T640-160H160Z"/>
      </svg>
    </button>
  );
}
