-- Add per-user sign-in attention light preference.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auto_trigger_attention_on_sign_in boolean NOT NULL DEFAULT false;
