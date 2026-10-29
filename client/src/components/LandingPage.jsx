import React, { useEffect } from 'react';
import LightRays from './reactbits/LightRays/LightRays.jsx';
import SpecularButton from './reactbits/SpecularButton/SpecularButton.jsx';
import './landing-page.css';

class EffectBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('Animated landing effect unavailable; using fallback.', error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const StartFallback = ({ onStart }) => <button className="landing-get-started landing-get-started--fallback" type="button" onClick={onStart}>Get Started <span aria-hidden="true">→</span></button>;

export default function LandingPage({ onStart }) {
  const supportsWebGL = typeof WebGL2RenderingContext !== 'undefined';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <main className="landing-page" aria-label="CashFlow Copilot welcome">
    <div className="landing-page__ambient" aria-hidden="true" />
    {supportsWebGL && <EffectBoundary fallback={null}><LightRays
        className="landing-page__rays"
        raysOrigin="top-center"
        raysColor="#7ea3cc"
        raysSpeed={0.72}
        lightSpread={0.72}
        rayLength={2.8}
        rayDensity={1.15}
        raySharpness={0.42}
        glow={0.74}
        haze={0.36}
        atmosphere={0.9}
        intensity={1.25}
        pulsating
        fadeDistance={1.2}
        mouseInfluence={0.18}
        cursorShadow
        clickPulse
        opacity={0.92}
      /></EffectBoundary>}
    <div className="landing-page__content">
      <img className="landing-page__logo" src="/brand/cashflow-copilot-logo.png" alt="" />
      <p className="landing-page__eyebrow">Financial decision system</p>
      <h1><span>CashFlow</span> <span>Copilot</span></h1>
      <p className="landing-page__subtitle">See the pressure before it reaches your cash.</p>
    </div>
    <div className="landing-page__action">
      {supportsWebGL ? <EffectBoundary fallback={<StartFallback onStart={onStart} />}><SpecularButton
          className="landing-get-started"
          size="lg"
          radius={24}
          tint="#5e83ae"
          tintOpacity={0.16}
          blur={12}
          textColor="#f9f5ed"
          lineColor="#d6e7f8"
          baseColor="#5e83ae"
          intensity={1.25}
          idleIntensity={0.7}
          shineSize={12}
          shineFade={38}
          thickness={1.4}
          glow={1.25}
          followMouse
          autoAnimate
          onClick={onStart}
        >Get Started <span aria-hidden="true">→</span></SpecularButton></EffectBoundary> :
        <StartFallback onStart={onStart} />}
      <span className="landing-page__hint">Enter your workspace</span>
    </div>
  </main>;
}
