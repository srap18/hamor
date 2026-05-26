
-- 1) Notifications when someone attacks me
CREATE OR REPLACE FUNCTION public.notify_attack_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker_name text;
  _attacker_emoji text;
  _new_hp int;
  _ship_lvl int;
  _title text;
  _body text;
BEGIN
  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji
  FROM public.profiles WHERE id = NEW.attacker_id;
  IF _attacker_name IS NULL THEN _attacker_name := 'قرصان'; END IF;
  IF _attacker_emoji IS NULL THEN _attacker_emoji := '🏴‍☠️'; END IF;

  SELECT hp, template_id INTO _new_hp, _ship_lvl
  FROM public.ships_owned WHERE id = NEW.target_ship_id;

  IF _new_hp IS NOT NULL AND _new_hp = 0 THEN
    _title := '💥 سفينتك تدمّرت!';
    _body := _attacker_emoji || ' ' || _attacker_name || ' دمّر سفينتك — لازم تصلحها';
  ELSE
    _title := '⚔️ هجوم!';
    _body := _attacker_emoji || ' ' || _attacker_name || ' هاجم سفينتك (-' || COALESCE(NEW.damage_dealt, NEW.damage) || ' HP)';
  END IF;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (NEW.defender_id, _title, _body, 'attack', NEW.attacker_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_attack_received ON public.attacks;
CREATE TRIGGER trg_notify_attack_received
AFTER INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public.notify_attack_received();


-- 2) Notification when a raid starts against me (ships_owned.stealing_target_user_id transitions to non-null)
CREATE OR REPLACE FUNCTION public.notify_steal_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _emoji text;
BEGIN
  IF NEW.stealing_target_user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.stealing_target_user_id IS NOT DISTINCT FROM NEW.stealing_target_user_id THEN
    RETURN NEW;
  END IF;

  SELECT display_name, avatar_emoji INTO _name, _emoji
  FROM public.profiles WHERE id = NEW.user_id;
  IF _name IS NULL THEN _name := 'قرصان'; END IF;
  IF _emoji IS NULL THEN _emoji := '🏴‍☠️'; END IF;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (
    NEW.stealing_target_user_id,
    '🏴‍☠️ يحاول سرقتك!',
    _emoji || ' ' || _name || ' وصل محيطك وبدأ يسرق — ادخل وأوقفه',
    'attack',
    NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_steal_started ON public.ships_owned;
CREATE TRIGGER trg_notify_steal_started
AFTER INSERT OR UPDATE OF stealing_target_user_id ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public.notify_steal_started();


-- 3) Server-side send_support: applies effect + notifies + logs in one atomic call
CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _crew_qty int;
  _crew_name text;
  _msg text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  SELECT display_name, avatar_emoji INTO _sender_name, _sender_emoji
  FROM public.profiles WHERE id = _me;
  IF _sender_name IS NULL THEN _sender_name := 'صديق'; END IF;
  IF _sender_emoji IS NULL THEN _sender_emoji := '🤝'; END IF;

  IF _kind = 'repair' THEN
    SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id;
    IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
      RAISE EXCEPTION 'target ship does not belong to recipient';
    END IF;

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

    -- Consume one from sender
    SELECT quantity INTO _crew_qty FROM public.inventory
      WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id FOR UPDATE;
    IF _crew_qty IS NULL OR _crew_qty < 1 THEN RAISE EXCEPTION 'sender has no such crew'; END IF;
    IF _crew_qty = 1 THEN
      DELETE FROM public.inventory WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1
        WHERE user_id = _me AND item_type = 'crew' AND item_id = _crew_id;
    END IF;

    -- Give to recipient (sum quantity if already owned)
    IF EXISTS (SELECT 1 FROM public.inventory WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id) THEN
      UPDATE public.inventory SET quantity = quantity + 1
        WHERE user_id = _recipient_id AND item_type = 'crew' AND item_id = _crew_id;
    ELSE
      INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
      VALUES (_recipient_id, 'crew', _crew_id, 1);
    END IF;

    _msg := 'طاقم: ' || _crew_id;
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'crew', 0, _msg, true);

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '👨‍✈️ وصلك طاقم دعم!',
      _sender_emoji || ' ' || _sender_name || ' أرسل لك طاقم (' || _crew_id || ') — موجود في مخزونك',
      'support', _me);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO authenticated;


-- 4) Realtime: ensure attacks + support_gifts are broadcast live
ALTER TABLE public.attacks REPLICA IDENTITY FULL;
ALTER TABLE public.support_gifts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='attacks'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.attacks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='support_gifts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.support_gifts';
  END IF;
END $$;
