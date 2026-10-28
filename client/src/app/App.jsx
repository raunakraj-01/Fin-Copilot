import React, { useState } from 'react';
import SetupImport from '../pages/SetupImport.jsx';
import Outlook from '../pages/Outlook.jsx';
import RescuePlanner from '../pages/RescuePlanner.jsx';
import OrderAnalyzer from '../pages/OrderAnalyzer.jsx';

const pages = {
  setup: ['Setup & Import', 'Configure your cash workspace', SetupImport],
  outlook: ['Cash Outlook', 'Monitor the next 90 days', Outlook],
  rescue: ['Rescue Planner', 'Find practical ways through a shortfall', RescuePlanner],
  orders: ['New Order Analyzer', 'Test an opportunity before committing', OrderAnalyzer],
};

const icons = {
  setup: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="7" cy="6" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="10" cy="18" r="1"/></>,
  outlook: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  rescue: <><path d="M12 21a9 9 0 1 0-9-9"/><path d="M3 5v7h7"/><path d="M9 12h6M12 9v6"/></>,
  orders: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
};

export default function App() {
  const [page, setPage] = useState('setup');
  const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('cashflowWorkspaceId') || '');
  const selectWorkspace = id => { localStorage.setItem('cashflowWorkspaceId', id); setWorkspaceId(id); };
  const Page = pages[page][2];
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">₹</span><span>CashFlow<br/><small>Copilot</small></span></div>
      <nav aria-label="Main navigation">{Object.entries(pages).map(([key, [label]]) =>
        <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{icons[key]}</svg><span>{label}</span>
        </button>)}</nav>
      <div className="sidebar-note"><strong>Synthetic workspace</strong><span>Use demo financial records only.</span></div>
    </aside>
    <div className="app-area">
      <header className="topbar">
        <div><small>{pages[page][1]}</small><strong>{pages[page][0]}</strong></div>
        <span className={`workspace-state${workspaceId ? ' connected' : ''}`}><i />{workspaceId ? 'Workspace active' : 'No workspace'}</span>
      </header>
      <div className="content"><Page workspaceId={workspaceId} onWorkspaceCreated={selectWorkspace} /></div>
    </div>
  </div>;
}
