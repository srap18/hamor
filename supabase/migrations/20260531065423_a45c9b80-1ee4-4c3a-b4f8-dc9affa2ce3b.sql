
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
FROM auth.users u
WHERE lower(u.email) IN ('shabik509509@gmail.com','ccx1357@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;
