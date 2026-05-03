-- Migration: add onboarding state and student messages

-- Table: public.onboarding_state
CREATE TABLE IF NOT EXISTS public.onboarding_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    completed boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    app_version text,
    created_at timestamptz DEFAULT now()
);

-- Table: public.student_messages
CREATE TABLE IF NOT EXISTS public.student_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id text NOT NULL,
    target_user_id text,
    target_class_id text,
    subject text,
    body text,
    related_item_id text,
    created_at timestamptz DEFAULT now(),
    read_at timestamptz
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_onboarding_user_id ON public.onboarding_state(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_target_user ON public.student_messages(target_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_target_class ON public.student_messages(target_class_id);
