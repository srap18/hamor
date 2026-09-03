CREATE OR REPLACE FUNCTION public.pvp_pair_block_error(_attacker uuid, _defender uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e text;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;

  -- شرط قدرة المهاجم على الهجوم (سوق 15 + 3 سفن مبحرة مستوى 15+)
  _e := public.pvp_attack_ready_error(_attacker);
  IF _e IS NOT NULL THEN RETURN _e; END IF;

  -- الحصانة للمدافع مرتبطة فقط بمستوى سوق السفن (< 15)
  IF public.pvp_is_immune(_defender) THEN
    RETURN '🛡️ هذا اللاعب داخل الحصانة ولا يمكن مهاجمته.';
  END IF;

  -- لا توجد أي مقارنة بين مستويات الأساطيل بعد الآن
  RETURN NULL;
END $function$;