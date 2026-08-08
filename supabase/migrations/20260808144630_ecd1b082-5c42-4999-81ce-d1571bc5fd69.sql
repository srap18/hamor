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
          AND NOT public.is_admin(a.attacker_id)
        GROUP BY a.attacker_id
        UNION ALL
        SELECT a.attacker_id AS user_id, COALESCE(SUM(a.damage_dealt),0)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_damage'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
          AND NOT public.is_admin(a.attacker_id)
        GROUP BY a.attacker_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_total'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
          AND cc.source = 'catch'
          AND NOT public.is_admin(cc.user_id)
        GROUP BY cc.user_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_specific'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
          AND cc.fish_id = c.target_fish_id
          AND cc.source = 'catch'
          AND NOT public.is_admin(cc.user_id)
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

    IF (coins_amt + gems_amt + rubies_amt) > 0 THEN
      PERFORM public._mutate_currency(winner_uid, coins_amt, gems_amt, rubies_amt, 0);
    END IF;
    IF xp_amt > 0 THEN
      PERFORM public.award_event_xp(winner_uid, xp_amt);
    END IF;

    items_arr := COALESCE(tier->'items', '[]'::jsonb);
    FOR item IN SELECT * FROM jsonb_array_elements(items_arr)
    LOOP
      it_type := item->>'type';
      it_code := item->>'code';
      it_qty  := GREATEST(1, COALESCE((item->>'qty')::int, 1));
      IF it_type IS NULL OR it_code IS NULL THEN CONTINUE; END IF;

      IF it_type = 'ship' THEN
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
END $function$;

-- One-off compensation for the sailfish festival (competition 1b8b44f0)
DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH c AS (SELECT * FROM public.competitions WHERE id = '1b8b44f0-6fce-4872-91f5-4a3c98bfbfc4'),
    tiers AS (
      SELECT ord::int rn, COALESCE((t->>'gems')::int,0) gems, COALESCE((t->>'coins')::bigint,0) coins
      FROM c, LATERAL jsonb_array_elements(c.prize_tiers) WITH ORDINALITY e(t, ord)
    ),
    paid AS (
      SELECT row_number() OVER (ORDER BY score DESC, user_id) rn, user_id FROM (
        SELECT cc.user_id, SUM(cc.qty)::bigint score
        FROM public.competition_catches cc, c
        WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at AND cc.fish_id = c.target_fish_id
        GROUP BY cc.user_id) x WHERE score > 0 LIMIT 30
    ),
    correct AS (
      SELECT row_number() OVER (ORDER BY score DESC, user_id) rn, user_id FROM (
        SELECT cc.user_id, SUM(cc.qty)::bigint score
        FROM public.competition_catches cc, c
        WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at AND cc.fish_id = c.target_fish_id
          AND cc.source = 'catch' AND NOT public.is_admin(cc.user_id)
        GROUP BY cc.user_id) x WHERE score > 0 LIMIT 30
    )
    SELECT co.user_id,
           (td.gems - COALESCE(tp.gems,0)) AS gems_delta,
           (td.coins - COALESCE(tp.coins,0)) AS coins_delta
    FROM correct co
    JOIN tiers td ON td.rn = co.rn
    LEFT JOIN paid pa ON pa.user_id = co.user_id
    LEFT JOIN tiers tp ON tp.rn = pa.rn
    WHERE (td.gems - COALESCE(tp.gems,0)) > 0 OR (td.coins - COALESCE(tp.coins,0)) > 0
  LOOP
    PERFORM public._mutate_currency(
      r.user_id,
      GREATEST(r.coins_delta, 0)::bigint,
      GREATEST(r.gems_delta, 0)::int,
      0, 0
    );
  END LOOP;
END
$do$;