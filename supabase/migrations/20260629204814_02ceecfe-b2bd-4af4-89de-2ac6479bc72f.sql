
SET LOCAL session_replication_role = 'replica';

UPDATE public.bans
SET active = false
WHERE user_id = 'dd778b4e-5848-433e-b831-38fbe3eed829' AND active = true;

UPDATE public.profiles
SET selected_bg_id = 'default'
WHERE id = 'dd778b4e-5848-433e-b831-38fbe3eed829'
  AND selected_bg_id = 'crystal_kingdom';

DELETE FROM public.inventory
WHERE id IN (
  '07122944-b974-4815-ad16-508d96430f8f',
  'd5a5b5cb-70b6-4fd7-951b-12decfcfd76f',
  'c1fd2f9d-5b02-44c1-b39e-1b2d20ffc37f',
  'b921ecc6-0c7e-4b49-92ab-c9ad95a74f4c',
  '633525d3-3672-4664-a731-0806eef12fde',
  '7e8d6e1b-5f2e-43fa-ba57-b32b7830f5da',
  'e5d7c808-3a45-4807-a9d6-4e9db2264370',
  'a666761e-34fd-4864-9aca-f011b436f727',
  '1b36060f-eab1-428e-b99b-069dd43c743e',
  'fe82a912-3d0c-4902-bffe-4f865afb604d',
  'f13e43ca-43c3-4ca1-b678-892719fff991',
  '4c158ff8-3a9d-4551-bd10-bec807072d97'
);

DELETE FROM public.ships_owned
WHERE id IN (
  '1254cbc9-4f6c-4a14-a547-85748c74e430',
  '111fc27c-0530-46b5-b0f6-e2dd9686ba41',
  '9a81fc64-dd57-4e8d-a781-cd135f0b34d0'
);

DELETE FROM public.dragon_equipment
WHERE id IN (
  'a1ef51e1-a3db-4af5-9bfc-2001379a95a7',
  '805eaf07-421f-4629-96b2-1b201068cd8c',
  '671d2669-fe61-4307-933c-729cf69c1b9c',
  'f1231c2d-5ad8-4baf-aec3-3becaa519387',
  '9531b7a0-6b51-416f-a8d9-9b697d7582af',
  'ece9d1ea-0cbb-4762-a014-1deb479b222e',
  '0e8ad72c-4322-4bdb-a670-2b94c815c9a3',
  '7435a9b7-6945-4290-a3d6-6454894da0cd',
  '35e312b3-0a82-4271-8944-f9ea8e22fa68',
  'a6bb3792-526a-48d1-aff0-3b3fdd7913f0',
  'c4c8305b-2b17-4ee5-beea-4dde82f88737'
);

INSERT INTO public.cheat_flags (user_id, kind, severity, details)
VALUES (
  'dd778b4e-5848-433e-b831-38fbe3eed829',
  'gem_purchases_rolled_back',
  4,
  jsonb_build_object(
    'inventory_deleted', 12,
    'ships_deleted', 3,
    'dragon_equipment_deleted', 11,
    'ban_lifted', true
  )
);

SET LOCAL session_replication_role = 'origin';
