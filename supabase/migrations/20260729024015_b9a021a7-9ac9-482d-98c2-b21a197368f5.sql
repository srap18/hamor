
DO $$
DECLARE
  _admin uuid := '7035f6b9-7bb2-41e2-a8b8-050d0e7f41c0';
  _uid uuid;
  _ids uuid[] := ARRAY[
    '90117c21-1cf2-4261-a231-4261b0a1a64d',
    'faade06d-91bc-4898-b78e-b634986b3b68',
    'bf8f2e08-f59f-46eb-9a1a-a93104213b02',
    '532e2155-53fd-4de7-9058-1d56d81ee02e',
    '402ae334-d40d-481d-8896-7b004a067c2e',
    'e3916484-e0b1-409a-9068-43f2e3dacc0f',
    'ea76fd14-067b-411a-b9ee-50c963836f97',
    '83e90f3f-20f1-4b3f-b942-bd8712986eb8',
    'd4028c31-74f1-4dfb-9274-a232e50ae104',
    'df72473b-0a10-4a35-aed1-f111b5ab47b6',
    'da489428-2a55-4e36-9fa1-ad607d407429',
    'd8d960e9-3f73-4152-b7f8-06e210fe05c4'
  ]::uuid[];
BEGIN
  SET LOCAL session_replication_role = 'replica';

  INSERT INTO public.banned_ips(ip, user_id, reason, banned_by)
  SELECT DISTINCT ui.ip, NULL::uuid, 'multi-account abuse: اجرام شغب', _admin
  FROM public.user_ips ui
  WHERE ui.user_id = ANY(_ids)
  ON CONFLICT (ip) DO NOTHING;

  FOREACH _uid IN ARRAY _ids LOOP
    PERFORM public.admin_hard_ban(_uid, 'multi-account abuse: اجرام شغب', _admin);
  END LOOP;

  FOREACH _uid IN ARRAY _ids LOOP
    PERFORM public.admin_hard_delete_user(_uid);
  END LOOP;
END $$;
