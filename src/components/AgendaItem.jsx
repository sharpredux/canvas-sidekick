import { getPrimaryTimeLabel, isDeadlineUrgent } from '../utils/dateFormatter';
import ZoomJoinButton from './ZoomJoinButton';

export default function AgendaItem({ item, onToggleComplete }) {
  const isDeadline = item.type === 'deadline';
  const urgent = isDeadline ? isDeadlineUrgent(item.dueDate) : false;
  const isCompleted = item.completed;
  
  const targetDate = item.dueDate || item.date;

  const formatCourseCode = (courseStr) => {
    if (!courseStr) return '';
    return courseStr.split(' - ')[0];
  };

  // ZOOM 1-ROW OPTIMIZED LAYOUT
  if (item.zoomLink) {
    return (
      <div 
        className={`agenda-item watch-card ${isCompleted ? 'checked-state' : ''}`}
        onClick={() => isDeadline && onToggleComplete(item.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isCompleted ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
          color: isCompleted ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface)',
          padding: '8px 12px', // Tighter padding
          borderRadius: '14px',
          cursor: isDeadline ? 'pointer' : 'default',
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ZoomJoinButton link={item.zoomLink} />
          <span style={{ 
            font: 'var(--md-sys-typescale-title-small)', 
            color: isCompleted ? 'inherit' : '#FFFFFF',
            textDecoration: isCompleted ? 'line-through' : 'none',
            opacity: isCompleted ? 0.7 : 1
          }}>
            {formatCourseCode(item.course)}
          </span>
        </div>
        <span style={{ 
          font: 'var(--md-sys-typescale-label-small)', 
          color: isCompleted ? 'inherit' : (urgent ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)'),
          fontWeight: 600
        }}>
          {getPrimaryTimeLabel(targetDate)}
        </span>
      </div>
    );
  }

  // STANDARD LAYOUT
  return (
    <div 
      className={`agenda-item watch-card ${isCompleted ? 'checked-state' : ''}`}
      onClick={() => isDeadline && onToggleComplete(item.id)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        background: isCompleted ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
        color: isCompleted ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface)',
        padding: '10px 12px',
        borderRadius: '14px',
        cursor: isDeadline ? 'pointer' : 'default',
        boxSizing: 'border-box',
        width: '100%',
        gap: '4px'
      }}
    >
      {/* Top Row: Course Code & Time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
        <span className="item-course" style={{ flex: 1, color: isCompleted ? 'inherit' : 'var(--md-sys-color-on-surface-variant)', opacity: isCompleted ? 0.8 : 1 }}>
          {formatCourseCode(item.course)}
        </span>
        
        {isDeadline && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: '8px' }}>
            <span style={{ 
              font: 'var(--md-sys-typescale-label-small)', 
              color: isCompleted ? 'inherit' : (urgent ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)'),
              fontWeight: 600
            }}>
              {getPrimaryTimeLabel(targetDate)}
            </span>
          </div>
        )}
      </div>

      {/* Main Title */}
      <h3 className="item-title" style={{ 
        font: 'var(--md-sys-typescale-title-small)', 
        margin: '2px 0',
        textDecoration: isCompleted ? 'line-through' : 'none',
        opacity: isCompleted ? 0.7 : 1
      }}>
        {item.title}
      </h3>

      {/* Bottom Complications Row (Estimates) */}
      {isDeadline && item.timeEstimate ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
           <span style={{ 
             font: 'var(--md-sys-typescale-label-small)',
             color: isCompleted ? 'inherit' : 'var(--md-sys-color-on-surface-variant)',
             display: 'flex', alignItems: 'center', gap: '4px',
             opacity: isCompleted ? 0.8 : 1
           }}>
             <svg width="12" height="12" viewBox="0 -960 960 960" fill="currentColor">
               <path d="M360-300q-71 0-120.5-49.5T190-470q0-71 49.5-120.5T360-640q71 0 120.5 49.5T530-470q0 71-49.5 120.5T360-300Zm0-60q46 0 78-32t32-78q0-46-32-78t-78-32q-46 0-78 32t-32 78q0 46 32 78t78 32Z"/>
             </svg>
             {item.timeEstimate}
           </span>
        </div>
      ) : null}

      {/* Announcements and Comments */}
      {(item.type === 'announcement' || item.type === 'comment') && (
        <>
          {item.preview && (
            <p className="item-preview" style={{ margin: 0, marginTop: '4px', font: 'var(--md-sys-typescale-body-small)' }}>
              {item.preview}
            </p>
          )}
          {item.author && (
            <div className="item-author" style={{ 
              font: 'var(--md-sys-typescale-label-small)', 
              color: 'var(--md-sys-color-primary)', 
              marginTop: '4px',
              opacity: 0.8 
            }}>
              By: {item.author}
            </div>
          )}
        </>
      )}
    </div>
  );
}
