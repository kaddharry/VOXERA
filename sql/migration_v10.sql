-- Migration v10: SaaS Billing Subscriptions

ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English',
ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'Professional';
CREATE TABLE public.subscriptions (
  id text PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  tier text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'active',
  current_period_end bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS for subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tenant's subscriptions"
ON public.subscriptions
FOR SELECT
USING (
  tenant_id IN (
    SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()
  )
);
