import React, { useState, useEffect } from 'react';
import { sessionFetch } from '../services/session.js';
import { t } from '../i18n/index.js';

const base = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');

async function api(path, options = {}) {
  const response = await sessionFetch(`${base}${path}`, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Request failed');
  return data;
}

export default function AutomationHub({ workspaceId, token }) {
  const [morningBrief, setMorningBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [xmlPreview, setXmlPreview] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleResult, setCycleResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    loadMorningBrief();
  }, [workspaceId]);

  async function loadMorningBrief() {
    setBriefLoading(true);
    try {
      const data = await api(`/workspaces/${workspaceId}/automation/morning-brief`);
      setMorningBrief(data);
    } catch (err) {
      console.warn('Could not load morning brief:', err.message);
    } finally {
      setBriefLoading(false);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const voucherCount = (content.match(/<VOUCHER\b/gi) || []).length;
        const companyMatch = content.match(/<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/i);
        setXmlPreview({
          fileName: file.name,
          company: companyMatch ? companyMatch[1] : 'Tally Company',
          voucherCount,
          rawXml: content,
        });
      }
    };
    reader.readAsText(file);
  }

  async function handleXmlSync() {
    if (!xmlPreview?.rawXml) return;
    setSyncLoading(true);
    setError('');
    setSyncStatus(null);
    try {
      const data = await api(`/workspaces/${workspaceId}/automation/tally-xml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: xmlPreview.rawXml }),
      });
      setSyncStatus(data);
      setSelectedFile(null);
      setXmlPreview(null);
      loadMorningBrief();
    } catch (err) {
      setError(err.message || 'Tally XML sync failed');
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleRunCycle() {
    setCycleLoading(true);
    setError('');
    setCycleResult(null);
    try {
      const data = await api(`/workspaces/${workspaceId}/automation/run-cycle`, {
        method: 'POST',
      });
      setCycleResult(data);
    } catch (err) {
      setError(err.message || 'Automation cycle failed');
    } finally {
      setCycleLoading(false);
    }
  }

  function copyBriefText() {
    if (!morningBrief?.whatsappText) return;
    navigator.clipboard.writeText(morningBrief.whatsappText);
    setBriefCopied(true);
    setTimeout(() => setBriefCopied(false), 2000);
  }

  return (
    <section className="automation-hub-section card">
      <div className="automation-header">
        <div>
          <span className="kavach-kicker">
            <span className="kavach-kicker-dot" />
            AUTONOMOUS CASH INFRASTRUCTURE
          </span>
          <h2 className="automation-title">Kavach Automation Hub</h2>
          <p className="automation-desc">
            Continuous background accounting sync, daily 8:30 AM WhatsApp executive briefs, and Section 43B(h) escalation drips.
          </p>
        </div>
        <div className="automation-badge-wrap">
          <span className="live-workspace-pill">
            <span className="pulse-dot" />
            3 Automations Active
          </span>
        </div>
      </div>

      {error && <div className="notice text-danger" role="alert">{error}</div>}

      <div className="automation-cards-grid">
        {/* Card 1: TallyPrime XML Ingestion */}
        <div className="automation-card">
          <div className="automation-card-head">
            <div className="automation-icon-box">📦</div>
            <div>
              <h3>TallyPrime Automated XML Sync</h3>
              <p>Two-way Tally.ERP 9 / TallyPrime XML voucher ingestion engine</p>
            </div>
          </div>

          <div className="automation-dropzone">
            <input
              type="file"
              accept=".xml"
              id="tally-xml-input"
              className="sr-only"
              onChange={handleFileSelect}
            />
            <label htmlFor="tally-xml-input" className="dropzone-label">
              <span className="dropzone-icon">📥</span>
              <strong>{selectedFile ? selectedFile.name : 'Choose or drop Tally XML export'}</strong>
              <small>Accepts native TallyPrime & Tally.ERP 9 export documents</small>
            </label>
          </div>

          {xmlPreview && (
            <div className="xml-preview-box">
              <div className="xml-preview-stat">
                <span>Company:</span>
                <strong>{xmlPreview.company}</strong>
              </div>
              <div className="xml-preview-stat">
                <span>Vouchers Detected:</span>
                <strong>{xmlPreview.voucherCount} Vouchers</strong>
              </div>
              <button
                type="button"
                className="kavach-btn-dark"
                onClick={handleXmlSync}
                disabled={syncLoading}
                style={{ width: '100%', marginTop: 8 }}
              >
                {syncLoading ? 'Ingesting Vouchers…' : `⚡ Ingest ${xmlPreview.voucherCount} Vouchers to Cash Outlook`}
              </button>
            </div>
          )}

          {syncStatus && (
            <div className="sync-success-box">
              ✅ Successfully ingested <strong>{syncStatus.appliedCount}</strong> vouchers from <em>{syncStatus.company}</em> into live forecast.
            </div>
          )}

          <div className="tally-instructions">
            <small><strong>Tip:</strong> You can configure TallyPrime to auto-export daily XML into a watched folder, or use our background daemon token for scheduled hands-free sync.</small>
          </div>
        </div>

        {/* Card 2: Daily Morning Cash Brief */}
        <div className="automation-card">
          <div className="automation-card-head">
            <div className="automation-icon-box">🌅</div>
            <div>
              <h3>Daily 8:30 AM Morning Cash Brief</h3>
              <p>Executive WhatsApp & SMS briefing for founder & finance team</p>
            </div>
          </div>

          {briefLoading ? (
            <p>Generating today's executive brief…</p>
          ) : morningBrief ? (
            <div className="whatsapp-preview-card">
              <div className="whatsapp-bubble">
                <pre>{morningBrief.whatsappText}</pre>
              </div>
              <div className="brief-actions">
                <a
                  href={morningBrief.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kavach-btn-dark"
                  style={{ textDecoration: 'none' }}
                >
                  📱 Open in WhatsApp
                </a>
                <button
                  type="button"
                  className="secondary"
                  onClick={copyBriefText}
                >
                  {briefCopied ? '✓ Copied!' : '📋 Copy Brief Text'}
                </button>
              </div>
            </div>
          ) : (
            <p>No brief available for today.</p>
          )}

          <div className="brief-schedule-footer">
            <span className="status-pill text-success">● Scheduled Daily</span>
            <small>Dispatches at 08:30 AM IST via WhatsApp / Webhook</small>
          </div>
        </div>

        {/* Card 3: Section 43B(h) & Overdue WhatsApp Drips */}
        <div className="automation-card">
          <div className="automation-card-head">
            <div className="automation-icon-box">⚖️</div>
            <div>
              <h3>Section 43B(h) & Overdue Drips</h3>
              <p>Autonomous 4-stage debtor escalation and statutory compliance</p>
            </div>
          </div>

          <div className="drip-timeline">
            <div className="drip-step">
              <div className="drip-step-dot" />
              <div>
                <strong>Stage 1: Pre-Due Courtesy</strong>
                <small>3 Days before due date (friendly confirmation)</small>
              </div>
            </div>
            <div className="drip-step">
              <div className="drip-step-dot" />
              <div>
                <strong>Stage 2: Due Date Notification</strong>
                <small>Day 0 with integrated UPI / Razorpay payment link</small>
              </div>
            </div>
            <div className="drip-step">
              <div className="drip-step-dot" />
              <div>
                <strong>Stage 3: Grace Escalation</strong>
                <small>+7 Days overdue with attached ledger statement</small>
              </div>
            </div>
            <div className="drip-step highlight">
              <div className="drip-step-dot danger" />
              <div>
                <strong>Stage 4: Section 43B(h) Statutory Notice</strong>
                <small>+15 / +45 Days: 30% corporate tax penalty warning</small>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={handleRunCycle}
            disabled={cycleLoading}
            style={{ width: '100%', marginTop: 12 }}
          >
            {cycleLoading ? 'Running Cycle…' : '⚡ Run Automated Follow-up Cycle Now'}
          </button>

          {cycleResult && (
            <div className="sync-success-box" style={{ marginTop: 10 }}>
              ✓ Automation cycle processed <strong>{cycleResult.jobsProcessed}</strong> job(s) at {new Date(cycleResult.executedAt).toLocaleTimeString()}.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
