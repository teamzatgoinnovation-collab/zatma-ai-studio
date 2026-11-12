import type { AdObjective, AdPlatform, BudgetType, GoogleRsa, GoogleTargeting, MetaCreative, MetaTargeting, TargetingOption } from '@zatma/validation';
import type { OAuthGrant } from '../../social/providers/provider.js';

export interface AdAccountInfo {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'DISABLED';
  manager: boolean;
  /** Google: the manager (MCC) account to send as `login-customer-id`. */
  loginCustomerId?: string;
}

export interface PlanAd {
  localId: string;
  name: string;
  creative: MetaCreative | GoogleRsa;
  /** Meta image bytes (read from storage on demand). */
  image?: () => Promise<{ bytes: Buffer; fileName: string }>;
}

export interface PlanGroup {
  localId: string;
  name: string;
  targeting: MetaTargeting | GoogleTargeting;
  ads: PlanAd[];
}

/** Everything needed to create a campaign on the platform. It is always created PAUSED. */
export interface CampaignPlan {
  name: string;
  objective: AdObjective;
  budgetType: BudgetType;
  budgetAmount: string;
  currency: string;
  startAt?: string | null;
  endAt?: string | null;
  groups: PlanGroup[];
}

export interface AdsCtx {
  token: string;
  account: { externalId: string; currency: string; loginCustomerId?: string | null };
  /** Progress of a multi-step creation; persisted after every step so a retry resumes. */
  state: Record<string, unknown>;
  saveState(patch: Record<string, unknown>): Promise<void>;
}

export interface CreatedCampaign {
  campaignId: string;
  /** Google budget resource (needed for budget changes). */
  budgetId?: string;
  groups: Record<string, string>;
  ads: Record<string, string>;
}

export interface ImportedCampaign {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  objective: AdObjective;
  budgetType: BudgetType;
  budgetAmount: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface InsightRow {
  campaignId: string;
  date: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: string;
  conversions: number;
  leads: number;
}

export interface CampaignIds {
  campaignId: string;
  budgetId?: string | null;
  groupIds: string[];
  adIds: string[];
}

/** Paid-ads adapter for one platform (official REST APIs only). */
export interface AdsPlatformAdapter {
  readonly platform: AdPlatform;
  readonly oauthId: 'meta_ads' | 'google_ads';
  readonly name: string;
  readonly scopes: string[];
  readonly usesPkce: boolean;
  authorizeUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthGrant>;
  refresh?(grant: { refreshToken: string }): Promise<Omit<OAuthGrant, 'externalUserId' | 'displayName'>>;
  revoke(token: string): Promise<void>;
  listAdAccounts(token: string): Promise<AdAccountInfo[]>;
  /** Creates campaign, ad sets/groups and ads PAUSED. Must be safe to call again with the saved state. */
  createCampaign(plan: CampaignPlan, ctx: AdsCtx): Promise<CreatedCampaign>;
  /** The only call that can start spending (ACTIVE); only invoked after an approved spend decision. */
  setStatus(ctx: AdsCtx, ids: CampaignIds, status: 'ACTIVE' | 'PAUSED'): Promise<void>;
  updateBudget(ctx: AdsCtx, ids: CampaignIds, budgetType: BudgetType, amount: string): Promise<void>;
  listCampaigns(ctx: AdsCtx): Promise<ImportedCampaign[]>;
  insights(ctx: AdsCtx, campaignIds: string[], from: string, to: string): Promise<InsightRow[]>;
  searchTargeting(ctx: AdsCtx, kind: 'location' | 'interest' | 'language', q: string): Promise<TargetingOption[]>;
}
