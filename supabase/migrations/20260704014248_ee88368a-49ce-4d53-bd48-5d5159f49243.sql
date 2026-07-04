
SET lock_timeout = '3s';
DROP INDEX IF EXISTS public.idx_notifs_recipient;
DROP INDEX IF EXISTS public.fish_caught_user_fish_uniq;
DROP INDEX IF EXISTS public.inventory_user_type_idx;
DROP INDEX IF EXISTS public.idx_fish_caught_user;
DROP INDEX IF EXISTS public.messages_channel_created_idx;
