import { useState, useEffect } from 'react';
import AgendaItem from './AgendaItem';
import { parseScheduleTSV } from '../utils/scheduleParser';

export default function CalendarView({ items, widgetSize, onToggleComplete, onScheduleSave, initialRawText = '', onDelete }) {
  // Calendar States
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0,0,0,0);
    return d;
  });
  
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'day'
  const [selectedDate, setSelectedDate] = useState(null);
  const [archivedTasks, setArchivedTasks] = useState([]);

  useEffect(() => {
    if (selectedDate && window.api?.getArchivedTasks) {
      const d = new Date(selectedDate);
      const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      window.api.getArchivedTasks(dateStr).then(tasks => {
        setArchivedTasks(tasks || []);
      }).catch(() => setArchivedTasks([]));
    } else {
      setArchivedTasks([]);
    }
  }, [selectedDate]);

  // Import States
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [rawText, setRawText] = useState(initialRawText);
  const [status, setStatus] = useState('');
  const [importViewMode, setImportViewMode] = useState('input'); // 'input' | 'schedule'
  const [activeDay, setActiveDay] = useState('MON');
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const [prevInitialRawText, setPrevInitialRawText] = useState(initialRawText);
  if (initialRawText !== prevInitialRawText) {
    setPrevInitialRawText(initialRawText);
    setRawText(initialRawText);
  }

  const handleSave = () => {
    if (!rawText.trim()) {
      if (onScheduleSave) onScheduleSave([], '');
      setStatus('success');
      setTimeout(() => setStatus(''), 2000);
      return;
    }

    const courses = parseScheduleTSV(rawText);
    if (courses.length > 0) {
      if (onScheduleSave) onScheduleSave(courses, rawText);
      setStatus('success');
    } else {
      setStatus('error');
    }
    setTimeout(() => setStatus(''), 2000);
  };

  const parseTimeSlot = (timeStr) => {
    try {
      const start = timeStr.split('-')[0].trim();
      let time = start.slice(0, -2);
      let modifier = start.slice(-2).toUpperCase();
      let [hours, minutes] = time.split(':');
      hours = parseInt(hours, 10);
      minutes = parseInt(minutes, 10);
      if (hours === 12) hours = 0;
      if (modifier === 'PM') hours += 12;
      return hours * 60 + minutes;
    } catch {
      return 0;
    }
  };

  const parsedCourses = parseScheduleTSV(rawText);
  const parsedCount = rawText.trim() ? parsedCourses.length : 0;
  const activeDayCourses = parsedCourses.filter(c => c.day === activeDay).sort((a, b) => parseTimeSlot(a.timeSlot) - parseTimeSlot(b.timeSlot));

  if (isImportOpen) {
    if (importViewMode === 'schedule') {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: '4px', gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <h2 style={{ font: 'var(--md-sys-typescale-title-small)', color: 'var(--md-sys-color-primary)', margin: '0' }}>
              Your Schedule
            </h2>
            <button 
              onClick={() => setIsImportOpen(false)}
              style={{
                background: 'transparent', border: '1px solid var(--md-sys-color-outline-variant)',
                color: 'var(--md-sys-color-secondary)', padding: '4px 8px', borderRadius: 'var(--md-sys-shape-corner-full)',
                font: 'var(--md-sys-typescale-label-small)', cursor: 'pointer'
              }}
            >
              Back
            </button>
          </div>
  
          {/* Day Picker */}
          <div style={{
            display: 'flex', gap: '4px', overflowX: 'auto', padding: '4px', scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch'
          }}>
            {DAYS.map(day => {
              const isActive = activeDay === day;
              return (
                <button
                  key={day}
                  onClick={() => setActiveDay(day)}
                  style={{
                    background: isActive ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
                    color: isActive ? '#000000' : 'var(--md-sys-color-secondary)',
                    border: isActive ? 'none' : '1px solid var(--md-sys-color-outline-variant)',
                    padding: '6px 10px',
                    borderRadius: 'var(--md-sys-shape-corner-full)',
                    font: 'var(--md-sys-typescale-label-small)',
                    fontWeight: isActive ? 700 : 400,
                    flexShrink: 0,
                    cursor: 'pointer'
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>
  
          {/* Timeline */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '4px', display: 'flex', flexDirection: 'column', gap: '8px'
          }}>
            {activeDayCourses.length === 0 ? (
              <div style={{ color: 'var(--md-sys-color-on-surface-variant)', font: 'var(--md-sys-typescale-body-small)', textAlign: 'center', marginTop: '20px' }}>
                No classes on this day.
              </div>
            ) : (
              activeDayCourses.map(course => (
                <div key={course.id} style={{
                  background: 'var(--md-sys-color-surface-container-high)',
                  borderRadius: 'var(--md-sys-shape-corner-medium)',
                  padding: '8px 12px',
                  display: 'flex', flexDirection: 'column', gap: '4px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-primary)' }}>
                      {course.timeSlot}
                    </span>
                    {course.isOnline && (
                      <span style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-error)' }}>
                        Online
                      </span>
                    )}
                  </div>
                  <div style={{ font: 'var(--md-sys-typescale-label-large)', color: '#FFFFFF', fontWeight: 600 }}>
                    {course.courseCode}
                  </div>
                  <div style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-secondary)', fontSize: '10px' }}>
                    {course.courseTitle}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <div style={{ background: 'var(--md-sys-color-surface-container)', padding: '2px 6px', borderRadius: '14px', font: 'var(--md-sys-typescale-body-small)', fontSize: '9px', color: 'var(--md-sys-color-secondary)' }}>
                      {course.venue}
                    </div>
                    <div style={{ background: 'var(--md-sys-color-surface-container)', padding: '2px 6px', borderRadius: '14px', font: 'var(--md-sys-typescale-body-small)', fontSize: '9px', color: 'var(--md-sys-color-secondary)' }}>
                      {course.teacher}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      );
    }
  
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: '4px', gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              onClick={() => setIsImportOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--md-sys-color-secondary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
                <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/>
              </svg>
            </button>
            <h2 style={{ font: 'var(--md-sys-typescale-title-small)', color: 'var(--md-sys-color-primary)', margin: '0' }}>
              Smart Import
            </h2>
          </div>
          {parsedCount > 0 && (
            <span style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-secondary)' }}>
              {parsedCount} detected
            </span>
          )}
        </div>
  
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Paste schedule table..."
          style={{
            flex: 1, width: '100%', resize: 'none', padding: '12px',
            borderRadius: 'var(--md-sys-shape-corner-large)', background: 'var(--md-sys-color-surface-container-high)',
            border: '1px solid var(--md-sys-color-outline-variant)', color: '#FFFFFF',
            font: 'var(--md-sys-typescale-body-small)', fontFamily: 'monospace', boxSizing: 'border-box', outline: 'none', whiteSpace: 'pre'
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--md-sys-color-primary)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--md-sys-color-outline-variant)'}
        />
  
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ font: 'var(--md-sys-typescale-label-small)', color: status === 'error' ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)' }}>
            {status === 'error' ? 'Invalid format' : status === 'success' ? 'Saved!' : ''}
            {parsedCount > 0 && status === '' && (
              <button
                onClick={() => setImportViewMode('schedule')}
                style={{
                  background: 'transparent', border: '1px solid var(--md-sys-color-primary)',
                  color: 'var(--md-sys-color-primary)', padding: '6px 12px', borderRadius: 'var(--md-sys-shape-corner-full)',
                  font: 'var(--md-sys-typescale-label-small)', cursor: 'pointer'
                }}
              >
                View
              </button>
            )}
          </div>
          
          <button
            onClick={handleSave}
            style={{
              background: 'var(--md-sys-color-primary-container)', color: '#000000', border: 'none',
              padding: '8px 16px', borderRadius: 'var(--md-sys-shape-corner-full)', font: 'var(--md-sys-typescale-label-medium)',
              fontWeight: 600, cursor: 'pointer'
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  const deadlines = items.filter(item => item.type === 'deadline' || item.type === 'event');

  const changeMonth = (offset) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + offset);
    setCurrentMonth(newMonth);
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = currentMonth.getDay(); // 0 (Sun) to 6 (Sat)

  // Generate grid cells
  const gridCells = [];
  // Empty slots before 1st
  for (let i = 0; i < firstDayOfWeek; i++) {
    gridCells.push(null);
  }
  // Days of month
  for (let d = 1; d <= daysInMonth; d++) {
    gridCells.push(d);
  }

  const handleDayClick = (dayNum, taskCount, hasClass) => {
    if (taskCount === 0 && !hasClass) return;
    const clickedDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayNum);
    setSelectedDate(clickedDate.getTime());
    if (widgetSize === 'Small') {
      setViewMode('day');
    }
  };

  const renderDayDetails = (dateMs, inline = false) => {
    const selectedTasks = deadlines.filter(item => {
      const itemDate = new Date(item.dueDate || item.date);
      itemDate.setHours(0,0,0,0);
      return itemDate.getTime() === dateMs;
    }).sort((a, b) => new Date(a.dueDate || a.date) - new Date(b.dueDate || b.date));

    const mergedTasks = [...selectedTasks];
    const existingIds = new Set(selectedTasks.map(t => t.id));
    archivedTasks.forEach(t => {
      if (!existingIds.has(t.id)) mergedTasks.push(t);
    });
    mergedTasks.sort((a, b) => new Date(a.dueDate || a.date) - new Date(b.dueDate || b.date));

    const clickedDateObj = new Date(dateMs);
    const dayOfWeekName = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][clickedDateObj.getDay()];
    const dayClasses = parsedCourses.filter(c => c.day === dayOfWeekName).sort((a, b) => parseTimeSlot(a.timeSlot) - parseTimeSlot(b.timeSlot));

    const formattedDate = clickedDateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: inline ? 'auto' : '100%', flex: inline ? '1' : 'none', minHeight: '0', paddingBottom: inline ? '8px' : '0' }}>
        <button 
          onClick={() => {
            if (inline) setSelectedDate(null);
            else setViewMode('grid');
          }}
          style={{
            background: 'none', border: 'none', color: 'var(--md-sys-color-primary)',
            padding: '4px 0', marginBottom: '4px', cursor: 'pointer', textAlign: 'left',
            font: 'var(--md-sys-typescale-label-small)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px'
          }}
        >
          {inline ? (
            <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
              <path d="M256-200l-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
              <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/>
            </svg>
          )}
          {formattedDate}
        </button>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
          {dayClasses.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              <div style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-primary)', fontWeight: 'bold', paddingLeft: '4px' }}>
                Classes
              </div>
              {dayClasses.map(course => (
                <div key={course.id} style={{
                  background: 'var(--md-sys-color-surface-container-high)',
                  borderRadius: 'var(--md-sys-shape-corner-medium)',
                  padding: '6px 10px',
                  display: 'flex', flexDirection: 'column', gap: '2px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-primary)', fontSize: '9px' }}>
                      {course.timeSlot}
                    </span>
                    {course.isOnline && (
                      <span style={{ font: 'var(--md-sys-typescale-label-small)', color: 'var(--md-sys-color-error)', fontSize: '9px' }}>
                        Online
                      </span>
                    )}
                  </div>
                  <div style={{ font: 'var(--md-sys-typescale-label-medium)', color: '#FFFFFF', fontWeight: 600 }}>
                    {course.courseCode}
                  </div>
                  <div style={{ font: 'var(--md-sys-typescale-body-small)', color: 'var(--md-sys-color-secondary)', fontSize: '9px' }}>
                    {course.venue} {course.teacher ? `• ${course.teacher}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {mergedTasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {mergedTasks.map(item => (
                <AgendaItem key={item.id} item={item} onToggleComplete={onToggleComplete} onDelete={onDelete} />
              ))}
            </div>
          )}

          {dayClasses.length === 0 && mergedTasks.length === 0 && (
            <div style={{ color: 'var(--md-sys-color-on-surface-variant)', font: 'var(--md-sys-typescale-body-small)', textAlign: 'center', marginTop: '20px' }}>
              No tasks or classes.
            </div>
          )}
        </div>
      </div>
    );
  };

  if (viewMode === 'day' && selectedDate && widgetSize === 'Small') {
    return renderDayDetails(selectedDate, false);
  }

  // Grid View
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 4px', position: 'relative' }}>
      
      {/* Month Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}>
          <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor"><path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
        </button>
        <span style={{ font: 'var(--md-sys-typescale-label-small)', fontWeight: 'bold', color: '#fff' }}>
          {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </span>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={() => changeMonth(1)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}>
            <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor"><path d="M321-80l-71-71 329-329-329-329 71-71 400 400L321-80Z"/></svg>
          </button>
        </div>
      </div>

      {/* Weekday Labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: '4px' }}>
        {weekdays.map((wd, i) => (
          <div key={i} style={{ font: 'var(--md-sys-typescale-label-small)', opacity: 0.5, fontSize: '10px' }}>{wd}</div>
        ))}
      </div>

      {/* Month Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', flex: 'none', alignContent: 'start' }}>
        {gridCells.map((dayNum, idx) => {
          if (!dayNum) return <div key={idx} />;

          const dDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayNum);
          
          const tasksOnDay = deadlines.filter(item => {
            const itemDate = new Date(item.dueDate || item.date);
            itemDate.setHours(0,0,0,0);
            return itemDate.getTime() === dDate.getTime();
          });
          const count = tasksOnDay.length;

          const dayOfWeekName = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dDate.getDay()];
          const hasClass = parsedCourses.some(c => c.day === dayOfWeekName);

          // Heatmap logic
          let bg = 'transparent';
          let border = '1px solid var(--md-sys-color-surface-container-high)';
          let color = '#fff';
          let cursor = (count > 0 || hasClass) ? 'pointer' : 'default';
          
          const allCompleted = count > 0 && tasksOnDay.every(t => t.completed);
          
          if (count > 0) {
            if (allCompleted) {
              bg = 'rgba(40, 200, 64, 0.2)';
              border = '1px solid rgba(40, 200, 64, 0.5)';
              color = 'rgba(40, 200, 64, 1)';
            } else if (count < 3) {
              bg = 'rgba(255, 149, 0, 0.4)';
              border = '1px solid rgba(255, 149, 0, 0.4)';
            } else {
              bg = 'var(--md-sys-color-error)';
              border = '1px solid var(--md-sys-color-error)';
            }
          }

          return (
            <div 
              key={idx} 
              onClick={() => handleDayClick(dayNum, count, hasClass)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                aspectRatio: '1/1',
                borderRadius: '50%',
                background: bg,
                border: border,
                color: color,
                fontSize: '11px',
                fontWeight: (count > 0 || hasClass) ? 'bold' : 'normal',
                cursor: cursor,
                margin: 'auto',
                width: '100%',
                maxWidth: '20px',
                position: 'relative'
              }}
            >
              <span>{dayNum}</span>
              {hasClass && (
                <div style={{
                  width: '3px',
                  height: '3px',
                  borderRadius: '50%',
                  background: 'var(--md-sys-color-primary)',
                  position: 'absolute',
                  bottom: '2px'
                }} />
              )}
            </div>
          );
        })}
      </div>
      
      {/* Inline Selected Day Details for Medium/Large sizes */}
      {selectedDate && widgetSize !== 'Small' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: '8px', marginTop: '0.25in' }}>
          {renderDayDetails(selectedDate, true)}
        </div>
      )}

      {/* Side-by-side Schedule and Import Buttons at the bottom */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'auto', paddingTop: '4px', paddingBottom: '4px' }}>
        <button
          onClick={() => {
            setIsImportOpen(true);
            setImportViewMode('schedule');
          }}
          style={{
            background: 'var(--md-sys-color-surface-container-high)',
            color: 'var(--md-sys-color-primary)',
            border: '1px solid var(--md-sys-color-outline-variant)',
            padding: '6px 14px',
            borderRadius: 'var(--md-sys-shape-corner-full)',
            font: 'var(--md-sys-typescale-label-medium)',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}
        >
          <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T780-80H200Zm0-80h580v-400H200v400Zm0-480h580v-80H200v80Zm0 0v-80 80Z"/>
          </svg>
          Schedule
        </button>
        <button
          onClick={() => {
            setIsImportOpen(true);
            setImportViewMode('input');
          }}
          style={{
            background: 'var(--md-sys-color-primary-container)',
            color: '#000',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 'var(--md-sys-shape-corner-full)',
            font: 'var(--md-sys-typescale-label-medium)',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}
        >
          <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
          </svg>
          Import
        </button>
      </div>
    </div>
  );
}
