
UPDATE public.profiles SET selected_bg_id = 'cove' WHERE selected_bg_id = 'onepiece' OR selected_bg_id IS NULL;
ALTER TABLE public.profiles ALTER COLUMN selected_bg_id SET DEFAULT 'cove';
