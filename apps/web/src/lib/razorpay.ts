import type { CheckoutSession } from '@zatma/types';

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (resp: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load Razorpay Checkout'));
    document.body.appendChild(el);
  });
}

/** Opens Razorpay Checkout for a subscription. Resolves when the customer completes payment. */
export async function openRazorpayCheckout(session: CheckoutSession, organizationName: string): Promise<'paid' | 'dismissed'> {
  await loadScript();
  if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable');
  const Razorpay = window.Razorpay;
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: session.keyId,
      subscription_id: session.subscriptionId,
      name: 'ZatGo AI Marketing',
      description: `${session.plan.name} plan (${session.interval.toLowerCase()}) for ${organizationName}`,
      prefill: session.prefill,
      theme: { color: '#4f46e5' },
      handler: () => resolve('paid'),
      modal: { ondismiss: () => resolve('dismissed') },
    });
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description ?? 'Payment failed')));
    rzp.open();
  });
}
