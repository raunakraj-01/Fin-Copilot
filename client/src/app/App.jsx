import React, { useState } from 'react';
import SetupImport from '../pages/SetupImport.jsx';
import Outlook from '../pages/Outlook.jsx';
import RescuePlanner from '../pages/RescuePlanner.jsx';
import OrderAnalyzer from '../pages/OrderAnalyzer.jsx';

const pages = {
  setup: ['Setup & Import', SetupImport],
  outlook: ['Cash Outlook', Outlook],
  rescue: ['Rescue Planner', RescuePlanner],
  orders: ['New Order Analyzer', OrderAnalyzer],
};

export default function App() {
  const [page, setPage] = useState('setup');
  const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('cashflowWorkspaceId') || '');
  const selectWorkspace = id => { localStorage.setItem('cashflowWorkspaceId', id); setWorkspaceId(id); };
  const Page = pages[page][1];
  return <div className="shell">
    <header><strong>CashFlow Copilot</strong><span>Synthetic demo · financial scenarios</span></header>
    <nav aria-label="Main navigation">{Object.entries(pages).map(([key, [label]]) =>
      <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>{label}</button>)}</nav>
    <main><Page workspaceId={workspaceId} onWorkspaceCreated={selectWorkspace} /></main>
  </div>;
}
