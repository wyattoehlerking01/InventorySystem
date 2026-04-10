-- Add per-class sign-in auto door trigger preference.
-- Software note: this maps to the same physical path as the former attention-light trigger.
ALTER TABLE public.class_permissions
ADD COLUMN IF NOT EXISTS auto_trigger_attention_on_sign_in boolean NOT NULL DEFAULT false;
