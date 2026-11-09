import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, Meter, PageHeader } from '@zatma/ui';

describe('state components', () => {
  it('renders a page header with a level-1 heading and actions', () => {
    render(<PageHeader title="Team" description="Members" actions={<button>Invite</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('announces errors and retries', () => {
    const retry = vi.fn();
    render(<ErrorState description="Boom" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders empty states with an action', () => {
    render(<EmptyState title="No leads yet" action={<button type="button">Add lead</button>} />);
    expect(screen.getByRole('heading', { name: 'No leads yet' })).toBeInTheDocument();
  });

  it('exposes usage as an accessible meter', () => {
    render(<Meter label="Seats" used={3} limit={10} />);
    const meter = screen.getByRole('meter', { name: 'Seats' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuemax', '10');
  });
});
