import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './index.css';

import TabBar from './components/TabBar';
import AgendaItem from './components/AgendaItem';
import CalendarView from './components/CalendarView';
import AddTaskForm from './components/AddTaskForm';
import AuthModal from './components/AuthModal';
import ScheduleSettings from './components/ScheduleSettings';
import SkeletonAgendaItem from './components/SkeletonAgendaItem';
import AIChatTab from './components/AIChatTab';
import UpdatesTab from './components/UpdatesTab';
import { parseScheduleTSV } from './utils/scheduleParser';

const MOCK_ITEMS = [
  {
    id: '1',
    type: 'deadline',
    title: 'Operating Systems Lecture',
    course: 'CS 410',
    dueDate: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
    timeEstimate: '1.5 hr',
    completed: false,
    zoomLink: 'https://zoom.us/j/1234567890'
  },
  {
    id: '2',
    type: 'announcement',
    title: 'Midterm Grades',
    course: 'MATH 302',
    date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    preview: 'Grades are posted. Class average was 82%.',
    read: false
  },
  {
    id: '3',
    type: 'deadline',
    title: 'Weekly Quiz 4',
    course: 'PHYS 101',
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(),
    timeEstimate: '30m',
    completed: false
  }
];

export default function App() {
  const [activeTab, setActiveTab]           = useState('Up Next');
  const [items, setItems]                   = useState([]);
  const [isFormOpen, setIsFormOpen]         = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [schoolUrl, setSchoolUrl]           = useState('');
  const [scheduleCourses, setScheduleCourses] = useState([]);
  const [rawScheduleText, setRawScheduleText] = useState('');
  const [isLoading, setIsLoading]           = useState(false);
  const [widgetSize, setWidgetSize]         = useState('Medium');

  // ── localStorage caches — read once, write-through ────────────────────────
  const completedIdsRef = useRef(
    new Set(JSON.parse(localStorage.getItem('localCompletedIds') || '[]'))
  );
  const manualTasksRef = useRef(
    JSON.parse(localStorage.getItem('manualTasks') || '[]')
  );

  // ── Core data merge ────────────────────────────────────────────────────────
  const mergeItems = useCallback((newItems) => {
    const isMock = newItems === MOCK_ITEMS;
    
    if (!isMock) {
      const currentPersisted = manualTasksRef.current;
      const persistedMap = new Map(currentPersisted.map(t => [t.id, t]));
      
      newItems.forEach(item => {
        if (persistedMap.has(item.id)) {
          const existing = persistedMap.get(item.id);
          persistedMap.set(item.id, { 
            ...item, 
            timeEstimate: item.timeEstimate || existing.timeEstimate,
            completed: completedIdsRef.current.has(item.id) || existing.completed 
          });
        } else {
          persistedMap.set(item.id, {
            ...item,
            completed: completedIdsRef.current.has(item.id) || !!item.completed
          });
        }
      });
      
      const mergedArray = Array.from(persistedMap.values());
      manualTasksRef.current = mergedArray;
      localStorage.setItem('manualTasks', JSON.stringify(mergedArray));
      
      setItems(mergedArray.map(m => m.isManual ? { ...m, isCustom: true } : m));
    } else {
      const mergedCanvasItems = newItems.map(item =>
        completedIdsRef.current.has(item.id) ? { ...item, completed: true } : item
      );
      setItems([...mergedCanvasItems, ...manualTasksRef.current.map(m => ({ ...m, isCustom: true }))]);
    }
  }, []);

  // ── Auto Task Estimator ────────────────────────────────────────────────────
  const estimatingIdsRef = useRef(new Set());
  
  useEffect(() => {
    if (!window.api?.llmEstimateTask) return;
    
    items.forEach(item => {
      if (item.type === 'deadline' && !item.timeEstimate && !estimatingIdsRef.current.has(item.id)) {
        estimatingIdsRef.current.add(item.id);
        
        window.api.llmEstimateTask(item.title, item.dueDate || item.date)
          .then(res => {
            const estimateStr = `${res.estimatedHours} hr (${res.difficulty})`;
            setItems(prev => {
              const existsInPrev = prev.some(i => i.id === item.id);
              if (!existsInPrev) {
                return prev;
              }
              const updated = prev.map(i => {
                if (i.id === item.id) {
                  return { ...i, timeEstimate: estimateStr, isCustom: i.isManual ? true : i.isCustom };
                }
                return i;
              });
              // Always write to manualTasksRef as part of the core merge logic
              const existing = manualTasksRef.current.find(m => m.id === item.id);
              if (existing) {
                existing.timeEstimate = estimateStr;
              } else {
                manualTasksRef.current.push({ ...item, timeEstimate: estimateStr });
              }
              localStorage.setItem('manualTasks', JSON.stringify(manualTasksRef.current));
              return updated;
            });
          })
          .catch(err => {
            console.error('Failed to estimate task:', err);
            estimatingIdsRef.current.delete(item.id);
          });
      }
    });
  }, [items]);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const handleAuthenticated = useCallback(async (url) => {
    setIsAuthenticated(true);
    setSchoolUrl(url);
    setIsLoading(true);
    if (window.api?.saveSettings) {
      window.api.saveSettings({ size: widgetSize, schoolUrl: url });
    }
    try {
      if (window.api && url) {
        const realData = await window.api.fetchCanvasData(url);
        mergeItems(Array.isArray(realData) ? realData : MOCK_ITEMS);
      } else {
        await new Promise(r => setTimeout(r, 1500));
        mergeItems(MOCK_ITEMS);
      }
    } catch (err) {
      console.error('Failed to fetch initial Canvas data', err);
      if (err.message?.includes('no_cookie') || err.message?.includes('decrypt_failed') || err.message?.includes('unauthorized')) {
        setIsAuthenticated(false);
      } else {
        mergeItems(MOCK_ITEMS); // Fallback to mock items to avoid lockup
      }
    } finally {
      setIsLoading(false);
    }
  }, [mergeItems, widgetSize]);

  // Load saved settings and schedule on mount
  useEffect(() => {
    async function loadData() {
      try {
        let loadedSchoolUrl = '';
        if (window.api?.loadSettings) {
          const settings = await window.api.loadSettings();
          if (settings?.size) setWidgetSize(settings.size);
          if (settings?.schoolUrl) {
            loadedSchoolUrl = settings.schoolUrl;
            setSchoolUrl(settings.schoolUrl);
          }
        }
        if (window.api?.loadSchedule) {
          const rawText = await window.api.loadSchedule();
          if (rawText) {
            setRawScheduleText(rawText);
            setScheduleCourses(parseScheduleTSV(rawText));
          }
        }
        if (loadedSchoolUrl) {
          const hasSession = window.api?.hasSession
            ? await window.api.hasSession()
            : true;

          if (hasSession) {
            try {
              if (window.api?.fetchCanvasData) {
                const realData = await window.api.fetchCanvasData(loadedSchoolUrl);
                mergeItems(Array.isArray(realData) ? realData : MOCK_ITEMS);
                setIsAuthenticated(true);
              } else {
                await new Promise(r => setTimeout(r, 1500));
                mergeItems(MOCK_ITEMS);
                setIsAuthenticated(true);
              }
            } catch (err) {
              console.error('Failed to verify initial Canvas session', err);
              if (err.message?.includes('no_cookie') || err.message?.includes('decrypt_failed') || err.message?.includes('unauthorized')) {
                setIsAuthenticated(false);
              } else {
                // network / connection issue
                mergeItems(MOCK_ITEMS);
                setIsAuthenticated(true);
              }
            }
          } else {
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('Failed to load initial data', err);
      } finally {
        setIsCheckingAuth(false);
      }
    }
    loadData();
  }, [mergeItems]);

  // Handle background polling session expiry
  useEffect(() => {
    if (!window.api?.onCanvasUnauthorized) return;
    const unsubscribe = window.api.onCanvasUnauthorized(() => {
      console.warn('Background poll reported unauthorized (session expired). Redirecting to login.');
      setIsAuthenticated(false);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleSizeChange = useCallback((size) => {
    setWidgetSize(size);
    if (window.api?.saveSettings) {
      window.api.saveSettings({ size, schoolUrl });
    }
    if (window.api?.resizeWindow) {
      window.api.resizeWindow(size);
    }
  }, [schoolUrl]);

  // ── Manual refresh (Settings panel button) ─────────────────────────────────
  const forceRefreshCanvas = useCallback(async () => {
    if (!isAuthenticated || !schoolUrl || !window.api) return;
    setIsLoading(true);
    try {
      const realData = await window.api.fetchCanvasData(schoolUrl);
      if (Array.isArray(realData)) mergeItems(realData);
    } catch (err) {
      console.error('Manual refresh failed', err);
    }
    setIsLoading(false);
  }, [isAuthenticated, schoolUrl, mergeItems]);

  // ── Main-process polling (replaces renderer setInterval) ───────────────────
  // Once authenticated, we hand polling responsibility to the main process.
  // Main only pushes 'canvas-data-update' when the data hash has changed,
  // so the renderer is never woken up for a no-op refresh.
  useEffect(() => {
    if (!isAuthenticated || !schoolUrl || !window.api) return;

    // Tell main process to start polling
    window.api.startCanvasPolling(schoolUrl);

    // Subscribe to pushed updates
    const unsubscribe = window.api.onCanvasDataUpdate((data) => {
      if (Array.isArray(data)) mergeItems(data);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isAuthenticated, schoolUrl, mergeItems]);

  // ── Completion toggle ──────────────────────────────────────────────────────
  const toggleItemComplete = useCallback((id) => {
    setItems(prevItems => {
      const updatedItems = prevItems.map(item =>
        item.id === id ? { ...item, completed: !item.completed } : item
      );

      const isNowCompleted = updatedItems.find(i => i.id === id)?.completed;

      // Update ref + write-through (no extra localStorage.getItem call)
      if (isNowCompleted) completedIdsRef.current.add(id);
      else completedIdsRef.current.delete(id);
      localStorage.setItem(
        'localCompletedIds',
        JSON.stringify(Array.from(completedIdsRef.current))
      );

      // Update manual tasks in ref + write-through
      manualTasksRef.current = manualTasksRef.current.map(m =>
        m.id === id ? { ...m, completed: isNowCompleted } : m
      );
      localStorage.setItem('manualTasks', JSON.stringify(manualTasksRef.current));

      return updatedItems;
    });
  }, []);

  // ── Delete custom task ──────────────────────────────────────────────────────
  const deleteCustomTask = useCallback((id) => {
    setItems(prevItems => prevItems.filter(item => item.id !== id));
    manualTasksRef.current = manualTasksRef.current.filter(item => item.id !== id);
    localStorage.setItem('manualTasks', JSON.stringify(manualTasksRef.current));
    
    if (completedIdsRef.current.has(id)) {
      completedIdsRef.current.delete(id);
      localStorage.setItem(
        'localCompletedIds',
        JSON.stringify(Array.from(completedIdsRef.current))
      );
    }
  }, []);

  // ── Add manual task ────────────────────────────────────────────────────────
  const addNewItem = useCallback((newItem) => {
    const newManualItem = { ...newItem, isManual: true, isCustom: true };
    manualTasksRef.current = [...manualTasksRef.current, newManualItem];
    localStorage.setItem('manualTasks', JSON.stringify(manualTasksRef.current));
    setItems(prev => [...prev, newManualItem]);
    setIsFormOpen(false);
  }, []);

  // ── Schedule import ────────────────────────────────────────────────────────
  const handleScheduleSave = useCallback((courses, rawText) => {
    setScheduleCourses(courses);
    setRawScheduleText(rawText);
    if (window.api?.saveSchedule) window.api.saveSchedule(rawText);
  }, []);

  const closeApp = useCallback(() => {
    if (window.api) window.api.closeApp();
  }, []);

  // ── Filtered + sorted items — only recomputes when inputs change ──────────
  const filteredItems = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let filtered = items.filter(item => {
      // Hide completed tasks from previous days EXCEPT in Calendar view
      if (item.completed && activeTab !== 'Calendar') {
        const itemDate = new Date(item.dueDate || item.date);
        if (itemDate < today) return false;
      }
      if (activeTab === 'Tasks')   return item.type === 'deadline';
      if (activeTab === 'Updates') return item.type === 'announcement' || item.type === 'comment';
      return item.type === 'deadline' || item.type === 'event';
    });

    if (scheduleCourses.length > 0) {
      const allowedCourses = new Set(scheduleCourses.map(c => c.courseCode.toLowerCase()));
      filtered = filtered.filter(item => {
        if (item.isManual || item.course === 'Personal') return true;
        return Array.from(allowedCourses).some(allowed =>
          item.course?.toLowerCase().includes(allowed)
        );
      });

      filtered = filtered.map(item => {
        if (!item.zoomLink) return item;
        const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const itemDay = days[new Date(item.dueDate || item.date).getDay()];
        const isOnlineToday = scheduleCourses.some(c =>
          item.course?.toLowerCase().includes(c.courseCode.toLowerCase()) &&
          c.day === itemDay && c.isOnline
        );
        return isOnlineToday ? item : { ...item, zoomLink: null };
      });
    }

    return filtered.sort((a, b) =>
      new Date(a.dueDate || a.date) - new Date(b.dueDate || b.date)
    );
  }, [items, activeTab, scheduleCourses]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isCheckingAuth) {
    return (
      <div className={`app-container ${widgetSize === 'Small' ? 'compact-mode' : ''}`}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          color: '#FFFFFF'
        }}>
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--md-sys-color-primary, #32ADE6)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: 'spin 1s linear infinite' }}
          >
            <circle cx="12" cy="12" r="10" stroke="rgba(255, 255, 255, 0.1)" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${widgetSize === 'Small' ? 'compact-mode' : ''}`}>
      {!isAuthenticated && (
        <AuthModal onAuthenticated={handleAuthenticated} defaultSchoolUrl={schoolUrl} />
      )}

      <div className="compact-top-bar">
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={closeApp}
        />
      </div>

      <div className="content-area">
        {activeTab === 'Settings' ? (
          <ScheduleSettings
            onScheduleSave={handleScheduleSave}
            initialRawText={rawScheduleText}
            onManualRefresh={forceRefreshCanvas}
            currentSize={widgetSize}
            onSizeChange={handleSizeChange}
          />
        ) : activeTab === 'AI Chat' ? (
          <AIChatTab 
            widgetSize={widgetSize} 
            items={items}
            setItems={setItems}
            toggleItemComplete={toggleItemComplete}
            addNewItem={addNewItem}
          />
        ) : activeTab === 'Calendar' ? (
          <CalendarView
            items={items}
            widgetSize={widgetSize}
            onToggleComplete={toggleItemComplete}
            onScheduleSave={handleScheduleSave}
            initialRawText={rawScheduleText}
            onDelete={deleteCustomTask}
          />
        ) : activeTab === 'Updates' ? (
          <UpdatesTab items={filteredItems} widgetSize={widgetSize} />
        ) : isLoading ? (
          <>
            <SkeletonAgendaItem />
            <SkeletonAgendaItem />
            <SkeletonAgendaItem />
            <SkeletonAgendaItem />
          </>
        ) : filteredItems.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', flex: 1, height: '100%', opacity: 0.5, gap: '8px'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 12h8"></path>
            </svg>
            <span style={{ font: 'var(--md-sys-typescale-body-medium)', color: 'var(--md-sys-color-on-surface)' }}>
              Nothing here right now.
            </span>
          </div>
        ) : (
          (widgetSize === 'Small' ? filteredItems.slice(0, 1) : filteredItems).map(item => (
            <AgendaItem
              key={item.id}
              item={item}
              onToggleComplete={toggleItemComplete}
              onDelete={deleteCustomTask}
            />
          ))
        )}
      </div>

      <AddTaskForm
        isOpen={isFormOpen}
        showFab={activeTab === 'Up Next' || activeTab === 'Tasks'}
        onToggle={() => setIsFormOpen(!isFormOpen)}
        onAdd={addNewItem}
      />
    </div>
  );
}
