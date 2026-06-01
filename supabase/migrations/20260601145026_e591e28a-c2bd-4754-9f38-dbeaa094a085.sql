
-- =========================================================
-- 1) Lock down direct mutations from the browser
-- =========================================================

-- profiles: revoke broad UPDATE, grant only safe cosmetic columns
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  avatar_url, display_name, avatar_emoji,
  avatar_frame, name_frame, bubble_frame, profile_frame,
  selected_bg_id, online_at
) ON public.profiles TO authenticated;

-- fish_stock / inventory / ships_owned: read-only from client; writes via RPC only
REVOKE INSERT, UPDATE, DELETE ON public.fish_stock  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ships_owned FROM authenticated;

-- service_role keeps full access (already granted historically; ensure it stays)
GRANT ALL ON public.profiles, public.fish_stock, public.inventory, public.ships_owned TO service_role;

-- RPC to drop your own protection (used when attacking)
CREATE OR REPLACE FUNCTION public.drop_my_protection()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.profiles SET protection_until = NULL WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.drop_my_protection() TO authenticated;

-- =========================================================
-- 2) Anti-cheat detection tables
-- =========================================================

CREATE TABLE IF NOT EXISTS public.cheat_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  kind        text NOT NULL,
  severity    int  NOT NULL DEFAULT 1,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved    boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cheat_flags_user_idx ON public.cheat_flags(user_id, created_at DESC);

GRANT SELECT ON public.cheat_flags TO authenticated;
GRANT ALL    ON public.cheat_flags TO service_role;
ALTER TABLE public.cheat_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY cf_admin_all ON public.cheat_flags
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.account_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a     uuid NOT NULL,
  user_b     uuid NOT NULL,
  link_type  text NOT NULL,            -- 'device' | 'ip' | 'trade'
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b, link_type)
);
CREATE INDEX IF NOT EXISTS account_links_a_idx ON public.account_links(user_a);
CREATE INDEX IF NOT EXISTS account_links_b_idx ON public.account_links(user_b);
GRANT SELECT ON public.account_links TO authenticated;
GRANT ALL    ON public.account_links TO service_role;
ALTER TABLE public.account_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY al_admin_all ON public.account_links
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.user_ips (
  user_id    uuid NOT NULL,
  ip         text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  hits       int NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, ip)
);
CREATE INDEX IF NOT EXISTS user_ips_ip_idx ON public.user_ips(ip);
GRANT SELECT ON public.user_ips TO authenticated;
GRANT ALL    ON public.user_ips TO service_role;
ALTER TABLE public.user_ips ENABLE ROW LEVEL SECURITY;
CREATE POLICY ui_admin_all ON public.user_ips
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- =========================================================
-- 3) flag_cheat helper + auto-action
-- =========================================================

CREATE OR REPLACE FUNCTION public.flag_cheat(_user uuid, _kind text, _severity int, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _total int;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;

  INSERT INTO public.cheat_flags(user_id, kind, severity, details)
  VALUES (_user, _kind, GREATEST(_severity,1), COALESCE(_details, '{}'::jsonb));

  SELECT COALESCE(SUM(severity),0) INTO _total
  FROM public.cheat_flags
  WHERE user_id = _user AND resolved = false;

  IF _total >= 10 THEN
    INSERT INTO public.bans(user_id, reason, active, expires_at, banned_by)
    VALUES (_user, 'auto: cheat score >= 10', true, NULL, NULL)
    ON CONFLICT DO NOTHING;
  ELSIF _total >= 5 THEN
    INSERT INTO public.chat_mutes(user_id, reason, expires_at, active)
    VALUES (_user, 'auto: cheat score >= 5', now() + interval '48 hours', true)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.flag_cheat(uuid, text, int, jsonb) TO service_role;

-- =========================================================
-- 4) Helper: are these two users on the same device?
-- =========================================================

CREATE OR REPLACE FUNCTION public.users_same_device(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.device_accounts da1
    JOIN public.device_accounts da2 ON da1.device_id = da2.device_id
    WHERE da1.user_id = _a AND da2.user_id = _b AND _a <> _b
  );
$$;

-- =========================================================
-- 5) Harden send_support: block & flag same-device transfers
-- =========================================================

CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _crew_qty int;
  _msg text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_trader boolean;
  _already_assigned int;
  _trader_ends timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  IF NOT public.is_admin(_me) THEN
    IF NOT public.has_pvp_fleet(_me) THEN
      RAISE EXCEPTION 'sender needs pvp fleet: 3 ships of level 6 or higher';
    END IF;
    IF NOT public.is_market_pvp_unlocked(_recipient_id) THEN
      RAISE EXCEPTION 'recipient is a new player (market level under 6)';
    END IF;
    -- Anti-cheat: block transfers between accounts on the same device
    IF public.users_same_device(_me, _recipient_id) THEN
      INSERT INTO public.account_links(user_a, user_b, link_type, details)
      VALUES (_me, _recipient_id, 'device', jsonb_build_object('via','send_support'))
      ON CONFLICT DO NOTHING;
      PERFORM public.flag_cheat(_me, 'same_device_support', 3,
        jsonb_build_object('recipient', _recipient_id, 'kind', _kind));
      PERFORM public.flag_cheat(_recipient_id, 'same_device_support', 3,
        jsonb_build_object('sender', _me, 'kind', _kind));
      RAISE EXCEPTION 'blocked: cannot send support to an account on the same device';
    END IF;
  END IF;

  SELECT display_name, avatar_emoji INTO _sender_name, _sender_emoji
  FROM public.profiles WHERE id = _me;
  IF _sender_name IS NULL THEN _sender_name := 'صديق'; END IF;
  IF _sender_emoji IS NULL THEN _sender_emoji := '🤝'; END IF;

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id;
  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE id = _ship_id;
    _msg := 'إصلاح فوري للسفينة';
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'repair', 0, _msg, true);
    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '🛠️ صلّح لك سفينتك!',
      _sender_emoji || ' ' || _sender_name || ' أصلح سفينتك بالكامل', 'support', _me);
  ELSE
    IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew id'; END IF;
    _is_fixer  := _crew_id IN ('fixer_1','fixer_2','fixer_3');
    _is_trader := _crew_id = 'trader';

    SELECT quantity INTO _crew_qty FROM public.inventory
      WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
      FOR UPDATE;
    IF _crew_qty IS NULL OR _crew_qty < 1 THEN RAISE EXCEPTION 'sender has no such crew'; END IF;
    IF _crew_qty = 1 THEN
      DELETE FROM public.inventory WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1
        WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id
          AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
    END IF;

    IF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
       WHERE id = _ship_id;
    ELSIF _is_trader THEN
      _trader_ends := now() + interval '10 hours';
      INSERT INTO public.user_market_state(user_id, trader_until)
        VALUES (_recipient_id, _trader_ends)
      ON CONFLICT (user_id) DO UPDATE
        SET trader_until = GREATEST(
              COALESCE(public.user_market_state.trader_until, now()),
              EXCLUDED.trader_until),
            updated_at = now();
    ELSE
      SELECT count(*) INTO _already_assigned FROM public.inventory
        WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
          AND meta->>'assigned_ship_id' = _ship_id::text;
      IF _already_assigned > 0 THEN
        RAISE EXCEPTION 'recipient ship already has this crew';
      END IF;
      BEGIN
        INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
        VALUES (_recipient_id, 'crew', _crew_id, 1,
                jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.inventory
           SET meta = jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires)
         WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id
           AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
      END;
    END IF;

    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'crew', 0,
            CASE WHEN _is_trader THEN 'تاجر سوق لمدة 10 ساعات' ELSE 'طاقم: ' || _crew_id END, true);

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id,
      CASE WHEN _is_trader THEN '💰 تاجر سوق وصلك!' ELSE '⚓ طاقم وصل سفينتك!' END,
      _sender_emoji || ' ' || _sender_name ||
      CASE WHEN _is_trader THEN ' أرسل لك تاجر سوق (10 ساعات)' ELSE ' أرسل لك طاقم: ' || _crew_id END,
      'support', _me);
  END IF;
END;
$function$;

-- =========================================================
-- 6) Harden attack_player: same-device guard wrapper trigger
--    (We don't rewrite attack_player; we add a BEFORE INSERT trigger on attacks.)
-- =========================================================

CREATE OR REPLACE FUNCTION public.attacks_block_same_device()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(NEW.attacker_id) THEN
    IF public.users_same_device(NEW.attacker_id, NEW.defender_id) THEN
      INSERT INTO public.account_links(user_a, user_b, link_type, details)
      VALUES (NEW.attacker_id, NEW.defender_id, 'device', jsonb_build_object('via','attack'))
      ON CONFLICT DO NOTHING;
      PERFORM public.flag_cheat(NEW.attacker_id, 'same_device_attack', 3,
        jsonb_build_object('defender', NEW.defender_id));
      PERFORM public.flag_cheat(NEW.defender_id, 'same_device_attack', 3,
        jsonb_build_object('attacker', NEW.attacker_id));
      RAISE EXCEPTION 'blocked: cannot attack an account on the same device';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attacks_block_same_device ON public.attacks;
CREATE TRIGGER trg_attacks_block_same_device
  BEFORE INSERT ON public.attacks
  FOR EACH ROW
  EXECUTE FUNCTION public.attacks_block_same_device();
