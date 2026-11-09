import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@zatma/ui';

let pathname = '/crm/leads';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('../org-switcher', () => ({ OrgSwitcher: () => null }));

const { SidebarNav } = await import('./sidebar');
const renderNav = (collapsed = false) =>
  render(
    <TooltipProvider>
      <SidebarNav collapsed={collapsed} />
    </TooltipProvider>,
  );

describe('SidebarNav', () => {
  it('expands the group containing the current page and marks it current', () => {
    pathname = '/crm/leads';
    renderNav();
    expect(screen.getByRole('button', { name: /CRM/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /AI Studio/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles groups, including collapsing the current one', () => {
    pathname = '/crm/leads';
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: /AI Studio/ }));
    expect(screen.getByRole('link', { name: 'Brand Kit' })).toHaveAttribute('href', '/studio/brand-kit');
    fireEvent.click(screen.getByRole('button', { name: /CRM/ }));
    expect(screen.queryByRole('link', { name: 'Leads' })).toBeNull();
  });

  it('shows phase badges for planned modules', () => {
    pathname = '/dashboard';
    renderNav();
    expect(screen.getByRole('link', { name: /AI Assistant/ })).toHaveTextContent('P6');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders icon-only links with accessible names when collapsed', () => {
    pathname = '/billing';
    renderNav(true);
    expect(screen.getByRole('link', { name: 'CRM' })).toHaveAttribute('href', '/crm');
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /CRM/ })).toBeNull();
  });
});
