import { t, useLanguage, setLanguage } from '../i18n/index.js';
import React, { useEffect, useState } from 'react';
import AuthGate from '../components/AuthGate.jsx';
import { api } from '../services/api.js';
import SetupImport from '../pages/SetupImport.jsx';
import Outlook from '../pages/Outlook.jsx';
import RescuePlanner from '../pages/RescuePlanner.jsx';
import OrderAnalyzer from '../pages/OrderAnalyzer.jsx';
import CashShockLab from '../pages/CashShockLab.jsx';
import Copilot from '../pages/Copilot.jsx';
import Operations from '../pages/Operations.jsx';
import LandingPage from '../components/LandingPage.jsx';

const pages = {
  setup: ['Setup & Import', 'Configure your cash workspace', SetupImport],
  outlook: ['Cash Outlook', 'Monitor the next 90 days', Outlook],
  shock: ['Cash Shock Lab', 'Test delays and protect your cash reserve', CashShockLab],
  rescue: ['Rescue Planner', 'Find practical ways through a shortfall', RescuePlanner],
  orders: ['New Order Analyzer', 'Test an opportunity before committing', OrderAnalyzer],
  copilot: ['Cash Copilot', 'Ask about your cash records', Copilot],
  operations: ['Operations', 'Review sync and collection drafts', Operations],
};

const icons = {
  setup: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="7" cy="6" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="10" cy="18" r="1"/></>,
  outlook: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  shock: <><path d="M4 19V5M4 19h16"/><path d="m6 10 4-3 4 9 5-4"/></>,
  rescue: <><path d="M12 21a9 9 0 1 0-9-9"/><path d="M3 5v7h7"/><path d="M9 12h6M12 9v6"/></>,
  orders: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  copilot: <><path d="M4 5h16v12H8l-4 4z"/><path d="M8 10h8M8 13h5"/></>,
  operations: <><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="16" cy="12" r="1"/></>,
};

function BusinessApp({ user, onLogout }) {
  const language = useLanguage();
  const [showLanding, setShowLanding] = useState(true);
  const [page, setPage] = useState('setup');
  const [operationsItemId, setOperationsItemId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cashflowSidebarCollapsed') === '1');
  const [workspaceId, setWorkspaceId] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [accessError, setAccessError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => api('/workspaces').then(data => { if (!active) return; setProfiles(data.workspaces);
      setWorkspaceId(current => { const desired = current || localStorage.getItem(`cashflowWorkspace:${user.id}`); return data.workspaces.some(w => w.id === desired) ? desired : ''; });
    }).catch(e => { if (active) setAccessError(e.message); });
    refresh(); window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [user.id]);
  const selectWorkspace = value => {
    if (!value) { localStorage.removeItem(`cashflowWorkspace:${user.id}`); setWorkspaceId(''); return; }
    const profile = typeof value === 'string' ? profiles.find(item => item.id === value) : value;
    if (!profile) return;
    const next = [...profiles.filter(item => item.id !== profile.id), profile];
    localStorage.setItem(`cashflowWorkspace:${user.id}`, profile.id);
    setProfiles(next); setWorkspaceId(profile.id);
  };
  const toggleSidebar = () => setSidebarCollapsed(current => {
    const next = !current;
    localStorage.setItem('cashflowSidebarCollapsed', next ? '1' : '0');
    return next;
  });
  const Page = pages[page][2];
  return <><div className={`shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-head"><div className="brand"><span className="brand-mark" aria-hidden="true">₹</span><span>{t("CashFlow")}<br/><small>{t("Copilot")}</small></span></div></div>
      <nav aria-label={t("Main navigation")}>{Object.entries(pages).map(([key, [label]]) =>
        <button key={key} type="button" aria-label={t(label)} title={t(label)} aria-current={page === key ? 'page' : undefined} onClick={() => setPage(key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{t(icons[key])}</svg><span>{t(label)}</span>
        </button>)}</nav>
      <div className="sidebar-note"><strong>{t("Synthetic workspace")}</strong><span>{t("Use demo financial records only.")}</span></div>
    </aside>
    <div className="app-area">
      <header className="topbar">
        <div className="topbar-leading">
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg>
          </button>
          <div className="topbar-wordmark" aria-label={`${t('CashFlow')} ${t('Copilot')}`}>
            <span className="topbar-brand-shine">{t("CashFlow")} {t("Copilot")}</span>
          </div>
        </div>
        <div className="topbar-actions"><span>{user.name}</span><button type="button" className="secondary" onClick={onLogout}>Sign out</button><label className="language-picker">Business<select aria-label="Supplier profile" value={workspaceId} onChange={event => selectWorkspace(event.target.value)}><option value="">Select business</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.role}</option>)}</select></label>
          <label className="language-picker">{t('Language')}<select aria-label={t('Language')} value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option></select></label></div>
      </header>
      <main className="content">{accessError && <p role="alert">{accessError}</p>}<Page key={`${page}:${workspaceId}`} workspaceId={workspaceId} businessRole={profiles.find(p => p.id === workspaceId)?.role} onWorkspaceCreated={selectWorkspace}
        operationsItemId={operationsItemId} onOpenOffer={action => { setOperationsItemId(action); setPage('operations'); }} /></main>
    </div>
  </div>{showLanding && <LandingPage onStart={() => setShowLanding(false)} />}</>;
}
export default function App() { return <AuthGate>{(user, logout) => <BusinessApp key={user.id} user={user} onLogout={logout} />}</AuthGate>; }
