import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findNavEntry } from '../nav';
import { ModulePage } from './module-page';

describe('ModulePage', () => {
  it('renders a section overview with a card per module', () => {
    const { section } = findNavEntry('/studio')!;
    render(<ModulePage section={section} />);
    expect(screen.getByRole('heading', { level: 1, name: 'AI Studio' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(section.children!.length);
  });

  it('renders an honest roadmap layout for a planned module (no sample data)', () => {
    const { section, leaf } = findNavEntry('/marketing/email')!;
    render(<ModulePage section={section} leaf={leaf} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Email Marketing' })).toBeInTheDocument();
    expect(screen.getByText('Email Marketing is coming in Phase 14')).toBeInTheDocument();
    expect(screen.getByText(/Nothing on this page is sample data/)).toBeInTheDocument();
    expect(screen.getByText('Bounce and unsubscribe handling')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create a workspace per brand or client/ })).toHaveAttribute('href', '/dashboard');
  });
});
