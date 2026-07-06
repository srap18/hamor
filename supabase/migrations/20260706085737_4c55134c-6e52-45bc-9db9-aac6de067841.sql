UPDATE public.profiles p
   SET tribe_id = NULL
 WHERE p.tribe_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.tribes t WHERE t.id = p.tribe_id);

DELETE FROM public.tribe_members m
 WHERE NOT EXISTS (SELECT 1 FROM public.tribes t WHERE t.id = m.tribe_id);