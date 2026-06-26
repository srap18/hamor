import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ roomId: z.string().uuid(), canPublish: z.boolean().default(false) });

/**
 * Returns a LiveKit access token for a given voice room.
 * If LIVEKIT_* env vars aren't configured yet, returns { configured: false } so the UI can
 * gracefully show "voice coming soon" without breaking the rest of the room.
 */
export const getLivekitToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const url = process.env.LIVEKIT_URL;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!url || !key || !secret) return { configured: false as const };

    // Verify caller is actually a member of the room
    const { data: member } = await context.supabase
      .from("voice_room_members")
      .select("role")
      .eq("room_id", data.roomId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("not_in_room");

    const canPublish = data.canPublish && member.role !== "listener";

    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(key, secret, { identity: context.userId, ttl: 60 * 60 });
    at.addGrant({
      room: data.roomId,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { configured: true as const, token, url };
  });
