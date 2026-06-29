import { useState, useEffect, useCallback, useRef } from 'react';

export default function AIChatTab({ widgetSize, setItems, addNewItem }) {
  const [ollamaStatus, setOllamaStatus] = useState('checking'); // 'checking', 'offline', 'online'
  const [modelStatus, setModelStatus] = useState('checking'); // 'checking', 'not_pulled', 'pulling', 'ready'
  const [pullProgress, setPullProgress] = useState(0);

  const [messages, setMessages] = useState([{ role: 'assistant', content: 'Hello! I am your AI assistant. How can I help you today?' }]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    const userMsg = { role: 'user', content: inputText.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      
      const [chatRes, parseRes] = await Promise.all([
        window.api.llmChat(history).catch(err => { console.error(err); return null; }),
        window.api.llmParseCommand(userMsg.content).catch(err => { console.error(err); return null; })
      ]);

      let actionTaken = false;
      let actionMessage = '';

      if (parseRes?.intent === 'delete_meeting') {
        const now = Date.now();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        setItems(prev => {
          const updated = prev.map(item => {
            if (item.zoomLink && new Date(item.dueDate || item.date).getTime() - now < sevenDays) {
              return { ...item, zoomLink: null };
            }
            return item;
          });
          const manual = JSON.parse(localStorage.getItem('manualTasks') || '[]');
          const newManual = manual.map(m => {
            if (m.zoomLink && new Date(m.dueDate || m.date).getTime() - now < sevenDays) {
              return { ...m, zoomLink: null };
            }
            return m;
          });
          localStorage.setItem('manualTasks', JSON.stringify(newManual));
          return updated;
        });
        actionTaken = true;
        actionMessage = 'Zoom meetings for the next 7 days have been called off.';
      } else if (parseRes?.intent === 'add_task' && parseRes.taskTitle) {
        addNewItem({
          id: Math.random().toString(),
          type: 'deadline',
          title: parseRes.taskTitle,
          course: 'Personal',
          dueDate: parseRes.taskDueDate || new Date().toISOString()
        });
        actionTaken = true;
        actionMessage = `Added task: ${parseRes.taskTitle}`;
      }

      setMessages(prev => {
        const newMsgs = [...prev];
        if (chatRes?.message?.content) {
          newMsgs.push({ role: 'assistant', content: chatRes.message.content });
        } else if (!actionTaken) {
          newMsgs.push({ role: 'assistant', content: 'Sorry, I encountered an error.' });
        }
        if (actionTaken) {
          newMsgs.push({ role: 'assistant', content: `[System]: ${actionMessage}` });
        }
        return newMsgs;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsTyping(false);
    }
  };

  const checkModel = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if (res.ok) {
        const data = await res.json();
        const hasModel = data.models?.some(m => m.name === 'qwen2.5:3b' || m.name === 'qwen2.5:3b-instruct' || m.name.includes('qwen2.5:3b'));
        if (hasModel) {
          setModelStatus('ready');
        } else {
          setModelStatus('not_pulled');
        }
      }
    } catch (err) {
      console.error(err);
      setModelStatus('not_pulled');
    }
  }, []);

  const checkOllama = useCallback(async () => {
    setOllamaStatus('checking');
    try {
      const res = await fetch('http://127.0.0.1:11434/api/version');
      if (res.ok) {
        setOllamaStatus('online');
        checkModel();
      } else {
        setOllamaStatus('offline');
      }
    } catch {
      setOllamaStatus('offline');
    }
  }, [checkModel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkOllama();
  }, [checkOllama]);

  const handlePullModel = async () => {
    setModelStatus('pulling');
    setPullProgress(0);
    try {
      const response = await fetch('http://127.0.0.1:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'qwen2.5:3b' })
      });

      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.total && data.completed) {
              setPullProgress(Math.round((data.completed / data.total) * 100));
            }
          } catch {
            // ignore JSON parse errors for incomplete chunks
          }
        }
      }
      setModelStatus('ready');
    } catch (err) {
      console.error(err);
      setModelStatus('not_pulled');
    }
  };

  const isCompact = widgetSize === 'Small';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: isCompact ? '4px' : '12px', gap: '12px',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      backgroundColor: 'var(--md-sys-color-surface-container-high)',
      borderRadius: 'var(--md-sys-shape-corner-large)',
      overflow: 'hidden'
    }}>
      {ollamaStatus === 'checking' && (
        <div style={{ color: 'var(--md-sys-color-on-surface-variant)', font: 'var(--md-sys-typescale-body-medium)' }}>
          Checking AI connection...
        </div>
      )}
      
      {ollamaStatus === 'offline' && (
        <>
          <svg width={isCompact ? "32" : "48"} height={isCompact ? "32" : "48"} viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <div style={{ font: 'var(--md-sys-typescale-title-medium)' }}>
            Ollama Not Found
          </div>
          {!isCompact && (
            <div style={{ font: 'var(--md-sys-typescale-body-medium)', color: 'var(--md-sys-color-on-surface-variant)' }}>
              Please install and run Ollama locally on port 11434.
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: isCompact ? '4px' : '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button 
              className="md-pill"
              style={{ border: 'none', cursor: 'pointer', margin: 0 }}
              onClick={() => window.open('https://ollama.com/download', '_blank')}
            >
              Download
            </button>
            <button 
              className="md-pill"
              style={{ border: '1px solid var(--md-sys-color-primary)', background: 'transparent', color: 'var(--md-sys-color-primary)', cursor: 'pointer', margin: 0 }}
              onClick={checkOllama}
            >
              Retry
            </button>
          </div>
        </>
      )}

      {ollamaStatus === 'online' && modelStatus === 'not_pulled' && (
        <>
          <svg width={isCompact ? "32" : "48"} height={isCompact ? "32" : "48"} viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <div style={{ font: 'var(--md-sys-typescale-title-medium)' }}>
            Model Required
          </div>
          {!isCompact && (
            <div style={{ font: 'var(--md-sys-typescale-body-medium)', color: 'var(--md-sys-color-on-surface-variant)' }}>
              The qwen2.5:3b model is required for AI Chat.
            </div>
          )}
          <button 
            className="md-pill"
            style={{ border: 'none', cursor: 'pointer', marginTop: isCompact ? '4px' : '12px' }}
            onClick={handlePullModel}
          >
            Download Model
          </button>
        </>
      )}

      {ollamaStatus === 'online' && modelStatus === 'pulling' && (
        <>
          <div style={{ font: 'var(--md-sys-typescale-title-medium)' }}>
            Downloading Model...
          </div>
          <div style={{ 
            width: '80%', 
            height: '8px', 
            background: 'var(--md-sys-color-surface-container)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginTop: isCompact ? '8px' : '16px'
          }}>
            <div style={{ 
              width: `${pullProgress}%`, 
              height: '100%', 
              background: 'var(--md-sys-color-primary)',
              transition: 'width 0.2s'
            }}></div>
          </div>
          <div style={{ font: 'var(--md-sys-typescale-label-small)', marginTop: '8px', color: 'var(--md-sys-color-primary)' }}>
            {pullProgress}%
          </div>
        </>
      )}

      {ollamaStatus === 'online' && modelStatus === 'ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
          <div style={{ 
            flex: 1, 
            overflowY: 'auto', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '8px', 
            padding: '8px',
            scrollbarWidth: 'none'
          }}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor: msg.role === 'user' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-variant)',
                color: msg.role === 'user' ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface-variant)',
                padding: '8px 12px',
                borderRadius: '16px',
                maxWidth: '85%',
                textAlign: 'left',
                font: 'var(--md-sys-typescale-body-medium)',
                wordBreak: 'break-word',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
              }}>
                {msg.content}
              </div>
            ))}
            {isTyping && (
              <div style={{
                alignSelf: 'flex-start',
                backgroundColor: 'var(--md-sys-color-surface-variant)',
                color: 'var(--md-sys-color-on-surface-variant)',
                padding: '8px 12px',
                borderRadius: '16px',
                borderBottomLeftRadius: '4px',
                font: 'var(--md-sys-typescale-body-medium)'
              }}>
                Typing...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSendMessage} style={{ 
            display: 'flex', 
            gap: '8px', 
            padding: '8px',
            borderTop: '1px solid var(--md-sys-color-outline-variant)'
          }}>
            <input 
              type="text" 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Ask me anything..." 
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '20px',
                border: '1px solid var(--md-sys-color-outline)',
                backgroundColor: 'var(--md-sys-color-surface)',
                color: 'var(--md-sys-color-on-surface)',
                outline: 'none',
                font: 'var(--md-sys-typescale-body-medium)'
              }}
            />
            <button 
              type="submit" 
              disabled={isTyping || !inputText.trim()}
              style={{
                backgroundColor: 'var(--md-sys-color-primary)',
                color: 'var(--md-sys-color-on-primary)',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: (isTyping || !inputText.trim()) ? 'default' : 'pointer',
                opacity: (isTyping || !inputText.trim()) ? 0.5 : 1
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
