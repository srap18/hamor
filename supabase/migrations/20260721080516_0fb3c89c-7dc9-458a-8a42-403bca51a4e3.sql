
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS chat_audio_upload_allowed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.admin_set_chat_audio_upload(_target uuid, _allowed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles SET chat_audio_upload_allowed = COALESCE(_allowed, false) WHERE id = _target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_chat_audio_upload(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_chat_audio_upload(uuid, boolean) TO authenticated;
