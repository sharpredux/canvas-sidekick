import { useState, useMemo, useRef, useEffect } from 'react';
import AgendaItem from './AgendaItem';

export default function UpdatesTab({ items, widgetSize }) {
  const [activeCourse, setActiveCourse] = useState('All');

  // Extract unique subjects from the items
  const courses = useMemo(() => {
    const courseSet = new Set();
    items.forEach(item => {
      if (item.course) {
        // Use the short name (e.g., "ITNET04_S24C" instead of full string)
        const shortName = item.course.split(' - ')[0];
        courseSet.add(shortName);
      }
    });
    return ['All', ...Array.from(courseSet).sort()];
  }, [items]);

  const sortedItems = useMemo(() => {
    let filtered = items;
    
    // Filter by subject if not "All"
    if (activeCourse !== 'All') {
      filtered = filtered.filter(item => {
        if (!item.course) return false;
        return item.course.startsWith(activeCourse);
      });
    }
    
    // Sort chronologically (oldest to newest) based on the user's explicit request
    return filtered.sort((a, b) => 
      new Date(a.date || a.dueDate) - new Date(b.date || b.dueDate)
    );
  }, [items, activeCourse]);

  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY < 0 ? -40 : 40 });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div style={{
      width: '100%', flex: 1, display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
    }}>
      {/* Subject Filter Pills */}
      {courses.length > 1 && (
        <div 
          ref={scrollRef}
          className="updates-filters"
        >
          {courses.map(course => {
            const isActive = activeCourse === course;
            return (
              <button
                key={course}
                className="subject-pill"
                onClick={() => setActiveCourse(course)}
                style={{
                  background: isActive ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
                  color: isActive ? '#000000' : 'var(--md-sys-color-secondary)',
                  border: isActive ? 'none' : '1px solid var(--md-sys-color-outline-variant)',
                  fontWeight: isActive ? 700 : 400,
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {course}
              </button>
            )
          })}
          {/* Spacer to maintain right margin when scrolling */}
          <div style={{ width: '1px', flexShrink: 0 }}></div>
        </div>
      )}

      {/* Announcements/Comments List */}
      <div className="updates-list">
        {sortedItems.length === 0 ? (
          <div className="updates-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 12h8"></path>
            </svg>
            <span className="updates-empty-text">
              No updates for {activeCourse}.
            </span>
          </div>
        ) : (
          (widgetSize === 'Small' ? sortedItems.slice(0, 1) : sortedItems).map(item => (
            <AgendaItem
              key={item.id}
              item={item}
            />
          ))
        )}
      </div>
    </div>
  );
}
