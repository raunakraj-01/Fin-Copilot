import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import './styles.css';
import './hallmark-pages.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

// Register offline-first service worker in supported browser environments
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
