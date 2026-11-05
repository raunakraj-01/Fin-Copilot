import React, { useEffect, useRef, useState } from 'react';
import './async-action-button.css';

export default function AsyncActionButton({
  busy = false,
  idleLabel,
  steps = [],
  doneLabel = 'Done',
  className = '',
  disabled,
  type = 'button',
  ...props
}) {
  const [phase, setPhase] = useState('idle');
  const [step, setStep] = useState(0);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      setPhase('running');
      setStep(0);
      if (steps.length < 2) return undefined;
      const interval = window.setInterval(() => setStep(current => (current + 1) % steps.length), 1050);
      return () => window.clearInterval(interval);
    }
    if (!wasBusy.current) { setPhase('idle'); return undefined; }
    wasBusy.current = false;
    setPhase('done');
    const timeout = window.setTimeout(() => setPhase('idle'), 1100);
    return () => window.clearTimeout(timeout);
  }, [busy, steps.length]);

  const label = phase === 'running' ? (steps[step] || idleLabel) : phase === 'done' ? doneLabel : idleLabel;
  return <button
    {...props}
    type={type}
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    aria-label={idleLabel}
    className={`async-action-button is-${phase}${className ? ` ${className}` : ''}`}
  >
    {phase !== 'idle' && <span className="async-action-symbol" aria-hidden="true">
      {phase === 'done' ? <svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.3 3.2 7.7-8"/></svg> : <span className="async-action-spinner"/>}
    </span>}
    <span className="async-action-copy" key={`${phase}-${step}`}>{label}</span>
    {phase === 'running' && <span className="async-action-progress" aria-hidden="true">{steps.map((_, index) => <i className={index === step ? 'active' : ''} key={index}/>)}</span>}
  </button>;
}
