-- 1) Audit table for tribe role changes
CREATE TABLE IF NOT EXISTS public.tribe_role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL,
  user_id uuid NOT NULL,
  old_role text,
  new_role text,
  actor_id uuid,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tribe_role_audit TO authenticated;
GRANT ALL ON public.tribe_role_audit TO service_role;
ALTER TABLE public.tribe_role_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tra_admin_read ON public.tribe_role_audit;
CREATE POLICY tra_admin_read ON public.tribe_role_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));
CREATE INDEX IF NOT EXISTS tribe_role_audit_tribe_idx ON public.tribe_role_audit (tribe_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_tribe_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.tribe_role_audit (tribe_id, user_id, old_role, new_role, actor_id, source)
  VALUES (
    COALESCE(NEW.tribe_id, OLD.tribe_id),
    COALESCE(NEW.user_id, OLD.user_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.role END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.role END,
    auth.uid(),
    TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_tribe_role_change ON public.tribe_members;
CREATE TRIGGER trg_log_tribe_role_change
AFTER INSERT OR DELETE OR UPDATE OF role ON public.tribe_members
FOR EACH ROW EXECUTE FUNCTION public.log_tribe_role_change();

-- 2) Close the privilege-escalation hole: role can no longer be set to 'owner'
--    from the client, and the owner row cannot be edited by officers.
CREATE OR REPLACE FUNCTION public.guard_tribe_members_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;

  IF NEW.donation_coins IS DISTINCT FROM OLD.donation_coins
     OR NEW.last_donation_at IS DISTINCT FROM OLD.last_donation_at
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN
    RAISE EXCEPTION 'Not allowed to modify protected tribe_member columns directly';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role = 'owner' OR NEW.role = 'owner'
       OR NEW.role NOT IN ('member','moderator') THEN
      RAISE EXCEPTION 'ownership_change_not_allowed';
    END IF;
    IF NOT public.is_tribe_officer(auth.uid(), OLD.tribe_id) THEN
      RAISE EXCEPTION 'not_tribe_officer';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS tm_update_officer ON public.tribe_members;
CREATE POLICY tm_update_officer ON public.tribe_members
  FOR UPDATE TO authenticated
  USING (public.is_tribe_officer(auth.uid(), tribe_id) AND role <> 'owner')
  WITH CHECK (public.is_tribe_officer(auth.uid(), tribe_id) AND role IN ('member','moderator'));

-- Officers must not be able to delete the owner row either.
DROP POLICY IF EXISTS tm_delete_officer ON public.tribe_members;
CREATE POLICY tm_delete_officer ON public.tribe_members
  FOR DELETE TO authenticated
  USING (public.is_tribe_officer(auth.uid(), tribe_id) AND role <> 'owner');

-- 3) Auto-transfer trigger: never override an existing owner
CREATE OR REPLACE FUNCTION public.auto_transfer_owner_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _new_owner uuid;
BEGIN
  IF current_setting('app.skip_owner_autofix', true) = '1' THEN
    RETURN OLD;
  END IF;
  IF OLD.role <> 'owner' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = OLD.tribe_id AND role = 'owner' AND user_id <> OLD.user_id
  ) THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = OLD.tribe_id AND user_id <> OLD.user_id
  ) THEN
    RETURN OLD;
  END IF;

  SELECT user_id INTO _new_owner
  FROM public.tribe_members
  WHERE tribe_id = OLD.tribe_id AND user_id <> OLD.user_id
  ORDER BY (role = 'moderator') DESC, joined_at ASC, donation_coins DESC
  LIMIT 1;

  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = OLD.tribe_id AND user_id = _new_owner;
  UPDATE public.tribes SET owner_id = _new_owner WHERE id = OLD.tribe_id;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_tribe_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_owner uuid;
BEGIN
  IF current_setting('app.skip_owner_autofix', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner')) THEN
    IF EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = OLD.tribe_id AND role = 'owner' AND user_id <> OLD.user_id) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    SELECT tm.user_id INTO new_owner
    FROM public.tribe_members tm
    LEFT JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.tribe_id = OLD.tribe_id AND tm.user_id <> OLD.user_id
    ORDER BY (tm.role = 'moderator') DESC, tm.joined_at ASC NULLS LAST
    LIMIT 1;
    IF new_owner IS NOT NULL THEN
      UPDATE public.tribe_members SET role = 'owner' WHERE tribe_id = OLD.tribe_id AND user_id = new_owner;
      UPDATE public.tribes SET owner_id = new_owner WHERE id = OLD.tribe_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4) leave_tribe: correct role name + deterministic single-owner handover
CREATE OR REPLACE FUNCTION public.leave_tribe(_tribe_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _new_owner uuid;
  _is_member boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT owner_id INTO _owner FROM public.tribes WHERE id = _tribe_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE tribe_id = _tribe_id AND user_id = _uid
  ) INTO _is_member;

  IF _owner IS NULL OR NOT _is_member THEN
    UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
    RETURN json_build_object('ok', true, 'healed', true);
  END IF;

  IF _owner = _uid THEN
    SELECT user_id INTO _new_owner FROM public.tribe_members
      WHERE tribe_id = _tribe_id AND user_id <> _uid
      ORDER BY (role = 'moderator') DESC, joined_at ASC
      LIMIT 1;

    IF _new_owner IS NOT NULL THEN
      PERFORM set_config('app.skip_owner_autofix', '1', true);
      DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid;
      UPDATE public.tribe_members SET role = 'owner'
        WHERE tribe_id = _tribe_id AND user_id = _new_owner;
      UPDATE public.tribes SET owner_id = _new_owner WHERE id = _tribe_id;
      UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
      PERFORM set_config('app.skip_owner_autofix', '0', true);
      RETURN json_build_object('ok', true, 'transferred_to', _new_owner);
    ELSE
      DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id;
      DELETE FROM public.tribes WHERE id = _tribe_id;
      UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
      RETURN json_build_object('ok', true, 'deleted', true);
    END IF;
  ELSE
    DELETE FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid;
    UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
    RETURN json_build_object('ok', true);
  END IF;
END;
$$;

-- 5) promote_next_owner: demote any stale owner row first
CREATE OR REPLACE FUNCTION public.promote_next_owner(_tribe_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _new_owner uuid;
BEGIN
  SELECT user_id INTO _new_owner
  FROM public.tribe_members
  WHERE tribe_id = _tribe_id AND role <> 'owner'
  ORDER BY (role = 'moderator') DESC, joined_at ASC, donation_coins DESC
  LIMIT 1;

  IF _new_owner IS NULL THEN RETURN NULL; END IF;

  PERFORM set_config('app.skip_owner_autofix', '1', true);
  UPDATE public.tribe_members SET role = 'member'
   WHERE tribe_id = _tribe_id AND role = 'owner' AND user_id <> _new_owner;
  UPDATE public.tribe_members SET role = 'owner'
   WHERE tribe_id = _tribe_id AND user_id = _new_owner;
  UPDATE public.tribes SET owner_id = _new_owner WHERE id = _tribe_id;
  PERFORM set_config('app.skip_owner_autofix', '0', true);

  RETURN _new_owner;
END;
$$;

-- 6) Normalize any legacy/invalid roles and enforce one owner per tribe
UPDATE public.tribe_members SET role = 'moderator'
 WHERE role IN ('officer','leader');

UPDATE public.tribe_members tm SET role = 'moderator'
 FROM public.tribes t
WHERE t.id = tm.tribe_id AND tm.role = 'owner' AND tm.user_id IS DISTINCT FROM t.owner_id;

UPDATE public.tribe_members tm SET role = 'owner'
 FROM public.tribes t
WHERE t.id = tm.tribe_id AND tm.user_id = t.owner_id AND tm.role <> 'owner';