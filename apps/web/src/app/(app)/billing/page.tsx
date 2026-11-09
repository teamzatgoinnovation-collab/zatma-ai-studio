import type { Metadata } from 'next';
import { BillingPage } from './billing';

export const metadata: Metadata = { title: 'Billing' };

export default function Page() {
  return <BillingPage />;
}
