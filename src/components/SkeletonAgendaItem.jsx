export default function SkeletonAgendaItem() {
  return (
    <div 
      className="agenda-item watch-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--md-sys-color-surface-container-high)',
        padding: '10px 12px',
        borderRadius: '14px',
        boxSizing: 'border-box',
        width: '100%',
        gap: '6px'
      }}
    >
      {/* Top Row: Course Code & Time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div className="skeleton-block" style={{ width: '40%', height: '14px', borderRadius: '14px' }} />
        <div className="skeleton-block" style={{ width: '20%', height: '14px', borderRadius: '14px' }} />
      </div>

      {/* Main Title */}
      <div className="skeleton-block" style={{ width: '80%', height: '16px', borderRadius: '14px', margin: '4px 0' }} />

      {/* Bottom Row Complications */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center' }}>
         <div className="skeleton-block" style={{ width: '24px', height: '12px', borderRadius: '14px' }} />
         <div className="skeleton-block" style={{ width: '40px', height: '12px', borderRadius: '14px' }} />
      </div>
    </div>
  );
}
