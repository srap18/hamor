import { supabase } from "@/integrations/supabase/client";

export type PublicProfile = {
  id: string;
  display_name: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
  level: number | null;
  xp: number | null;
  name_frame: string | null;
  avatar_frame: string | null;
  bubble_frame: string | null;
  profile_frame: string | null;
  selected_bg_id: string | null;
  tribe_id: string | null;
  online_at: string | null;
  created_at: string | null;
};

export async function getProfilesPublic(ids: string[]): Promise<PublicProfile[]> {
  if (!ids.length) return [];
  const { data } = await (supabase as any).rpc("get_profiles_public", { _ids: ids });
  return (data || []) as PublicProfile[];
}

export async function getProfilePublic(id: string): Promise<PublicProfile | null> {
  const list = await getProfilesPublic([id]);
  return list[0] || null;
}

export async function searchProfilesPublic(q: string, limit = 20): Promise<PublicProfile[]> {
  const { data } = await (supabase as any).rpc("search_profiles_public", { _q: q, _limit: limit });
  return (data || []) as PublicProfile[];
}

export async function getOnlinePlayers(limit = 20): Promise<PublicProfile[]> {
  const { data } = await (supabase as any).rpc("get_online_players", { _limit: limit });
  return (data || []) as PublicProfile[];
}
