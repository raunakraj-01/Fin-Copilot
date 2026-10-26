import { useState } from 'react';
import SetupImport from '../pages/SetupImport.jsx';
import Outlook from '../pages/Outlook.jsx';

const pages = {
  setup: ['Setup & Import', SetupImport],
  outlook: ['Cash Outlook', Outlook],
  rescue: ['Rescue Planner', () => <p>Rescue Planner is being built.</p>],
  orders: ['New Order Analyzer', () => <p>New Order Analyzer is being built.</p>],
};

export default function App() {
  const [page, setPage] = useState('setup');
  const Page = pages[page][1];
  return <div className="shell">
    <header><strong>CashFlow Copilot</strong><span>Synthetic demo · financial scenarios</span></header>
    <nav aria-label="Main navigation">{Object.entries(pages).map(([key, [label]]) =>
      <button key={key} type="button" aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>{label}</button>)}</nav>
    <main><Page /></main>
  </div>;
}
