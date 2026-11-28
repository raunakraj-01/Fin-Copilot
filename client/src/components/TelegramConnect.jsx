import React, { useEffect, useState } from 'react';
import { api, json } from '../services/api.js';

export default function TelegramConnect({ workspaceId }) {
  const [status, setStatus] = useState(null);
  const [linkData, setLinkData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadStatus() {
    if (!workspaceId) return;
    try {
      const data = await api(`/workspaces/${workspaceId}/telegram/status`);
      setStatus(data);
    } catch (cause) {
      setError(cause.message || 'Could not check Telegram status');
    }
  }

  useEffect(() => {
    setLinkData(null);
    setError('');
    setNotice('');
    loadStatus();
  }, [workspaceId]);

  async function generateCode() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await json(`/workspaces/${workspaceId}/telegram/link-code`, 'POST', {});
      setLinkData(data);
      setNotice('One-time code generated. It expires in 10 minutes.');
    } catch (cause) {
      setError(cause.message || 'Could not generate link code');
    } finally {
      setBusy(false);
    }
  }

  async function unlinkTelegram() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await json(`/workspaces/${workspaceId}/telegram/unlink`, 'POST', {});
      setLinkData(null);
      setNotice('Telegram account unlinked.');
      await loadStatus();
    } catch (cause) {
      setError(cause.message || 'Could not unlink Telegram');
    } finally {
      setBusy(false);
    }
  }

  function copyCommand() {
    if (!linkData?.code) return;
    navigator.clipboard?.writeText(`/link ${linkData.code}`)
      .then(() => setNotice('Copied /link command to clipboard.'))
      .catch(() => setError('Copy failed. Select and copy the command manually.'));
  }

  return (
    <section className="card">
      <h2>Remote Telegram Fin-RAG</h2>
      <p>
        Link your personal Telegram DM to query your live invoices, payables, and 90-day cash outlook remotely.
        Only your authorized workspaces are reachable, and group chats are blocked.
      </p>

      {status && !status.botConfigured && (
        <p className="decision-muted">
          Telegram bot is not enabled on this server yet (set <code>TELEGRAM_BOT_TOKEN</code> on your backend host).
        </p>
      )}

      {status?.botConfigured && status.linked && (
        <div className="decision-notice" role="status">
          <strong>Telegram Connected</strong>
          <p>
            Linked to {status.link.telegramUsername ? `@${status.link.telegramUsername}` : status.link.firstName || 'Telegram'} ({status.link.maskedChatId}).{' '}
            Use <code>/workspaces</code> and <code>/switch</code> inside Telegram to switch businesses.
          </p>
          <div className="form-actions">
            <button type="button" className="secondary" disabled={busy} onClick={unlinkTelegram}>
              Disconnect Telegram
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={generateCode}>
              Relink / Generate new code
            </button>
          </div>
        </div>
      )}

      {status?.botConfigured && !status.linked && (
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={generateCode}>
            {busy ? 'Generating…' : 'Connect Telegram'}
          </button>
        </div>
      )}

      {linkData && (
        <div className="decision-notice" style={{ marginTop: 12 }}>
          {linkData.deepLink && (
            <p>
              <a className="kavach-btn-dark" href={linkData.deepLink} target="_blank" rel="noopener noreferrer">
                Open in Telegram &amp; Link Automatically
              </a>
            </p>
          )}
          <label>
            Or send this one-time command to {linkData.botUsername ? `@${linkData.botUsername}` : 'the bot'} in a private DM:
            <input readOnly value={`/link ${linkData.code}`} onFocus={e => e.target.select()} />
          </label>
          <div className="form-actions" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={copyCommand}>Copy command</button>
            <button type="button" className="secondary" onClick={loadStatus}>I have linked · Refresh status</button>
          </div>
        </div>
      )}

      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
