import { useState, useRef } from 'react';
import { getPrimaryTimeLabel, isDeadlineUrgent } from '../utils/dateFormatter';
import ZoomJoinButton from './ZoomJoinButton';

export default function AgendaItem({ item, onToggleComplete, onDelete }) {
  const isDeadline = item.type === 'deadline';
  const urgent = isDeadline ? isDeadlineUrgent(item.dueDate) : false;
  const isCompleted = item.completed;
  
  const targetDate = item.dueDate || item.date;

  const formatCourseCode = (courseStr) => {
    if (!courseStr) return '';
    return courseStr.split(' - ')[0];
  };

  const [isRevealed, setIsRevealed] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const hasDraggedRef = useRef(false);
  const startClickX = useRef(0);
  const clickTimeoutRef = useRef(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isCustom = item.isCustom === true;

  const handlePointerDown = (e) => {
    if (!isCustom) return;
    setIsDragging(true);
    hasDraggedRef.current = false;
    startClickX.current = e.clientX;
    startX.current = e.clientX - dragOffset;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const currentX = e.clientX;
    if (Math.abs(currentX - startClickX.current) > 5) {
      hasDraggedRef.current = true;
    }
    const newOffset = Math.max(-100, Math.min(0, currentX - startX.current));
    setDragOffset(newOffset);
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragOffset < -50) {
      setIsRevealed(true);
      setDragOffset(-64);
    } else {
      setIsRevealed(false);
      setDragOffset(0);
    }
  };

  const handlePointerCancel = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragOffset < -50) {
      setIsRevealed(true);
      setDragOffset(-64);
    } else {
      setIsRevealed(false);
      setDragOffset(0);
    }
  };

  const handleDoubleClick = (e) => {
    if (!isCustom) return;
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    const nextRevealed = !isRevealed;
    setIsRevealed(nextRevealed);
    setDragOffset(nextRevealed ? -64 : 0);
    e.stopPropagation();
  };

  const handleClick = (e) => {
    if (isCustom) {
      if (hasDraggedRef.current) {
        e.stopPropagation();
        hasDraggedRef.current = false;
        return;
      }
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
        return;
      }
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
        if (isRevealed || dragOffset < 0) {
          setIsRevealed(false);
          setDragOffset(0);
        } else {
          if (isDeadline) {
            onToggleComplete(item.id);
          }
        }
      }, 200);
      e.stopPropagation();
    } else {
      if (isDeadline) {
        onToggleComplete(item.id);
      }
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setIsDeleting(true);
    setTimeout(() => {
      if (onDelete) {
        onDelete(item.id);
      }
    }, 300);
  };

  const renderForeground = () => {
    if (item.zoomLink) {
      return (
        <div 
          className={`agenda-item watch-card ${isCompleted ? 'checked-state' : ''}`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
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
            transform: isCustom ? `translateX(${isDragging ? dragOffset : (isRevealed ? -64 : 0)}px)` : undefined,
            transition: isCustom ? (isDragging ? 'none' : 'transform 0.2s ease') : undefined,
            touchAction: isCustom ? 'pan-y' : undefined,
            position: isCustom ? 'relative' : undefined,
            zIndex: isCustom ? 2 : undefined,
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

    return (
      <div 
        className={`agenda-item watch-card ${isCompleted ? 'checked-state' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
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
          gap: '4px',
          transform: isCustom ? `translateX(${isDragging ? dragOffset : (isRevealed ? -64 : 0)}px)` : undefined,
          transition: isCustom ? (isDragging ? 'none' : 'transform 0.2s ease') : undefined,
          touchAction: isCustom ? 'pan-y' : undefined,
          position: isCustom ? 'relative' : undefined,
          zIndex: isCustom ? 2 : undefined,
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
  };

  if (isCustom) {
    return (
      <div 
        className="agenda-item-wrapper"
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '14px',
          width: '100%',
          maxHeight: isDeleting ? '0px' : '150px',
          opacity: isDeleting ? 0 : 1,
          transform: isDeleting ? 'translateX(-100%)' : 'none',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div 
          className="agenda-item-background"
          onClick={handleDeleteClick}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '64px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer',
            zIndex: 1,
            boxSizing: 'border-box',
          }}
        >
          <div style={{
            width: '44px',
            height: 'calc(100% - 8px)',
            background: '#ff3b30',
            borderRadius: '12px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            boxShadow: '0 2px 8px rgba(255, 59, 48, 0.3)',
            transition: 'transform 0.1s ease',
            marginRight: '6px'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </div>
        </div>
        {renderForeground()}
      </div>
    );
  }

  return renderForeground();
}
