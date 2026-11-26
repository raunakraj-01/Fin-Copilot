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
import ActionCenter from '../pages/ActionCenter.jsx';
import CapstoneDefenseModal from '../components/CapstoneDefenseModal.jsx';
import PillNav from '../components/PillNav/PillNav.jsx';
import logo from './logo.svg';

const pages = {
  setup: ['Setup & Import', 'Configure your cash workspace', SetupImport, '/setup-import'],
  outlook: ['Cash Outlook', 'Monitor the next 90 days', Outlook, '/cash-outlook'],
  shock: ['Cash Shock Lab', 'Test delays and protect your cash reserve', CashShockLab, '/cash-shock-lab'],
  rescue: ['Rescue Planner', 'Find practical ways through a shortfall', RescuePlanner, '/rescue-planner'],
  orders: ['New Order Analyzer', 'Test an opportunity before committing', OrderAnalyzer, '/new-order-analyzer'],
  copilot: ['Cash Copilot', 'Ask about your cash records', Copilot, '/cash-copilot'],
  actions: ['Action Center', 'See what needs attention next', ActionCenter, '/action-center'],
  operations: ['Operations', 'Review sync and collection drafts', Operations, '/operations'],
};

const navSections = [
  {
    title: 'Monitor & Operations',
    keys: ['outlook', 'actions', 'operations'],
  },
  {
    title: 'Planning & Rescue',
    keys: ['rescue', 'shock', 'orders'],
  },
  {
    title: 'Intelligence & Setup',
    keys: ['copilot', 'setup'],
  },
];
const pageFromPath = pathname => Object.entries(pages).find(([, page]) => page[3] === pathname)?.[0];

const icons = {
  setup: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="7" cy="6" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="10" cy="18" r="1"/></>,
  outlook: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  shock: <><path d="M4 19V5M4 19h16"/><path d="m6 10 4-3 4 9 5-4"/></>,
  rescue: <><path d="M12 21a9 9 0 1 0-9-9"/><path d="M3 5v7h7"/><path d="M9 12h6M12 9v6"/></>,
  orders: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  copilot: <><path d="M4 5h16v12H8l-4 4z"/><path d="M8 10h8M8 13h5"/></>,
  operations: <><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="16" cy="12" r="1"/></>,
  actions: <><path d="M5 12.5 9.2 17 19 7"/><path d="M4 4h16v16H4z"/></>,
};

function BusinessApp({ user, onLogout }) {
  const language = useLanguage();
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname) || 'outlook');
  const [operationsItemId, setOperationsItemId] = useState(null);
  const [capturedOrderDraft, setCapturedOrderDraft] = useState(null);
  const [capturedPromiseDraft, setCapturedPromiseDraft] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem('cashflowSidebarCollapsed') === '1' : false));
  const [theme, setTheme] = useState(() => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem('cashflowTheme') || 'light' : 'light'));
  const [showDefenseModal, setShowDefenseModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
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
  return <><div className="kavach-app-wrapper" onClick={e => {
    if (!e.target.closest('.kavach-user-menu-wrap') && showUserMenu) setShowUserMenu(false);
    if (!e.target.closest('.kavach-bell-wrap') && showNotifications) setShowNotifications(false);
  }}>
    <div className="kavach-header-container">
      <header className="kavach-floating-nav" role="banner">
        <div className="kavach-nav-brand">
          <div className="kavach-brand-titles">
            <span className="kavach-brand-name">Kavach</span>
            <span className="kavach-brand-sub">Fin-Copilot</span>
          </div>
        </div>

        <PillNav
          logo={logo}
          logoAlt="Kavach"
          logoHref={pages.outlook[3]}
          onLogoClick={event => followLink(event, 'outlook')}
          items={[
            { label: t("Dashboard"), href: pages.outlook[3], ariaLabel: t("Cash Outlook"), key: 'outlook' },
            { label: t("Buyer search"), href: pages.orders[3], ariaLabel: t("New Order Analyzer"), key: 'orders' },
            { label: t("Rescue Planner"), href: pages.rescue[3], ariaLabel: t("Rescue Planner"), key: 'rescue' },
            { label: t("Shock Lab"), href: pages.shock[3], ariaLabel: t("Cash Shock Lab"), key: 'shock' },
            { label: t("RAG Assistant"), href: pages.copilot[3], ariaLabel: t("Cash Copilot"), key: 'copilot' },
            { label: t("Operations"), href: pages.operations[3], ariaLabel: t("Operations"), key: 'operations' },
            { label: t("Setup"), href: pages.setup[3], ariaLabel: t("Setup & Import"), key: 'setup' }
          ]}
          activeHref={pages[page][3]}
          onItemClick={(item, index, event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (item.key) navigate(item.key);
            else if (item.href) {
              const k = pageFromPath(item.href);
              if (k) navigate(k);
            }
          }}
          itemStyle="plain"
          hoverEffect="glide"
          indicator="pill"
          size="lg"
          surface="none"
          theme={theme}
          highlightColor={theme === 'dark' ? '#2ebd85' : '#16332d'}
          highlightTextColor={theme === 'dark' ? '#0d1614' : '#ffffff'}
          ariaLabel={t("Main navigation")}
        />

        <div className="kavach-nav-actions">
          {/* Interactive Notification Bell */}
          <div className="kavach-bell-wrap">
            <button
              type="button"
              className={`kavach-icon-btn ${showNotifications ? 'active' : ''}`}
              onClick={() => setShowNotifications(v => !v)}
              aria-label="Risk alerts"
              title="2 Risk Alerts Active"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="bell-badge-dot"></span>
            </button>
            {showNotifications && (
              <div className="kavach-popover-menu kavach-notifications-menu" role="dialog" aria-label="Risk notifications">
                <div className="popover-header">
                  <strong>Risk Alerts</strong>
                  <span className="badge-count">2 Active</span>
                </div>
                <div className="popover-item" onClick={() => { navigate('rescue'); setShowNotifications(false); }}>
                  <span className="alert-dot danger"></span>
                  <div>
                    <strong>Delayed Receivables</strong>
                    <p>₹2,14,700 flagged past standard cycle</p>
                  </div>
                </div>
                <div className="popover-item" onClick={() => { navigate('outlook'); setShowNotifications(false); }}>
                  <span className="alert-dot warning"></span>
                  <div>
                    <strong>Section 43B(h) Payables</strong>
                    <p>Statutory 45-day threshold monitored</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <label className="kavach-select-label" title={profiles.find(profile => profile.id === workspaceId)?.name || 'Switch supplier business profile'}>
            <span className="sr-only">Business</span>
            <select aria-label="Supplier profile" title={profiles.find(profile => profile.id === workspaceId)?.name || 'Switch supplier business profile'} value={workspaceId} onChange={event => selectWorkspace(event.target.value)} className="kavach-pill-select kavach-business-select">
              <option value="">Select business</option>
              {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>

          <label className="kavach-select-label" title="Switch language">
            <span className="sr-only">{t('Language')}</span>
            <select aria-label={t('Language')} value={language} onChange={event => setLanguage(event.target.value)} className="kavach-pill-select kavach-lang-select">
              <option value="en">EN</option>
              <option value="hi">HI</option>
              <option value="kn">KN</option>
            </select>
          </label>

          <button type="button" className="kavach-icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Interactive User Avatar Menu */}
          <div className="kavach-user-menu-wrap">
            <div
              className="kavach-avatar-badge"
              title={`Account options for ${user.name}`}
              onClick={() => setShowUserMenu(v => !v)}
              role="button"
              tabIndex={0}
            >
              {user.name ? user.name[0].toUpperCase() : 'K'}
            </div>
            {showUserMenu && (
              <div className="kavach-popover-menu kavach-user-menu" role="dialog" aria-label="User account">
                <div className="user-menu-profile">
                  <div className="menu-avatar">{user.name ? user.name[0].toUpperCase() : 'K'}</div>
                  <div>
                    <strong>{user.name}</strong>
                    <p>{profiles.find(p => p.id === workspaceId)?.name || 'Packaging Supplier'}</p>
                  </div>
                </div>
                <div className="user-menu-divider" />
                <button type="button" className="menu-item-btn" onClick={() => { setShowDefenseModal(true); setShowUserMenu(false); }}>
                  🏛️ Institutional Audit & Verification Pack
                </button>
                <button type="button" className="menu-item-btn" onClick={() => { toggleTheme(); setShowUserMenu(false); }}>
                  {theme === 'dark' ? '☀️ Switch to Light Mode' : '🌙 Switch to Dark Mode'}
                </button>
                <div className="user-menu-divider" />
                <button type="button" className="menu-item-btn menu-signout" onClick={onLogout}>
                  🚪 Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </div>

    <main className="content">
      {accessError && <p role="alert">{accessError}</p>}
      <Page
        key={`${page}:${workspaceId}`}
        workspaceId={workspaceId}
        workspaceName={profiles.find(p => p.id === workspaceId)?.name}
        businessRole={profiles.find(p => p.id === workspaceId)?.role}
        user={user}
        onWorkspaceCreated={selectWorkspace}
        onNavigate={navigate}
        orderDraft={capturedOrderDraft}
        onOrderDraftConsumed={() => setCapturedOrderDraft(null)}
        promiseDraft={capturedPromiseDraft}
        onPromiseDraftConsumed={() => setCapturedPromiseDraft(null)}
        onCaptureApproved={action => {
          if (action?.type === 'order_analysis_draft') { setCapturedOrderDraft(action); navigate('orders'); }
          if (action?.type === 'payment_promise_draft') { setCapturedPromiseDraft(action); navigate('outlook'); }
        }}
        operationsItemId={operationsItemId}
        onOpenOffer={action => { setOperationsItemId(action); navigate('operations'); }}
      />
    </main>

    <nav className="mobile-bottom-nav no-print" aria-label="Mobile Navigation">
      {['setup', 'outlook', 'shock', 'rescue', 'orders'].map(key => (
        <a key={key} href={pages[key][3]} aria-label={`Mobile ${pages[key][0]}`} aria-current={page === key ? 'page' : undefined} onClick={event => followLink(event, key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{icons[key]}</svg>
          <span>{t(pages[key][0].replace('Cash ', '').replace('New ', '').replace(' & Import', ''))}</span>
        </a>
      ))}
    </nav>
    {showDefenseModal && <CapstoneDefenseModal onClose={() => setShowDefenseModal(false)} />}
  </div></>;
}
export default function App() { return <AuthGate>{(user, logout) => <BusinessApp key={user.id} user={user} onLogout={logout} />}</AuthGate>; }
