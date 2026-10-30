// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Operations from '../../client/src/pages/Operations.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens a WhatsApp draft without a payment link and can add a link optionally', async () => {
  const message = 'Please settle invoice DEMO-1';
  const fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => {
    if (url.endsWith('/health')) return { demoMode: true };
    if (url.includes('/items?')) return { items: [{ id: 'invoice', counterparty: 'Demo buyer', status: 'open' }] };
    if (url.endsWith('/offers/preview')) return { message, recipientPhone: '919876543210',
      whatsappUrl: `https://wa.me/919876543210?text=${encodeURIComponent(message)}`,
      desktopUrl: `whatsapp://send?phone=919876543210&text=${encodeURIComponent(message)}`,
      forecast: { baselineWorstCashPaise: 0, simulatedWorstCashPaise: 10000 } };
    if (url.endsWith('/offers/payment-link')) return { id: 'payment', status: 'created', message: `${message} https://rzp.io/demo`, paymentUrl: 'https://rzp.io/demo' };
    return { share: false };
  } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<Operations workspaceId="workspace" />);
  await screen.findByRole('option', { name: /Demo buyer/ });
  fireEvent.change(screen.getByLabelText('Open receivable'), { target: { value: 'invoice' } });
  fireEvent.change(screen.getByLabelText('Buyer phone with country code (+ optional)'), { target: { value: '919876543210' } });
  fireEvent.change(screen.getByLabelText('Settle by'), { target: { value: '2026-11-03' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview draft' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Preview draft' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Send through WhatsApp without link' }));
  expect(screen.getByRole('link', { name: 'Open WhatsApp Web' }).getAttribute('href')).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(message)}`);
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/offers/payment-link'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Razorpay link to message' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Send through WhatsApp with link' }));
  expect(screen.getByRole('link', { name: 'Open WhatsApp Web' }).getAttribute('href')).toContain(encodeURIComponent('https://rzp.io/demo'));
});
