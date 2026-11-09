export default function AddTaskForm({ isOpen, onToggle, onAdd, showFab = true }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newItem = {
      id: Date.now().toString(),
      type: 'deadline',
      title: formData.get('title'),
      course: formData.get('course') || 'Personal',
      dueDate: new Date(formData.get('date')).toISOString(),
      timeEstimate: formData.get('time') || null,
      completed: false
    };
    onAdd(newItem);
  };

  return (
    <>
      {!isOpen && showFab && (
        <button className="fab" onClick={onToggle} style={{ zIndex: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      )}

      {isOpen && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'var(--md-sys-color-surface-container)', zIndex: 5, 
          padding: '8px', 
          display: 'flex', flexDirection: 'column',
          overflowX: 'hidden', overflowY: 'auto',
          boxSizing: 'border-box',
          borderRadius: 'var(--md-sys-shape-corner-extra-large)' // Fixes the hard square bug
        }}>
          
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', marginTop: '4px' }}>
            <button 
              className="close-btn"
              onClick={onToggle}
              aria-label="Close"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <span style={{ font: 'var(--md-sys-typescale-label-medium)', color: '#fff', marginLeft: '8px' }}>
              New Task
            </span>
          </div>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
            
            <input name="title" placeholder="Title" required style={{
              background: 'var(--md-sys-color-surface-container-high)', border: 'none', 
              padding: '8px 12px', borderRadius: '14px', color: '#fff', 
              font: 'var(--md-sys-typescale-label-small)'
            }} />
            
            <input name="course" placeholder="Course" style={{
              background: 'var(--md-sys-color-surface-container-high)', border: 'none', 
              padding: '8px 12px', borderRadius: '14px', color: '#fff', 
              font: 'var(--md-sys-typescale-label-small)'
            }} />

            <input name="time" placeholder="Time Estimate (e.g. 30m)" style={{
              background: 'var(--md-sys-color-surface-container-high)', border: 'none', 
              padding: '8px 12px', borderRadius: '14px', color: '#fff', 
              font: 'var(--md-sys-typescale-label-small)'
            }} />
            
            <input name="date" type="datetime-local" required style={{
              background: 'var(--md-sys-color-surface-container-high)', border: 'none', 
              padding: '8px 12px', borderRadius: '14px', color: '#fff', colorScheme: 'dark', 
              font: 'var(--md-sys-typescale-label-small)'
            }} />

            <button type="submit" style={{
              background: 'var(--md-sys-color-primary-container)', color: '#000000', border: 'none',
              padding: '10px', borderRadius: '14px', font: 'var(--md-sys-typescale-label-medium)', fontWeight: 'bold', 
              marginTop: '12px', cursor: 'pointer', width: '100%'
            }}>
              Add Task
            </button>
          </form>
        </div>
      )}
    </>
  );
}
