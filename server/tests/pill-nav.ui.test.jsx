// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PillNav from '../../client/src/components/PillNav/PillNav.jsx';

afterEach(() => {
  cleanup();
});

describe('PillNav component', () => {
  const items = [
    { label: 'Dashboard', href: '/cash-outlook', ariaLabel: 'Cash Outlook' },
    { label: 'Buyer search', href: '/new-order-analyzer', ariaLabel: 'New Order Analyzer' },
    { label: 'Rescue Planner', href: '/rescue-planner', ariaLabel: 'Rescue Planner' },
    { label: 'Shock Lab', href: '/cash-shock-lab', ariaLabel: 'Cash Shock Lab' },
    { label: 'RAG Assistant', href: '/cash-copilot', ariaLabel: 'Cash Copilot' },
    { label: 'Operations', href: '/operations', ariaLabel: 'Operations' },
    { label: 'Setup', href: '/setup-import', ariaLabel: 'Setup & Import' }
  ];

  it('renders all website navigation items with appropriate labels and active status', () => {
    render(
      <PillNav
        logo="/brand/cashflow-mark.svg"
        logoAlt="Kavach"
        items={items}
        activeHref="/cash-outlook"
        itemStyle="plain"
        hoverEffect="glide"
        indicator="pill"
        size="lg"
        highlightColor="#16332d"
        highlightTextColor="#ffffff"
      />
    );

    const activeLink = screen.getByRole('link', { name: 'Cash Outlook' });
    expect(activeLink).toBeTruthy();
    expect(activeLink.getAttribute('aria-current')).toBe('page');

    expect(screen.getByRole('link', { name: 'New Order Analyzer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rescue Planner' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cash Shock Lab' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cash Copilot' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Operations' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Setup & Import' })).toBeTruthy();

    const logoLink = screen.getByRole('link', { name: 'Kavach' });
    expect(logoLink).toBeTruthy();
  });

  it('calls onItemClick when a navigation link is clicked', () => {
    const handleClick = vi.fn();
    render(
      <PillNav
        items={items}
        activeHref="/cash-outlook"
        onItemClick={(item, index, event) => {
          event.preventDefault();
          handleClick(item);
        }}
        itemStyle="plain"
        hoverEffect="glide"
        indicator="pill"
        size="lg"
      />
    );

    fireEvent.click(screen.getByRole('link', { name: 'Rescue Planner' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].label).toBe('Rescue Planner');
    expect(handleClick.mock.calls[0][0].href).toBe('/rescue-planner');
  });

  it('sets custom pill highlight colors on css custom properties', () => {
    const { container } = render(
      <PillNav
        items={items}
        activeHref="/cash-outlook"
        itemStyle="plain"
        hoverEffect="glide"
        indicator="pill"
        highlightColor="#2ebd85"
        highlightTextColor="#0d1614"
      />
    );

    const nav = container.querySelector('nav.pill-nav');
    expect(nav).toBeTruthy();
    expect(nav.style.getPropertyValue('--pn-pill')).toBe('#2ebd85');
    expect(nav.style.getPropertyValue('--pn-pill-ink')).toBe('#0d1614');
  });

  it('opens collapsed mobile menu toggle and allows navigation without breaking labels', () => {
    const handleClick = vi.fn();
    const { container } = render(
      <PillNav
        items={items}
        activeHref="/cash-outlook"
        collapse="always"
        onItemClick={(item, index, event) => {
          event.preventDefault();
          handleClick(item);
        }}
      />
    );

    const nav = container.querySelector('nav.pill-nav');
    expect(nav.hasAttribute('data-collapsed')).toBe(true);

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(toggle);

    const targetLink = screen.getByRole('link', { name: 'Cash Copilot' });
    expect(targetLink).toBeTruthy();
    fireEvent.click(targetLink);
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].href).toBe('/cash-copilot');
  });
});
