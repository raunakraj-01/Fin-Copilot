import React, { useEffect } from 'react';
import './landing-page.css';

export default function LandingPage({ onStart }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <main className="landing-page" aria-label="CashFlow Copilot welcome">
    <header className="landing-page__header">
      <div className="landing-page__wordmark"><span aria-hidden="true">₹</span> CashFlow Copilot</div>
      <span>Cash decisions, in view</span>
    </header>
    <div className="landing-page__body">
      <section className="landing-page__content">
        <p className="landing-page__eyebrow">For Indian suppliers</p>
        <h1>See the cash gap before it arrives</h1>
        <p className="landing-page__subtitle">Review a 90-day outlook, test payment delays, and compare ways to protect your reserve.</p>
        <button className="landing-get-started" type="button" onClick={onStart}>Open workspace <span aria-hidden="true">→</span></button>
      </section>
      <div className="landing-preview" aria-label="Illustrative cash outlook preview">
        <div className="landing-preview__top"><span>Cash outlook</span><span>Next 90 days</span></div>
        <div className="landing-preview__summary"><div><small>Opening cash</small><strong>₹2,00,000</strong></div><div><small>Lowest balance</small><strong>−₹2,00,000</strong><span>11 Nov</span></div></div>
        <div className="landing-preview__chart"><div className="landing-preview__axis"><span>₹2L</span><span>₹0</span><span>−₹2L</span></div><svg viewBox="0 0 500 220" preserveAspectRatio="none" role="img" aria-label="Illustrative cash balance falls below zero and recovers"><path className="landing-preview__grid" d="M0 24H500M0 110H500M0 196H500"/><path className="landing-preview__zero" d="M0 110H500"/><path className="landing-preview__line" d="M0 40 L54 42 L90 66 L126 92 L162 114 L200 172 L244 194 L280 194 L318 150 L354 106 L396 86 L440 48 L500 44"/><circle cx="244" cy="194" r="5"/></svg></div>
        <div className="landing-preview__dates"><span>01 Nov</span><span>11 Nov</span><span>26 Nov</span><span>31 Jan</span></div>
        <div className="landing-preview__foot"><span><i/>Reserve breach · 06 Nov</span><span>Entered-date scenario</span></div>
      </div>
    </div>
  </main>;
}
