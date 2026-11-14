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

export interface NavLeaf {
  label: string;
  href: string;
  /** Roadmap phase in which this module ships; omitted when it is live. */
  phase?: number;
  /** One-line purpose, shown in module pages and the command palette. */
  description: string;
  /** Planned capabilities (from the product spec), shown on not-yet-built module pages. */
  features?: string[];
  keywords?: string[];
}

export interface NavSection extends Omit<NavLeaf, 'href'> {
  id: string;
  icon: LucideIcon;
  /** Landing route for the section (its overview, or the page itself when there are no children). */
  href: string;
  children?: NavLeaf[];
}

/** Single source of truth for the sidebar, breadcrumbs, command palette and module pages. */
export const NAV: NavSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    description: 'Overview of your organization, workspaces and activity.',
  },
  {
    id: 'studio',
    label: 'AI Studio',
    href: '/studio',
    icon: Palette,
    description: 'Create marketing designs, copy and videos from a text prompt.',
    children: [
      {
        label: 'AI Design Generator',
        href: '/studio/design',
        description: 'Turn a prompt into an editable, on-brand marketing design.',
        features: ['Prompt → design brief → copy → background → layered design', 'Editable text, fonts, colours, images and layout', 'Platform sizes: Instagram, Facebook, LinkedIn, YouTube, WhatsApp Status', 'Export PNG, JPG and PDF'],
        keywords: ['canvas', 'editor', 'create'],
      },
      {
        label: 'AI Poster Generator',
        href: '/studio/posters',
        description: 'Sale, festival, event and product posters in Malayalam, English, Arabic and more.',
        features: ['Festival & offer templates (Onam, Eid, Diwali…)', 'Multi-language text rendered as live, editable layers', 'Brand kit applied automatically'],
      },
      {
        label: 'AI Video Studio',
        href: '/studio/video',
        phase: 16,
        description: 'Promotional and social video ads from a script or prompt.',
        features: ['Script and storyboard generation', 'Scene rendering via video providers', 'Voice-over, subtitles and music', 'MP4 export'],
      },
      {
        label: 'AI Copywriter',
        href: '/studio/copywriter',
        description: 'Headlines, captions, hashtags and ad copy in seven languages.',
        features: ['Tone, audience, goal and platform controls', 'Variants, rewriting and translation', 'Saved copy library'],
        keywords: ['captions', 'hashtags', 'text'],
      },
      {
        label: 'Templates',
        href: '/studio/templates',
        description: 'Ready-made designs by industry and occasion.',
        features: ['Organization templates by category', 'Start a new design from any template'],
      },
      {
        label: 'Brand Kit',
        href: '/studio/brand-kit',
        description: 'Logo, colours, fonts and guidelines applied to every design.',
        features: ['Multiple brands per organization', 'Colours, fonts, tagline, contact details', 'Brand guidelines for AI generation'],
      },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    href: '/crm',
    icon: Users,
    description: 'Leads, contacts, companies, deals and follow-ups in one place.',
    features: ['Lead, customer and revenue metrics', 'Lead sources and conversion', 'Follow-ups due today'],
    children: [
      { label: 'Leads', href: '/crm/leads', description: 'Capture, score, assign and convert leads.', features: ['Import/export CSV', 'Duplicate detection & merge', 'AI lead scoring (Phase 8)', 'Assignment and status tracking'] },
      { label: 'Contacts', href: '/crm/contacts', description: 'People you work with, with full activity history.', features: ['Linked company, leads and deals', 'Custom fields and tags', 'Communication history'] },
      { label: 'Companies', href: '/crm/companies', description: 'Business accounts and their contacts and deals.', features: ['Company profiles', 'Associated contacts and deals'] },
      { label: 'Customers', href: '/crm/customers', description: 'Converted customers, lifecycle and segmentation.', features: ['Customer lifecycle', 'Segments for campaigns', 'Retention signals'] },
      { label: 'Deals', href: '/crm/deals', description: 'Opportunities with value, stage and probability.', features: ['Deal value and currency', 'Expected close date and probability', 'Owner and source'] },
      { label: 'Sales Pipeline', href: '/crm/pipeline', description: 'Drag-and-drop Kanban from New Lead to Won.', features: ['Configurable stages', 'Drag-and-drop between stages', 'Pipeline value by stage'], keywords: ['kanban'] },
      { label: 'Activities', href: '/crm/activities', description: 'Calls, emails, meetings, WhatsApp messages and notes.', features: ['Timeline on every record', 'Activity types and outcomes'] },
      { label: 'Follow-ups', href: '/crm/follow-ups', description: 'Reminders with AI-drafted follow-up messages.', features: ['Due dates, priority and owner', 'Calendar integration', 'AI-generated follow-up message'] },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    href: '/marketing',
    icon: Megaphone,
    description: 'Campaigns, social publishing, calendar, email, WhatsApp and automation.',
    children: [
      { label: 'Campaigns', href: '/marketing/campaigns', description: 'Plan and run multi-channel campaigns with budget, links, leads and results.', keywords: ['campaign', 'utm', 'tracking', 'festival', 'promotion'] },
      { label: 'Social Accounts', href: '/marketing/accounts', description: 'Connect Facebook Pages, Instagram, LinkedIn Pages and YouTube channels.', keywords: ['connect', 'oauth', 'facebook', 'instagram', 'linkedin', 'youtube'] },
      { label: 'Social Media', href: '/marketing/social', description: 'Compose, preview and publish to connected accounts.', keywords: ['post', 'publish', 'compose', 'schedule'] },
      { label: 'Content Calendar', href: '/marketing/calendar', description: 'Month, week, day and list views of scheduled content.', keywords: ['schedule', 'planner'] },
      { label: 'Email Marketing', href: '/marketing/email', phase: 14, description: 'Templates, segments and email campaigns.', features: ['Personalisation and scheduling', 'Bounce and unsubscribe handling', 'Delivery analytics'] },
      { label: 'WhatsApp Marketing', href: '/marketing/whatsapp', phase: 14, description: 'Template messages via the WhatsApp Business Platform.', features: ['Opt-in and consent tracking', 'Approved templates', 'Message status and CRM sync'] },
      { label: 'Automation', href: '/marketing/automation', description: 'Visual trigger → condition → action workflows with run logs.', keywords: ['workflow', 'rules', 'trigger', 'follow-up'] },
    ],
  },
  {
    id: 'advertising',
    label: 'Advertising',
    href: '/ads',
    icon: Target,
    description: 'Create and track paid campaigns on Meta and Google.',
    children: [
      { label: 'Meta Ads', href: '/ads/meta', description: 'Facebook and Instagram ad accounts, campaigns, ad sets and ads.', keywords: ['facebook ads', 'instagram ads'] },
      { label: 'Google Ads', href: '/ads/google', description: 'Google Ads accounts and Search campaigns.', keywords: ['search ads', 'adwords'] },
      { label: 'Ad Campaigns', href: '/ads/campaigns', description: 'All paid campaigns across platforms.', keywords: ['budget', 'spend'] },
      { label: 'Ad Analytics', href: '/ads/analytics', phase: 17, description: 'Spend, reach, CTR, CPL and ROAS.', features: ['Creative and audience performance', 'Cross-platform comparison'] },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    phase: 17,
    description: 'Marketing, CRM and sales performance with AI insights.',
    children: [
      { label: 'Marketing Analytics', href: '/analytics/marketing', phase: 17, description: 'Reach, engagement, clicks and leads by channel.' },
      { label: 'CRM Analytics', href: '/analytics/crm', phase: 17, description: 'Lead sources, conversion and pipeline value.' },
      { label: 'Sales Analytics', href: '/analytics/sales', phase: 17, description: 'Won/lost deals, cycle length and team performance.' },
      { label: 'AI Insights', href: '/analytics/insights', phase: 17, description: 'Ask questions about your performance in plain language.' },
    ],
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    href: '/assistant',
    icon: Bot,
    phase: 6,
    description: 'Chat with AI to plan campaigns, write copy and work your CRM.',
    features: ['"Which leads should I contact today?"', '"Create a WhatsApp follow-up for this lead"', '"Plan an Onam campaign for my supermarket"'],
  },
  {
    id: 'team',
    label: 'Team',
    href: '/team',
    icon: Building2,
    description: 'Members, roles and invitations.',
    keywords: ['members', 'invite', 'roles'],
  },
  {
    id: 'billing',
    label: 'Billing',
    href: '/billing',
    icon: CreditCard,
    description: 'Plan, usage limits and invoices.',
    keywords: ['subscription', 'plan', 'invoice', 'razorpay'],
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    description: 'Organization profile, AI providers and your account.',
    keywords: ['profile', 'password', 'logo', 'ai', 'providers', 'credits'],
  },
];

/** Top-level groups rendered with a divider before them in the sidebar. */
export const NAV_DIVIDERS = new Set(['team']);

export interface Crumb {
  label: string;
  href: string;
}

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Breadcrumb trail for a pathname, derived from NAV. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  for (const section of NAV) {
    if (!matches(pathname, section.href) && !section.children?.some((c) => matches(pathname, c.href))) continue;
    const trail: Crumb[] = [{ label: section.label, href: section.href }];
    const child = section.children?.find((c) => matches(pathname, c.href));
    if (child && child.href !== section.href) trail.push({ label: child.label, href: child.href });
    return trail;
  }
  return [];
}

/** Looks up a module page by exact href (sections and leaves). */
export function findNavEntry(pathname: string): { section: NavSection; leaf?: NavLeaf } | null {
  for (const section of NAV) {
    if (section.href === pathname) return { section };
    const leaf = section.children?.find((c) => c.href === pathname);
    if (leaf) return { section, leaf };
  }
  return null;
}

/** The section whose subtree contains the pathname (used to auto-expand sidebar groups). */
export function activeSectionId(pathname: string): string | null {
  return NAV.find((s) => matches(pathname, s.href) || s.children?.some((c) => matches(pathname, c.href)))?.id ?? null;
}

/** Flattened list of every navigable entry (command palette). */
export function allNavEntries(): Array<NavLeaf & { section: string; icon: LucideIcon }> {
  return NAV.flatMap((s) => [
    { label: s.label, href: s.href, phase: s.phase, description: s.description, keywords: s.keywords, section: s.label, icon: s.icon },
    ...(s.children ?? []).map((c) => ({ ...c, section: s.label, icon: s.icon })),
  ]);
}

export { matches as isActiveHref };
