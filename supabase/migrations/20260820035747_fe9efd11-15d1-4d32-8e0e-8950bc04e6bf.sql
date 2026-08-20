
DELETE FROM public.device_slots WHERE hardware_hash IN (
  '1111111111111111111111111111111111111111111111111111111111111111',
  '7777777777777777777777777777777777777777777777777777777777777777');
DELETE FROM public.device_identity_users WHERE identity_id IN (
  SELECT id FROM public.device_identities WHERE stable_key LIKE 'sk_test_%' OR stable_key LIKE 'sk_other_%');
DELETE FROM public.device_identities WHERE stable_key LIKE 'sk_test_%' OR stable_key LIKE 'sk_other_%';
REVOKE EXECUTE ON FUNCTION public.device_identity_canonical(uuid, text) FROM postgres;
