import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let pathname = '/marketing/automation';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
const { Breadcrumbs } = await import('./breadcrumbs');

describe('Breadcrumbs', () => {
  it('links ancestors and marks the current page', () => {
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'Marketing' })).toHaveAttribute('href', '/marketing');
    expect(screen.getByText('Automation')).toHaveAttribute('aria-current', 'page');
  });

  it('renders nothing for unknown routes', () => {
    pathname = '/somewhere';
    const { container } = render(<Breadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });
});
