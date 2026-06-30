
ALTER FUNCTION public._audit_current_reason() SET search_path = public;
ALTER FUNCTION public._audit_current_source() SET search_path = public;
ALTER FUNCTION public._dragon_equipment_default_stats(text) SET search_path = public;
ALTER FUNCTION public._dragon_equipment_fill_stats() SET search_path = public;
ALTER FUNCTION public._sell_fish_botcheck() SET search_path = public;
ALTER FUNCTION public.daily_xp_cap() SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.dragon_stage_for_dp(bigint) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.message_contains_link(text) SET search_path = public;
ALTER FUNCTION public.messages_block_links_trg() SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.qa_day_key() SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.xp_gain_scale(integer) SET search_path = public;
