import {
  BarChart3,
  Bot,
  Building2,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Palette,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Phase in which the module ships; omitted for items that are live. */
  phase?: number;
}

/** Full product navigation. Items with a `phase` are shown as upcoming and are not clickable. */
export const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'AI Studio', href: '/studio', icon: Palette, phase: 5 },
  { label: 'CRM', href: '/crm', icon: Users, phase: 7 },
  { label: 'Marketing', href: '/marketing', icon: Megaphone, phase: 10 },
  { label: 'Advertising', href: '/ads', icon: Target, phase: 11 },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, phase: 17 },
  { label: 'AI Assistant', href: '/assistant', icon: Bot, phase: 6 },
  { label: 'Team', href: '/team', icon: Building2 },
  { label: 'Billing', href: '/billing', icon: CreditCard },
  { label: 'Settings', href: '/settings', icon: Settings },
];
