-- Expand finalize_competition to grant rubies + item rewards (ship/fish/inventory)
-- Tier shape now supports optional fields: rubies (int), items (jsonb array of {type,code,qty}).
-- Item types: 'ship', 'fish', and inventory types
--   ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield').

CREATE OR REPLACE FUNCTION public.finalize_competition(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  tier jsonb;
  rank_idx int;
  winner_uid uuid;
  winner_score bigint;
  prize_count int;
  coins_amt bigint;
  gems_amt int;
  rubies_amt int;
  xp_amt int;
  items_arr jsonb;
  item jsonb;
  it_type text;
  it_code text;
  it_qty int;
  template_lvl int;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  IF c.prizes_distributed_at IS NOT NULL THEN RETURN; END IF;
  IF c.ends_at > now() THEN RETURN; END IF;
  IF c.prize_tiers IS NULL OR jsonb_array_length(c.prize_tiers) = 0 THEN
    IF (c.reward_coins + c.reward_gems + c.reward_xp) > 0 THEN
      c.prize_tiers := jsonb_build_array(jsonb_build_object(
        'rank', 1,
        'coins', c.reward_coins,
        'gems', c.reward_gems,
        'xp', c.reward_xp,
        'text', c.reward_text
      ));
    ELSE
      UPDATE public.competitions SET prizes_distributed_at = now() WHERE id = _competition_id;
      RETURN;
    END IF;
  END IF;

  prize_count := jsonb_array_length(c.prize_tiers);

  FOR rank_idx, winner_uid, winner_score IN
    SELECT row_number() OVER (ORDER BY score DESC, user_id) AS rn, user_id, score
    FROM (
      SELECT user_id, score FROM (
        SELECT a.attacker_id AS user_id, COUNT(*)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_count'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
          AND a.damage_dealt > 0
        GROUP BY a.attacker_id
        UNION ALL
        SELECT a.attacker_id AS user_id, COALESCE(SUM(a.damage_dealt),0)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_damage'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
        GROUP BY a.attacker_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_total'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
        GROUP BY cc.user_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_specific'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
          AND cc.fish_id = c.target_fish_id
        GROUP BY cc.user_id
      ) all_metrics
      WHERE user_id IS NOT NULL AND score > 0
    ) lb
    LIMIT prize_count
  LOOP
    tier := c.prize_tiers -> (rank_idx - 1);
    IF tier IS NULL THEN EXIT; END IF;

    coins_amt  := COALESCE((tier->>'coins')::bigint, 0);
    gems_amt   := COALESCE((tier->>'gems')::int, 0);
    rubies_amt := COALESCE((tier->>'rubies')::int, 0);
    xp_amt     := COALESCE((tier->>'xp')::int, 0);

    IF (coins_amt + gems_amt + rubies_amt + xp_amt) > 0 THEN
      PERFORM public._mutate_currency(winner_uid, coins_amt, gems_amt, rubies_amt, xp_amt);
    END IF;

    items_arr := COALESCE(tier->'items', '[]'::jsonb);
    FOR item IN SELECT * FROM jsonb_array_elements(items_arr)
    LOOP
      it_type := item->>'type';
      it_code := item->>'code';
      it_qty  := GREATEST(1, COALESCE((item->>'qty')::int, 1));
      IF it_type IS NULL OR it_code IS NULL THEN CONTINUE; END IF;

      IF it_type = 'ship' THEN
        -- code expected like 'ship-lvl-N'; derive template_id from trailing number
        template_lvl := COALESCE(NULLIF(regexp_replace(it_code, '\D', '', 'g'), '')::int, 1);
        FOR i IN 1..it_qty LOOP
          INSERT INTO public.ships_owned(user_id, template_id, catalog_code, hp, max_hp, in_storage)
          VALUES (winner_uid, template_lvl, it_code, 100, 100, true);
        END LOOP;
      ELSIF it_type = 'fish' THEN
        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
        VALUES (winner_uid, it_code, it_qty, it_qty, now())
        ON CONFLICT (user_id, fish_id) DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
              updated_at = now();
      ELSIF it_type IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield') THEN
        INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
        VALUES (winner_uid, it_type, it_code, it_qty)
        ON CONFLICT (user_id, item_type, item_id) WHERE meta IS NULL OR (meta ->> 'assigned_ship_id'::text) IS NULL
        DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.competitions
     SET prizes_distributed_at = now()
   WHERE id = _competition_id;
END;
$function$;