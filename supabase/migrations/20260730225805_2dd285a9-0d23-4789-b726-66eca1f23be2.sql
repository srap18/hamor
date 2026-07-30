UPDATE public.ships_owned
SET stars = 5, max_stars = 5, max_hp = 1000000, hp = 1000000
WHERE user_id = '5b034690-85a3-4088-a7ae-78ba5b48d7c4'
  AND catalog_code = 'upgrade-sub'
  AND stars < 5;