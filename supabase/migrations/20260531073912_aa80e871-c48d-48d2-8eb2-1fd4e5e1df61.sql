CREATE TABLE public.banned_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  reason text NOT NULL DEFAULT '',
  banned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_emails TO authenticated;
GRANT ALL ON public.banned_emails TO service_role;

ALTER TABLE public.banned_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY be_admin_manage ON public.banned_emails FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Public function (read-only) that returns whether an email is banned.
-- Used from the signup flow client-side BEFORE attempting auth.signUp.
CREATE OR REPLACE FUNCTION public.is_email_banned(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.banned_emails WHERE lower(email) = lower(_email));
$$;

GRANT EXECUTE ON FUNCTION public.is_email_banned(text) TO anon, authenticated;