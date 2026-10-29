import React, { useState } from 'react';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');
const sessionId = crypto.randomUUID();

export default function Copilot({ workspaceId }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  async function send(event) {
    event.preventDefault();
    if (!workspaceId || !message.trim() || busy) return;
    const question = message.trim();
    setMessage(''); setBusy(true);
    try {
      const response = await fetch(`${base}/workspaces/${workspaceId}/copilot/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, sessionId }),
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error?.message || 'Chat failed'); }
      const text = await response.text();
      const answer = text.split('\n\n').find(part => part.startsWith('event: answer'));
      if (!answer) throw new Error('Incomplete response');
      setHistory(current => [...current, { question, ...JSON.parse(answer.slice(answer.indexOf('data: ') + 6)) }]);
    } catch (error) { setHistory(current => [...current, { question, reply: error.message, facts: [] }]); }
    finally { setBusy(false); }
  }
  return <section className="copilot">
    <h1>Cash Copilot</h1><p>Ask about your cash runway and overdue collections. Answers use workspace records.</p>
    {!workspaceId && <p>Create or select a workspace in Setup & Import first.</p>}
    <div className="card copilot-history" aria-live="polite">{history.length ? history.map((entry, index) => <article key={index}>
      <strong>You: {entry.question}</strong><p>{entry.reply}</p>
      {entry.facts?.length > 0 && <div className="copilot-facts">{entry.facts.map(fact => <span key={fact.label}>{fact.label}: <b>{fact.value}</b></span>)}</div>}
    </article>) : <p>Try “When will I run out of cash?” or “Which customers are overdue?”</p>}</div>
    <form onSubmit={send} className="copilot-form"><label htmlFor="copilot-message">Your question</label><input id="copilot-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} disabled={!workspaceId || busy} /><button disabled={!workspaceId || busy || !message.trim()}>{busy ? 'Checking…' : 'Ask'}</button></form>
  </section>;
}
