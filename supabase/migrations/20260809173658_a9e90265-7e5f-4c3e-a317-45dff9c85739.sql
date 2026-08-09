CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  device text NOT NULL DEFAULT '',
  fails integer NOT NULL DEFAULT 0,
  first_fail_at timestamptz NOT NULL DEFAULT now(),
  last_fail_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, device)
);

GRANT ALL ON public.login_attempts TO service_role;

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "login_attempts_service_only"
ON public.login_attempts FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS login_attempts_device_idx ON public.login_attempts (device, last_fail_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_last_fail_idx ON public.login_attempts (last_fail_at);

CREATE TRIGGER update_login_attempts_updated_at
BEFORE UPDATE ON public.login_attempts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();