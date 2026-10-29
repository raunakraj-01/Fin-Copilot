import React, { useEffect, useRef } from 'react';
import './react-bits-effects.css';

// Lightweight, theme-tuned adaptations of React Bits interaction patterns.
export function AuroraBackdrop() {
  return <div className="rb-aurora" aria-hidden="true"><i /><i /><i /></div>;
}

export function ShinyText({ children, className = '' }) {
  return <span className={`rb-shiny-text${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function RevealContent({ children, className = '' }) {
  return <div className={`rb-reveal${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function SpotlightField({ children, className = '' }) {
  const fieldRef = useRef(null);

  const move = event => {
    const surface = event.target.closest('.card, .decision-card, .decision-metric, .decision-empty');
    if (!surface || !fieldRef.current?.contains(surface)) return;
    const bounds = surface.getBoundingClientRect();
    surface.style.setProperty('--rb-x', `${event.clientX - bounds.left}px`);
    surface.style.setProperty('--rb-y', `${event.clientY - bounds.top}px`);
    surface.dataset.spotlightActive = 'true';
  };

  const leave = event => {
    const surface = event.target.closest?.('.card, .decision-card, .decision-metric, .decision-empty');
    if (surface) delete surface.dataset.spotlightActive;
  };

  return <div ref={fieldRef} className={`rb-spotlight-field${className ? ` ${className}` : ''}`} onPointerMove={move} onPointerLeave={leave}>{children}</div>;
}

export function ClickSpark({ children }) {
  const canvasRef = useRef(null);
  const burstsRef = useRef([]);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return undefined;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = now => {
      frameRef.current = 0;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      burstsRef.current = burstsRef.current.filter(burst => {
        const progress = Math.min((now - burst.started) / 520, 1);
        if (progress >= 1) return false;
        const eased = 1 - Math.pow(1 - progress, 3);
        context.lineCap = 'round';
        burst.rays.forEach((ray, index) => {
          const distance = 8 + 30 * eased * ray.reach;
          const length = 10 * Math.pow(1 - progress, 1.7);
          const startX = burst.x + Math.cos(ray.angle) * distance;
          const startY = burst.y + Math.sin(ray.angle) * distance;
          context.globalAlpha = 1 - progress;
          context.strokeStyle = index % 3 === 0 ? '#2a2a2a' : '#5e83ae';
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(startX + Math.cos(ray.angle) * length, startY + Math.sin(ray.angle) * length);
          context.stroke();
        });
        return true;
      });
      context.globalAlpha = 1;
      if (burstsRef.current.length) frameRef.current = requestAnimationFrame(draw);
    };

    const spark = event => {
      if (reduceMotion || !event.target.closest('button, a, summary')) return;
      burstsRef.current.push({
        x: event.clientX,
        y: event.clientY,
        started: performance.now(),
        rays: Array.from({ length: 8 }, (_, index) => ({ angle: (Math.PI * 2 * index) / 8, reach: .76 + Math.random() * .34 }))
      });
      if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointerdown', spark);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', spark);
    };
  }, []);

  return <div className="rb-click-spark">{children}<canvas ref={canvasRef} className="rb-spark-canvas" aria-hidden="true" /></div>;
}
