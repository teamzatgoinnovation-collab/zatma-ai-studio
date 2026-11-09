import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: {} }));
const { isPaletteShortcut } = await import('./command-palette');

describe('command palette shortcut', () => {
  it('opens on Ctrl+K and ⌘K only', () => {
    expect(isPaletteShortcut({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: 'j', ctrlKey: true, metaKey: false })).toBe(false);
  });
});
