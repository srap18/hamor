
SET LOCAL session_replication_role = 'replica';

DROP FUNCTION IF EXISTS public.qa_award(uuid, integer, bigint, integer);

SET LOCAL session_replication_role = 'origin';
