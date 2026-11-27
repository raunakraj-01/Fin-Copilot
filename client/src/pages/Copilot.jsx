import { readJsonSafe, sessionFetch } from '../services/session.js';
import React, { useEffect, useRef, useState } from 'react';
import AsyncActionButton from '../components/AsyncActionButton.jsx';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

export default function Copilot({ workspaceId }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const historyRef = useRef(null);
  function scrollHistory(latest) {
    const panel = historyRef.current;
    if (panel) panel.scrollTop = latest ? panel.scrollHeight : 0;
  }
  useEffect(() => { setHistory([]); setSessionId(crypto.randomUUID()); }, [workspaceId]);
  useEffect(() => { scrollHistory(true); }, [history.length]);
  async function send(event) {
    event.preventDefault();
    if (!workspaceId || !message.trim() || busy) return;
    const question = message.trim();
    setMessage(''); setBusy(true);
    try {
      const response = await sessionFetch(`${base}/workspaces/${workspaceId}/copilot/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, sessionId }),
      });
      if (!response.ok) { const error = await readJsonSafe(response); throw new Error(error?.error?.message || 'Chat failed'); }
      const text = await response.text();
      const answer = text.split('\n\n').find(part => part.startsWith('event: answer'));
      if (!answer) throw new Error('Incomplete response');
      setHistory(current => [...current, { question, ...JSON.parse(answer.slice(answer.indexOf('data: ') + 6)) }]);
    } catch (error) { setHistory(current => [...current, { question, reply: error.message, facts: [] }]); }
    finally { setBusy(false); }
  }
  return <section className="copilot">
    <div>
      <h1>Cash Copilot</h1>
      <p>Ask about your cash runway, debtor aging, Section 43B(h) payables, and statutory GST milestones. Answers are strictly grounded in your workspace records.</p>
    </div>
    {!workspaceId && <p>Create or select a workspace in Setup & Import first.</p>}
    {history.length > 0 && <div className="copilot-history-controls" aria-label="Chat navigation">
      <button type="button" className="secondary" onClick={() => scrollHistory(false)}>↑ Oldest messages</button>
      <button type="button" className="secondary" onClick={() => scrollHistory(true)}>↓ Latest message</button>
    </div>}
    <div ref={historyRef} className="card copilot-history" role="region" aria-label="Chat history" tabIndex={0} aria-live="polite">{history.length ? history.map((entry, index) => <article key={index}>
      <strong>You: {entry.question}</strong>
      <p style={{ margin: '8px 0', fontSize: '14px', lineHeight: '1.6' }}>{entry.reply}</p>
      
      {entry.mode && (
        <span className="rag-mode-badge">
          {entry.mode === 'gemini-rag' ? '✨ Gemini-2.0 Fin-RAG · Grounded' : '⚡ Deterministic Fin-RAG (Zero Hallucination)'}
        </span>
      )}
      
      {entry.modelWarning && <p role="status">{entry.modelWarning}</p>}
      
      {entry.facts?.length > 0 && (
        <div className="copilot-facts" style={{ marginTop: 8 }}>
          {entry.facts.map(fact => <span key={fact.label}>{fact.label}: <b>{fact.value}</b></span>)}
        </div>
      )}

      {/* RAG Retrieved Sources & Evidence */}
      {entry.sources?.length > 0 && (
        <details className="rag-sources-wrap" style={{ marginTop: 10 }}>
          <summary className="rag-sources-header" style={{ cursor: 'pointer' }}>
            Grounded in {entry.sources.length} retrieved financial record{entry.sources.length === 1 ? '' : 's'}
          </summary>
          <div className="rag-sources-grid" style={{ marginTop: 8 }}>
            {entry.sources.map(src => (
              <div key={src.kuId} className="rag-source-row">
                <strong>{src.title}</strong>
                <div style={{ color: 'var(--muted)', margin: '2px 0' }}>
                  {src.amount ? `${src.amount} · ` : ''}{src.date || 'Scheduled'}
                </div>
                <small style={{ display: 'block', color: 'var(--text)' }}>{src.summary}</small>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>) : <p>Try asking “When will I run out of cash?” or “Who owes me money?”</p>}</div>
    <div className="copilot-prompt-chips" aria-label="Suggested questions">
      <span>Suggested questions:</span>
      {[
        'When will I run out of cash?',
        'Which customers are overdue?',
        'What are my Section 43B(h) supplier risks?',
        'What are my upcoming GST and advance tax dates?',
        'Draft a reminder for overdue customer',
      ].map((q, idx) => (
        <button
          key={idx}
          type="button"
          className="copilot-chip-btn"
          disabled={!workspaceId || busy}
          onClick={() => setMessage(q)}
        >
          {q}
        </button>
      ))}
    </div>
    <form onSubmit={send} className="copilot-form"><label htmlFor="copilot-message">Your question</label><input id="copilot-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} disabled={!workspaceId || busy} /><AsyncActionButton type="submit" disabled={!workspaceId || busy || !message.trim()} busy={busy} idleLabel="Ask" doneLabel="Answer ready" steps={["Indexing records…", "Retrieving evidence…", "Synthesizing answer…"]} /></form>
  </section>;
}
