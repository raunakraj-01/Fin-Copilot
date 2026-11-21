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
import CapstoneDefenseModal from '../components/CapstoneDefenseModal.jsx';

const pages = {
  setup: ['Setup & Import', 'Configure your cash workspace', SetupImport, '/setup-import'],
  outlook: ['Cash Outlook', 'Monitor the next 90 days', Outlook, '/cash-outlook'],
  shock: ['Cash Shock Lab', 'Test delays and protect your cash reserve', CashShockLab, '/cash-shock-lab'],
  rescue: ['Rescue Planner', 'Find practical ways through a shortfall', RescuePlanner, '/rescue-planner'],
  orders: ['New Order Analyzer', 'Test an opportunity before committing', OrderAnalyzer, '/new-order-analyzer'],
  copilot: ['Cash Copilot', 'Ask about your cash records', Copilot, '/cash-copilot'],
  operations: ['Operations', 'Review sync and collection drafts', Operations, '/operations'],
};
const pageFromPath = pathname => Object.entries(pages).find(([, page]) => page[3] === pathname)?.[0];

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
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname) || 'outlook');
  const [operationsItemId, setOperationsItemId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem('cashflowSidebarCollapsed') === '1' : false));
  const [theme, setTheme] = useState(() => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem('cashflowTheme') || 'light' : 'light'));
  const [showDefenseModal, setShowDefenseModal] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(current => {
      const next = current === 'dark' ? 'light' : 'dark';
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem('cashflowTheme', next);
      }
      return next;
    });
  };
  useEffect(() => {
    let active = true;
    const refresh = () => api('/workspaces').then(data => { if (!active) return; setProfiles(data.workspaces);
      setWorkspaceId(current => {
        const desired = current || localStorage.getItem(`cashflowWorkspace:${user.id}`);
        const selected = data.workspaces.some(w => w.id === desired) ? desired : data.workspaces[0]?.id || '';
        if (selected) localStorage.setItem(`cashflowWorkspace:${user.id}`, selected);
        else localStorage.removeItem(`cashflowWorkspace:${user.id}`);
        return selected;
      });
    }).catch(e => { if (active) setAccessError(e.message); });
    refresh(); window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [user.id]);
  useEffect(() => {
    if (window.location.pathname === '/' || !pageFromPath(window.location.pathname))
      window.history.replaceState(null, '', pages.outlook[3]);
    const followBrowserHistory = () => {
      const next = pageFromPath(window.location.pathname);
      setPage(next || 'outlook');
    };
    followBrowserHistory();
    window.addEventListener('popstate', followBrowserHistory);
    return () => window.removeEventListener('popstate', followBrowserHistory);
  }, []);
  useEffect(() => { document.title = `${pages[page][0]} - CashFlow Copilot`; }, [page]);
  const navigate = (nextPage, replace = false) => {
    const path = pages[nextPage][3];
    window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    setPage(nextPage);
  };
  const followLink = (event, nextPage) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(nextPage);
  };
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
      <nav aria-label={t("Main navigation")}>{Object.entries(pages).map(([key, [label, , , path]]) =>
        <a key={key} href={path} aria-label={t(label)} title={t(label)} aria-current={page === key ? 'page' : undefined} onClick={event => followLink(event, key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{t(icons[key])}</svg><span>{t(label)}</span>
        </a>)}</nav>
    </aside>
    <div className="app-area">
      <header className="topbar">
        <div className="topbar-leading">
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg>
          </button>
        </div>
        <div className="topbar-actions">
          <button type="button" className="defense-mode-btn" onClick={() => setShowDefenseModal(true)} title="8th Semester Capstone Project Defense Dossier">
            🎓 Capstone Defense
          </button>
          <label className="language-picker">Business<select aria-label="Supplier profile" value={workspaceId} onChange={event => selectWorkspace(event.target.value)}><option value="">Select business</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.role}</option>)}</select></label>
          <label className="language-picker">{t('Language')}<select aria-label={t('Language')} value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option></select></label>
          <button type="button" className="secondary theme-toggle-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <span>{user.name}</span>
          <button type="button" className="secondary" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main className="content">{accessError && <p role="alert">{accessError}</p>}<Page key={`${page}:${workspaceId}`} workspaceId={workspaceId} businessRole={profiles.find(p => p.id === workspaceId)?.role} onWorkspaceCreated={selectWorkspace} onNavigate={navigate}
        operationsItemId={operationsItemId} onOpenOffer={action => { setOperationsItemId(action); navigate('operations'); }} /></main>
      <nav className="mobile-bottom-nav no-print" aria-label="Mobile Navigation">
        {['setup', 'outlook', 'shock', 'rescue', 'orders'].map(key => (
          <a key={key} href={pages[key][3]} aria-label={`Mobile ${pages[key][0]}`} aria-current={page === key ? 'page' : undefined} onClick={event => followLink(event, key)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{icons[key]}</svg>
            <span>{t(pages[key][0].replace('Cash ', '').replace('New ', '').replace(' & Import', ''))}</span>
          </a>
        ))}
      </nav>
      {showDefenseModal && <CapstoneDefenseModal onClose={() => setShowDefenseModal(false)} />}
    </div>
  </div></>;
}
export default function App() { return <AuthGate>{(user, logout) => <BusinessApp key={user.id} user={user} onLogout={logout} />}</AuthGate>; }
