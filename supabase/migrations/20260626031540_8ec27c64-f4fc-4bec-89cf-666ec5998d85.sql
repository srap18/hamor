
-- ============================================================
-- Economy & Fish Audit System
-- Tracks every coin/gem change and every fish_stock change with
-- a source tag so admins can roll back any erroneous batch.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.economy_audit (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  coins_delta bigint NOT NULL DEFAULT 0,
  gems_delta bigint NOT NULL DEFAULT 0,
  coins_before bigint,
  coins_after bigint,
  gems_before bigint,
  gems_after bigint,
  source text,                   -- e.g. 'sell_fish_by_qty', 'admin_refund', 'shop_buy'
  reason text,                   -- free-text label set by SET LOCAL
  meta jsonb
);
CREATE INDEX IF NOT EXISTS economy_audit_user_time_idx
  ON public.economy_audit(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS economy_audit_time_idx
  ON public.economy_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS economy_audit_source_time_idx
  ON public.economy_audit(source, changed_at DESC);

GRANT SELECT ON public.economy_audit TO authenticated;
GRANT ALL    ON public.economy_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.economy_audit_id_seq TO service_role;

ALTER TABLE public.economy_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS economy_audit_admin_read ON public.economy_audit;
CREATE POLICY economy_audit_admin_read ON public.economy_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Fish stock audit (every row that gets inserted/updated/deleted)
CREATE TABLE IF NOT EXISTS public.fish_stock_audit (
  id bigserial PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  fish_stock_id uuid,
  fish_id text,
  qty_delta bigint NOT NULL DEFAULT 0,   -- + when added, - when removed
  qty_before bigint,
  qty_after bigint,
  op text NOT NULL,                      -- 'insert' | 'update' | 'delete'
  source text,                           -- catch source / function name
  meta jsonb
);
CREATE INDEX IF NOT EXISTS fish_stock_audit_user_time_idx
  ON public.fish_stock_audit(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS fish_stock_audit_time_idx
  ON public.fish_stock_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS fish_stock_audit_source_time_idx
  ON public.fish_stock_audit(source, changed_at DESC);

GRANT SELECT ON public.fish_stock_audit TO authenticated;
GRANT ALL    ON public.fish_stock_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fish_stock_audit_id_seq TO service_role;

ALTER TABLE public.fish_stock_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fish_stock_audit_admin_read ON public.fish_stock_audit;
CREATE POLICY fish_stock_audit_admin_read ON public.fish_stock_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ------- helper: current_source / current_reason from GUC -------
CREATE OR REPLACE FUNCTION public._audit_current_source()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.audit_source', true), '')
$$;
CREATE OR REPLACE FUNCTION public._audit_current_reason()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.audit_reason', true), '')
$$;

-- ------- trigger for profiles.coins / profiles.gems changes -------
CREATE OR REPLACE FUNCTION public._trg_profiles_economy_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c_delta bigint := COALESCE(NEW.coins,0) - COALESCE(OLD.coins,0);
  _g_delta bigint := COALESCE(NEW.gems, 0) - COALESCE(OLD.gems, 0);
BEGIN
  IF _c_delta = 0 AND _g_delta = 0 THEN RETURN NEW; END IF;
  INSERT INTO public.economy_audit(
    user_id, coins_delta, gems_delta,
    coins_before, coins_after, gems_before, gems_after,
    source, reason
  ) VALUES (
    NEW.id, _c_delta, _g_delta,
    OLD.coins, NEW.coins, OLD.gems, NEW.gems,
    public._audit_current_source(),
    public._audit_current_reason()
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_economy_audit ON public.profiles;
CREATE TRIGGER trg_profiles_economy_audit
  AFTER UPDATE OF coins, gems ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._trg_profiles_economy_audit();

-- ------- trigger for fish_stock inserts/updates/deletes -------
CREATE OR REPLACE FUNCTION public._trg_fish_stock_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.fish_stock_audit(
      user_id, fish_stock_id, fish_id, qty_delta, qty_before, qty_after, op, source
    ) VALUES (
      NEW.user_id, NEW.id, NEW.fish_id, NEW.quantity, 0, NEW.quantity,
      'insert', public._audit_current_source()
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(NEW.quantity,0) = COALESCE(OLD.quantity,0) THEN RETURN NEW; END IF;
    INSERT INTO public.fish_stock_audit(
      user_id, fish_stock_id, fish_id, qty_delta, qty_before, qty_after, op, source
    ) VALUES (
      NEW.user_id, NEW.id, NEW.fish_id,
      COALESCE(NEW.quantity,0) - COALESCE(OLD.quantity,0),
      OLD.quantity, NEW.quantity,
      'update', public._audit_current_source()
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.fish_stock_audit(
      user_id, fish_stock_id, fish_id, qty_delta, qty_before, qty_after, op, source
    ) VALUES (
      OLD.user_id, OLD.id, OLD.fish_id, -OLD.quantity, OLD.quantity, 0,
      'delete', public._audit_current_source()
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_fish_stock_audit ON public.fish_stock;
CREATE TRIGGER trg_fish_stock_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fish_stock
  FOR EACH ROW EXECUTE FUNCTION public._trg_fish_stock_audit();

-- ------- admin helpers: set source for current transaction -------
CREATE OR REPLACE FUNCTION public.set_audit_context(_source text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.audit_source', COALESCE(_source,''), true);
  PERFORM set_config('app.audit_reason', COALESCE(_reason,''), true);
END $$;
REVOKE EXECUTE ON FUNCTION public.set_audit_context(text, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_audit_context(text, text) TO service_role;

-- ------- admin reversal helpers -------
-- Reverse all coin/gem deltas from a source within a time window.
CREATE OR REPLACE FUNCTION public.admin_revert_economy_window(
  _source text,
  _from timestamptz,
  _to timestamptz,
  _reason text DEFAULT 'admin revert'
)
RETURNS TABLE(user_id uuid, coins_reverted bigint, gems_reverted bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.audit_source', 'admin_revert:' || COALESCE(_source,''), true);
  PERFORM set_config('app.audit_reason', _reason, true);

  RETURN QUERY
  WITH agg AS (
    SELECT a.user_id, SUM(a.coins_delta)::bigint AS c, SUM(a.gems_delta)::bigint AS g
    FROM public.economy_audit a
    WHERE a.source = _source AND a.changed_at >= _from AND a.changed_at < _to
    GROUP BY a.user_id
  ),
  upd AS (
    UPDATE public.profiles p
       SET coins = GREATEST(0, COALESCE(p.coins,0) - agg.c),
           gems  = GREATEST(0, COALESCE(p.gems,0)  - agg.g)
      FROM agg
     WHERE p.id = agg.user_id
    RETURNING p.id AS user_id, agg.c AS coins_reverted, agg.g AS gems_reverted
  )
  SELECT * FROM upd;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_revert_economy_window(text, timestamptz, timestamptz, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_revert_economy_window(text, timestamptz, timestamptz, text) TO authenticated;

-- Reverse all fish_stock changes from a source within a time window.
CREATE OR REPLACE FUNCTION public.admin_revert_fish_window(
  _source text,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE(user_id uuid, fish_id text, qty_reversed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.audit_source', 'admin_revert:' || COALESCE(_source,''), true);

  -- Delete any fish_stock rows that were inserted by the matching source/window.
  RETURN QUERY
  WITH targets AS (
    SELECT a.fish_stock_id
      FROM public.fish_stock_audit a
     WHERE a.source = _source
       AND a.op = 'insert'
       AND a.changed_at >= _from AND a.changed_at < _to
  ),
  del AS (
    DELETE FROM public.fish_stock fs USING targets t
     WHERE fs.id = t.fish_stock_id
    RETURNING fs.user_id, fs.fish_id, fs.quantity
  )
  SELECT d.user_id, d.fish_id, SUM(d.quantity)::bigint
    FROM del d
   GROUP BY d.user_id, d.fish_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_revert_fish_window(text, timestamptz, timestamptz) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_revert_fish_window(text, timestamptz, timestamptz) TO authenticated;
