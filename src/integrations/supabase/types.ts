export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_links: {
        Row: {
          created_at: string
          details: Json
          id: string
          link_type: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          link_type: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          link_type?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      achievements: {
        Row: {
          active: boolean
          code: string
          description: string
          goal_count: number
          goal_type: string
          icon: string
          id: string
          reward_coins: number
          reward_gems: number
          reward_xp: number
          sort_order: number
          title: string
        }
        Insert: {
          active?: boolean
          code: string
          description?: string
          goal_count?: number
          goal_type: string
          icon?: string
          id?: string
          reward_coins?: number
          reward_gems?: number
          reward_xp?: number
          sort_order?: number
          title: string
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          goal_count?: number
          goal_type?: string
          icon?: string
          id?: string
          reward_coins?: number
          reward_gems?: number
          reward_xp?: number
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      ad_bombs: {
        Row: {
          active: boolean
          attacker_id: string
          created_at: string
          expires_at: string
          id: string
          started_at: string
          target_user_id: string
          video_key: string
        }
        Insert: {
          active?: boolean
          attacker_id: string
          created_at?: string
          expires_at?: string
          id?: string
          started_at?: string
          target_user_id: string
          video_key: string
        }
        Update: {
          active?: boolean
          attacker_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          started_at?: string
          target_user_id?: string
          video_key?: string
        }
        Relationships: []
      }
      admin_audit: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json
          id: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_staff_perms: {
        Row: {
          allowed_paths: string[] | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          allowed_paths?: string[] | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          allowed_paths?: string[] | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      anti_disabled_state: {
        Row: {
          anti_id: string
          disabled_until: string
          user_id: string
        }
        Insert: {
          anti_id: string
          disabled_until: string
          user_id: string
        }
        Update: {
          anti_id?: string
          disabled_until?: string
          user_id?: string
        }
        Relationships: []
      }
      arena_scores: {
        Row: {
          score: number
          updated_at: string
          user_id: string
          week_start: string
          wins: number
        }
        Insert: {
          score?: number
          updated_at?: string
          user_id: string
          week_start: string
          wins?: number
        }
        Update: {
          score?: number
          updated_at?: string
          user_id?: string
          week_start?: string
          wins?: number
        }
        Relationships: []
      }
      arena_settings: {
        Row: {
          enabled: boolean
          event_active: boolean
          event_ends_at: string | null
          event_multiplier: number
          event_title: string | null
          id: boolean
          locked_message: string
          locked_title: string
          rewards: Json
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          event_active?: boolean
          event_ends_at?: string | null
          event_multiplier?: number
          event_title?: string | null
          id?: boolean
          locked_message?: string
          locked_title?: string
          rewards?: Json
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          event_active?: boolean
          event_ends_at?: string | null
          event_multiplier?: number
          event_title?: string | null
          id?: boolean
          locked_message?: string
          locked_title?: string
          rewards?: Json
          updated_at?: string
        }
        Relationships: []
      }
      attacks: {
        Row: {
          attacker_id: string
          attacker_won: boolean | null
          created_at: string
          damage: number
          damage_dealt: number
          defender_id: string
          id: string
          loot_coins: number
          target_ship_id: string | null
        }
        Insert: {
          attacker_id: string
          attacker_won?: boolean | null
          created_at?: string
          damage?: number
          damage_dealt?: number
          defender_id: string
          id?: string
          loot_coins?: number
          target_ship_id?: string | null
        }
        Update: {
          attacker_id?: string
          attacker_won?: boolean | null
          created_at?: string
          damage?: number
          damage_dealt?: number
          defender_id?: string
          id?: string
          loot_coins?: number
          target_ship_id?: string | null
        }
        Relationships: []
      }
      banned_devices: {
        Row: {
          banned_by: string | null
          created_at: string
          device_id: string
          reason: string
          user_id: string | null
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          device_id: string
          reason?: string
          user_id?: string | null
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          device_id?: string
          reason?: string
          user_id?: string | null
        }
        Relationships: []
      }
      banned_emails: {
        Row: {
          banned_by: string | null
          created_at: string
          email: string
          id: string
          reason: string
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          email: string
          id?: string
          reason?: string
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          email?: string
          id?: string
          reason?: string
        }
        Relationships: []
      }
      banned_ips: {
        Row: {
          banned_by: string | null
          created_at: string
          ip: string
          reason: string | null
          user_id: string | null
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          ip: string
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          ip?: string
          reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bans: {
        Row: {
          active: boolean
          banned_at: string
          banned_by: string | null
          expires_at: string | null
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          active?: boolean
          banned_at?: string
          banned_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string
          user_id: string
        }
        Update: {
          active?: boolean
          banned_at?: string
          banned_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      boss_attack_quota: {
        Row: {
          hits_used: number
          reset_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          hits_used?: number
          reset_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          hits_used?: number
          reset_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      boss_hits: {
        Row: {
          boss_id: string
          hit_count: number
          id: string
          loot_claimed: boolean
          total_damage: number
          updated_at: string
          user_id: string
        }
        Insert: {
          boss_id: string
          hit_count?: number
          id?: string
          loot_claimed?: boolean
          total_damage?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          boss_id?: string
          hit_count?: number
          id?: string
          loot_claimed?: boolean
          total_damage?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_action_log: {
        Row: {
          action: string
          at: string
          id: number
          user_id: string
        }
        Insert: {
          action: string
          at?: string
          id?: number
          user_id: string
        }
        Update: {
          action?: string
          at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      chat_moderators: {
        Row: {
          created_at: string
          created_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_mute_devices: {
        Row: {
          active: boolean
          created_at: string
          device_id: string
          expires_at: string | null
          id: string
          mute_id: string | null
          reason: string
          source_user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_id: string
          expires_at?: string | null
          id?: string
          mute_id?: string | null
          reason?: string
          source_user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          device_id?: string
          expires_at?: string | null
          id?: string
          mute_id?: string | null
          reason?: string
          source_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_mute_devices_mute_id_fkey"
            columns: ["mute_id"]
            isOneToOne: false
            referencedRelation: "chat_mutes"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mute_ips: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string | null
          id: string
          ip: string
          mute_id: string | null
          reason: string
          source_user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          ip: string
          mute_id?: string | null
          reason?: string
          source_user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          ip?: string
          mute_id?: string | null
          reason?: string
          source_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_mute_ips_mute_id_fkey"
            columns: ["mute_id"]
            isOneToOne: false
            referencedRelation: "chat_mutes"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mutes: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string | null
          id: string
          muted_by: string | null
          reason: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          muted_by?: string | null
          reason?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          muted_by?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_pinned: {
        Row: {
          body: string
          id: boolean
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          body?: string
          id?: boolean
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          body?: string
          id?: boolean
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: []
      }
      cheat_flags: {
        Row: {
          created_at: string
          details: Json
          id: string
          kind: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: number
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          kind: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: number
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: number
          user_id?: string
        }
        Relationships: []
      }
      client_item_prices: {
        Row: {
          item_id: string
          item_type: string
          price_coins: number
          price_gems: number
        }
        Insert: {
          item_id: string
          item_type: string
          price_coins?: number
          price_gems?: number
        }
        Update: {
          item_id?: string
          item_type?: string
          price_coins?: number
          price_gems?: number
        }
        Relationships: []
      }
      code_redemptions: {
        Row: {
          code_id: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          code_id: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          code_id?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "redemption_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_catches: {
        Row: {
          caught_at: string
          fish_id: string
          id: string
          qty: number
          tribe_id: string | null
          user_id: string
        }
        Insert: {
          caught_at?: string
          fish_id: string
          id?: string
          qty?: number
          tribe_id?: string | null
          user_id: string
        }
        Update: {
          caught_at?: string
          fish_id?: string
          id?: string
          qty?: number
          tribe_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      competitions: {
        Row: {
          active: boolean
          banner_emoji: string
          banner_text: string
          banner_theme: string
          created_at: string
          created_by: string | null
          description: string
          ends_at: string
          hide_target: boolean
          id: string
          metric: string
          prize_tiers: Json
          prizes_distributed_at: string | null
          reward_coins: number
          reward_gems: number
          reward_text: string
          reward_xp: number
          starts_at: string
          target_fish_id: string | null
          title: string
        }
        Insert: {
          active?: boolean
          banner_emoji?: string
          banner_text?: string
          banner_theme?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at: string
          hide_target?: boolean
          id?: string
          metric: string
          prize_tiers?: Json
          prizes_distributed_at?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_text?: string
          reward_xp?: number
          starts_at?: string
          target_fish_id?: string | null
          title: string
        }
        Update: {
          active?: boolean
          banner_emoji?: string
          banner_text?: string
          banner_theme?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string
          hide_target?: boolean
          id?: string
          metric?: string
          prize_tiers?: Json
          prizes_distributed_at?: string | null
          reward_coins?: number
          reward_gems?: number
          reward_text?: string
          reward_xp?: number
          starts_at?: string
          target_fish_id?: string | null
          title?: string
        }
        Relationships: []
      }
      daily_login_streaks: {
        Row: {
          current_streak: number
          last_claim_date: string | null
          total_claims: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          last_claim_date?: string | null
          total_claims?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          last_claim_date?: string | null
          total_claims?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_quests: {
        Row: {
          active: boolean
          created_at: string
          description: string
          goal_count: number
          goal_type: string
          icon: string
          id: string
          reward_coins: number
          reward_gems: number
          reward_xp: number
          title: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          goal_count?: number
          goal_type: string
          icon?: string
          id?: string
          reward_coins?: number
          reward_gems?: number
          reward_xp?: number
          title: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          goal_count?: number
          goal_type?: string
          icon?: string
          id?: string
          reward_coins?: number
          reward_gems?: number
          reward_xp?: number
          title?: string
        }
        Relationships: []
      }
      destroyer_messages: {
        Row: {
          attacker_id: string
          attacker_name: string | null
          created_at: string
          defender_id: string
          id: string
          kind: string
          message: string
        }
        Insert: {
          attacker_id: string
          attacker_name?: string | null
          created_at?: string
          defender_id: string
          id?: string
          kind?: string
          message: string
        }
        Update: {
          attacker_id?: string
          attacker_name?: string | null
          created_at?: string
          defender_id?: string
          id?: string
          kind?: string
          message?: string
        }
        Relationships: []
      }
      device_accounts: {
        Row: {
          created_at: string
          device_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      device_appeals: {
        Row: {
          created_at: string
          email: string | null
          hardware_hash: string
          id: string
          message: string
          next_allowed_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          hardware_hash: string
          id?: string
          message: string
          next_allowed_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          hardware_hash?: string
          id?: string
          message?: string
          next_allowed_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      device_fingerprints: {
        Row: {
          fingerprint_version: number
          first_seen: string
          hardware_hash: string
          last_seen: string
          signals: Json
        }
        Insert: {
          fingerprint_version?: number
          first_seen?: string
          hardware_hash: string
          last_seen?: string
          signals?: Json
        }
        Update: {
          fingerprint_version?: number
          first_seen?: string
          hardware_hash?: string
          last_seen?: string
          signals?: Json
        }
        Relationships: []
      }
      device_history: {
        Row: {
          device_id: string
          first_seen: string
          hits: number
          last_seen: string
          user_id: string
        }
        Insert: {
          device_id: string
          first_seen?: string
          hits?: number
          last_seen?: string
          user_id: string
        }
        Update: {
          device_id?: string
          first_seen?: string
          hits?: number
          last_seen?: string
          user_id?: string
        }
        Relationships: []
      }
      device_slot_audit: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          fingerprint_version: number | null
          hardware_hash: string | null
          id: string
          slot_index: number | null
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          fingerprint_version?: number | null
          hardware_hash?: string | null
          id?: string
          slot_index?: number | null
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          fingerprint_version?: number | null
          hardware_hash?: string | null
          id?: string
          slot_index?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      device_slot_rate_limit: {
        Row: {
          attempt_count: number
          blocked_until: string | null
          hardware_hash: string
          last_attempt_at: string
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          blocked_until?: string | null
          hardware_hash: string
          last_attempt_at?: string
          window_started_at?: string
        }
        Update: {
          attempt_count?: number
          blocked_until?: string | null
          hardware_hash?: string
          last_attempt_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      device_slots: {
        Row: {
          assigned_at: string
          created_at: string
          fingerprint_version: number
          hardware_hash: string
          id: string
          locked_until: string
          slot_index: number
          user_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          fingerprint_version?: number
          hardware_hash: string
          id?: string
          locked_until?: string
          slot_index: number
          user_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          fingerprint_version?: number
          hardware_hash?: string
          id?: string
          locked_until?: string
          slot_index?: number
          user_id?: string
        }
        Relationships: []
      }
      dm_threads: {
        Row: {
          first_message_at: string
          last_request_at: string
          requester_id: string
          responded_at: string | null
          status: string
          user_high: string
          user_low: string
        }
        Insert: {
          first_message_at?: string
          last_request_at?: string
          requester_id: string
          responded_at?: string | null
          status?: string
          user_high: string
          user_low: string
        }
        Update: {
          first_message_at?: string
          last_request_at?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
          user_high?: string
          user_low?: string
        }
        Relationships: []
      }
      dragon_arena_daily: {
        Row: {
          day: string
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          day?: string
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          day?: string
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: []
      }
      dragon_boss_pearl_claims: {
        Row: {
          boss_id: string
          claimed_at: string
          pearls: number
          user_id: string
        }
        Insert: {
          boss_id: string
          claimed_at?: string
          pearls?: number
          user_id: string
        }
        Update: {
          boss_id?: string
          claimed_at?: string
          pearls?: number
          user_id?: string
        }
        Relationships: []
      }
      dragon_claims: {
        Row: {
          last_daily_rockets: string | null
          last_free_strike: string | null
          user_id: string
        }
        Insert: {
          last_daily_rockets?: string | null
          last_free_strike?: string | null
          user_id: string
        }
        Update: {
          last_daily_rockets?: string | null
          last_free_strike?: string | null
          user_id?: string
        }
        Relationships: []
      }
      dragon_equipment: {
        Row: {
          acquired_at: string
          equipped: boolean
          id: string
          name: string
          rarity: string
          slot: string
          smelted: boolean
          stats: Json
          user_id: string
        }
        Insert: {
          acquired_at?: string
          equipped?: boolean
          id?: string
          name: string
          rarity?: string
          slot: string
          smelted?: boolean
          stats?: Json
          user_id: string
        }
        Update: {
          acquired_at?: string
          equipped?: boolean
          id?: string
          name?: string
          rarity?: string
          slot?: string
          smelted?: boolean
          stats?: Json
          user_id?: string
        }
        Relationships: []
      }
      dragons: {
        Row: {
          created_at: string
          daily_arena_date: string | null
          daily_arena_extra_bought: number
          daily_arena_used: number
          dp: number
          element: string
          hatched_at: string | null
          name: string
          pearl_level: number
          pearls: number
          pvp_losses: number
          pvp_wins: number
          stage: number
          total_boss_damage: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_arena_date?: string | null
          daily_arena_extra_bought?: number
          daily_arena_used?: number
          dp?: number
          element?: string
          hatched_at?: string | null
          name?: string
          pearl_level?: number
          pearls?: number
          pvp_losses?: number
          pvp_wins?: number
          stage?: number
          total_boss_damage?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_arena_date?: string | null
          daily_arena_extra_bought?: number
          daily_arena_used?: number
          dp?: number
          element?: string
          hatched_at?: string | null
          name?: string
          pearl_level?: number
          pearls?: number
          pvp_losses?: number
          pvp_wins?: number
          stage?: number
          total_boss_damage?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      economy_audit: {
        Row: {
          changed_at: string
          coins_after: number | null
          coins_before: number | null
          coins_delta: number
          gems_after: number | null
          gems_before: number | null
          gems_delta: number
          id: number
          meta: Json | null
          reason: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          changed_at?: string
          coins_after?: number | null
          coins_before?: number | null
          coins_delta?: number
          gems_after?: number | null
          gems_before?: number | null
          gems_delta?: number
          id?: number
          meta?: Json | null
          reason?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          changed_at?: string
          coins_after?: number | null
          coins_before?: number | null
          coins_delta?: number
          gems_after?: number | null
          gems_before?: number | null
          gems_delta?: number
          id?: number
          meta?: Json | null
          reason?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      economy_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      elite_vip_daily_claims: {
        Row: {
          claim_date: string
          claimed_at: string
          gems: number
          id: string
          level: number
          user_id: string
        }
        Insert: {
          claim_date: string
          claimed_at?: string
          gems: number
          id?: string
          level: number
          user_id: string
        }
        Update: {
          claim_date?: string
          claimed_at?: string
          gems?: number
          id?: string
          level?: number
          user_id?: string
        }
        Relationships: []
      }
      elite_vip_login_broadcasts: {
        Row: {
          avatar_emoji: string | null
          avatar_url: string | null
          created_at: string
          display_name: string
          elite_vip_level: number
          id: string
          user_id: string
        }
        Insert: {
          avatar_emoji?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name: string
          elite_vip_level: number
          id?: string
          user_id: string
        }
        Update: {
          avatar_emoji?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          elite_vip_level?: number
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      elite_vip_tier_config: {
        Row: {
          cashback_pct: number
          combat_bonus_pct: number
          daily_gems: number
          emoji: string
          level: number
          monthly_price_usd: number
          name_ar: string
          name_color: string
          paddle_price_id: string
          shop_discount_pct: number
          updated_at: string
        }
        Insert: {
          cashback_pct?: number
          combat_bonus_pct: number
          daily_gems: number
          emoji: string
          level: number
          monthly_price_usd: number
          name_ar: string
          name_color?: string
          paddle_price_id: string
          shop_discount_pct: number
          updated_at?: string
        }
        Update: {
          cashback_pct?: number
          combat_bonus_pct?: number
          daily_gems?: number
          emoji?: string
          level?: number
          monthly_price_usd?: number
          name_ar?: string
          name_color?: string
          paddle_price_id?: string
          shop_discount_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      events: {
        Row: {
          active: boolean
          banner: string
          coin_multiplier: number
          description: string
          ends_at: string
          id: string
          starts_at: string
          title: string
          xp_multiplier: number
        }
        Insert: {
          active?: boolean
          banner?: string
          coin_multiplier?: number
          description?: string
          ends_at?: string
          id?: string
          starts_at?: string
          title: string
          xp_multiplier?: number
        }
        Update: {
          active?: boolean
          banner?: string
          coin_multiplier?: number
          description?: string
          ends_at?: string
          id?: string
          starts_at?: string
          title?: string
          xp_multiplier?: number
        }
        Relationships: []
      }
      fish_caught: {
        Row: {
          fish_id: string
          id: string
          quantity: number
          total_caught: number
          updated_at: string
          user_id: string
        }
        Insert: {
          fish_id: string
          id?: string
          quantity?: number
          total_caught?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          fish_id?: string
          id?: string
          quantity?: number
          total_caught?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fish_market_prices: {
        Row: {
          current_price: number
          fish_id: string
          forecast: Json
          history: Json
          last_updated: string
          max_price: number
          min_price: number
          trend: number
        }
        Insert: {
          current_price?: number
          fish_id: string
          forecast?: Json
          history?: Json
          last_updated?: string
          max_price?: number
          min_price?: number
          trend?: number
        }
        Update: {
          current_price?: number
          fish_id?: string
          forecast?: Json
          history?: Json
          last_updated?: string
          max_price?: number
          min_price?: number
          trend?: number
        }
        Relationships: []
      }
      fish_price_settings: {
        Row: {
          fish_id: string
          max_hourly_change: number
          max_price: number
          min_price: number
          updated_at: string
        }
        Insert: {
          fish_id: string
          max_hourly_change?: number
          max_price: number
          min_price: number
          updated_at?: string
        }
        Update: {
          fish_id?: string
          max_hourly_change?: number
          max_price?: number
          min_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      fish_ship_max_level: {
        Row: {
          fish_id: string
          max_ship_level: number
          rarity_rank: number
        }
        Insert: {
          fish_id: string
          max_ship_level: number
          rarity_rank?: number
        }
        Update: {
          fish_id?: string
          max_ship_level?: number
          rarity_rank?: number
        }
        Relationships: []
      }
      fish_stock: {
        Row: {
          base_value: number
          caught_at: string
          fish_id: string
          id: string
          quantity: number
          ship_id: string | null
          user_id: string
        }
        Insert: {
          base_value?: number
          caught_at?: string
          fish_id: string
          id?: string
          quantity?: number
          ship_id?: string | null
          user_id: string
        }
        Update: {
          base_value?: number
          caught_at?: string
          fish_id?: string
          id?: string
          quantity?: number
          ship_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fish_stock_audit: {
        Row: {
          changed_at: string
          fish_id: string | null
          fish_stock_id: string | null
          id: number
          meta: Json | null
          op: string
          qty_after: number | null
          qty_before: number | null
          qty_delta: number
          source: string | null
          user_id: string
        }
        Insert: {
          changed_at?: string
          fish_id?: string | null
          fish_stock_id?: string | null
          id?: number
          meta?: Json | null
          op: string
          qty_after?: number | null
          qty_before?: number | null
          qty_delta?: number
          source?: string | null
          user_id: string
        }
        Update: {
          changed_at?: string
          fish_id?: string | null
          fish_stock_id?: string | null
          id?: number
          meta?: Json | null
          op?: string
          qty_after?: number | null
          qty_before?: number | null
          qty_delta?: number
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      forum_bans: {
        Row: {
          banned_by: string | null
          created_at: string
          reason: string
          user_id: string
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          reason?: string
          user_id: string
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      forum_replies: {
        Row: {
          body: string
          created_at: string
          id: string
          topic_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          topic_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_replies_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_topic_votes: {
        Row: {
          created_at: string
          topic_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          topic_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_topic_votes_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_topics: {
        Row: {
          body: string
          created_at: string
          id: string
          replies_count: number
          title: string
          user_id: string
          votes: number
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          replies_count?: number
          title: string
          user_id: string
          votes?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          replies_count?: number
          title?: string
          user_id?: string
          votes?: number
        }
        Relationships: []
      }
      friends: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      global_banners: {
        Row: {
          attacker_id: string | null
          attacker_name: string | null
          created_at: string
          emoji: string | null
          id: string
          kind: string
          message: string | null
          target_id: string | null
          target_name: string | null
          title: string | null
        }
        Insert: {
          attacker_id?: string | null
          attacker_name?: string | null
          created_at?: string
          emoji?: string | null
          id?: string
          kind: string
          message?: string | null
          target_id?: string | null
          target_name?: string | null
          title?: string | null
        }
        Update: {
          attacker_id?: string | null
          attacker_name?: string | null
          created_at?: string
          emoji?: string | null
          id?: string
          kind?: string
          message?: string | null
          target_id?: string | null
          target_name?: string | null
          title?: string | null
        }
        Relationships: []
      }
      global_last_attack: {
        Row: {
          at: string
          attacker_id: string | null
          attacker_name: string | null
          id: boolean
          kind: string | null
          target_id: string | null
          target_name: string | null
        }
        Insert: {
          at?: string
          attacker_id?: string | null
          attacker_name?: string | null
          id?: boolean
          kind?: string | null
          target_id?: string | null
          target_name?: string | null
        }
        Update: {
          at?: string
          attacker_id?: string | null
          attacker_name?: string | null
          id?: boolean
          kind?: string | null
          target_id?: string | null
          target_name?: string | null
        }
        Relationships: []
      }
      golden_fisher_errors: {
        Row: {
          created_at: string
          cycles: number | null
          error: string | null
          exec_ms: number | null
          fish_added: number | null
          id: string
          remaining_storage: number | null
          ship_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          cycles?: number | null
          error?: string | null
          exec_ms?: number | null
          fish_added?: number | null
          id?: string
          remaining_storage?: number | null
          ship_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          cycles?: number | null
          error?: string | null
          exec_ms?: number | null
          fish_added?: number | null
          id?: string
          remaining_storage?: number | null
          ship_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      golden_fisher_rewards: {
        Row: {
          created_at: string
          fish_id: string | null
          qty: number
          reward_slot: number
          ship_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fish_id?: string | null
          qty?: number
          reward_slot: number
          ship_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          fish_id?: string | null
          qty?: number
          reward_slot?: number
          ship_id?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          acquired_at: string
          id: string
          item_id: string
          item_type: string
          meta: Json | null
          quantity: number
          user_id: string
        }
        Insert: {
          acquired_at?: string
          id?: string
          item_id: string
          item_type: string
          meta?: Json | null
          quantity?: number
          user_id: string
        }
        Update: {
          acquired_at?: string
          id?: string
          item_id?: string
          item_type?: string
          meta?: Json | null
          quantity?: number
          user_id?: string
        }
        Relationships: []
      }
      items_catalog: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string
          icon: string
          id: string
          kind: string
          name: string
          price_coins: number
          price_gems: number
          rarity: string
          sort_order: number
          stats: Json
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          kind: string
          name: string
          price_coins?: number
          price_gems?: number
          rarity?: string
          sort_order?: number
          stats?: Json
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          kind?: string
          name?: string
          price_coins?: number
          price_gems?: number
          rarity?: string
          sort_order?: number
          stats?: Json
        }
        Relationships: []
      }
      level_xp_table: {
        Row: {
          cumulative_xp: number
          level: number
          to_next: number
        }
        Insert: {
          cumulative_xp: number
          level: number
          to_next: number
        }
        Update: {
          cumulative_xp?: number
          level?: number
          to_next?: number
        }
        Relationships: []
      }
      lootbox_owned: {
        Row: {
          acquired_at: string
          id: string
          opened: boolean
          reward: Json | null
          type_id: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          id?: string
          opened?: boolean
          reward?: Json | null
          type_id: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          id?: string
          opened?: boolean
          reward?: Json | null
          type_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lootbox_owned_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "lootbox_types"
            referencedColumns: ["id"]
          },
        ]
      }
      lootbox_types: {
        Row: {
          active: boolean
          cost_coins: number
          cost_gems: number
          icon: string
          id: string
          max_coins: number
          max_gems: number
          max_xp: number
          min_coins: number
          min_gems: number
          min_xp: number
          name: string
          rarity: string
        }
        Insert: {
          active?: boolean
          cost_coins?: number
          cost_gems?: number
          icon?: string
          id?: string
          max_coins?: number
          max_gems?: number
          max_xp?: number
          min_coins?: number
          min_gems?: number
          min_xp?: number
          name: string
          rarity?: string
        }
        Update: {
          active?: boolean
          cost_coins?: number
          cost_gems?: number
          icon?: string
          id?: string
          max_coins?: number
          max_gems?: number
          max_xp?: number
          min_coins?: number
          min_gems?: number
          min_xp?: number
          name?: string
          rarity?: string
        }
        Relationships: []
      }
      lucky_box_opens: {
        Row: {
          amount: number
          created_at: string
          icon: string
          id: string
          label: string
          prize_id: string | null
          prize_type: string
          rarity: Database["public"]["Enums"]["lucky_box_rarity"]
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          label: string
          prize_id?: string | null
          prize_type: string
          rarity: Database["public"]["Enums"]["lucky_box_rarity"]
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          label?: string
          prize_id?: string | null
          prize_type?: string
          rarity?: Database["public"]["Enums"]["lucky_box_rarity"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lucky_box_opens_prize_id_fkey"
            columns: ["prize_id"]
            isOneToOne: false
            referencedRelation: "lucky_box_prizes"
            referencedColumns: ["id"]
          },
        ]
      }
      lucky_box_prizes: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          icon: string
          id: string
          item_id: string | null
          item_type: string | null
          label: string
          prize_type: string
          rarity: Database["public"]["Enums"]["lucky_box_rarity"]
          updated_at: string
          weight: number
        }
        Insert: {
          active?: boolean
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          item_id?: string | null
          item_type?: string | null
          label: string
          prize_type: string
          rarity: Database["public"]["Enums"]["lucky_box_rarity"]
          updated_at?: string
          weight?: number
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          icon?: string
          id?: string
          item_id?: string | null
          item_type?: string | null
          label?: string
          prize_type?: string
          rarity?: Database["public"]["Enums"]["lucky_box_rarity"]
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      lucky_box_settings: {
        Row: {
          cost_gems: number
          enabled: boolean
          id: boolean
          pct_common: number
          pct_legendary: number
          pct_rare: number
          updated_at: string
        }
        Insert: {
          cost_gems?: number
          enabled?: boolean
          id?: boolean
          pct_common?: number
          pct_legendary?: number
          pct_rare?: number
          updated_at?: string
        }
        Update: {
          cost_gems?: number
          enabled?: boolean
          id?: boolean
          pct_common?: number
          pct_legendary?: number
          pct_rare?: number
          updated_at?: string
        }
        Relationships: []
      }
      ludo_moves: {
        Row: {
          action: string
          created_at: string
          dice: number | null
          from_pos: number | null
          id: number
          player_id: string
          room_id: string
          seat: number
          to_pos: number | null
          token_idx: number | null
        }
        Insert: {
          action: string
          created_at?: string
          dice?: number | null
          from_pos?: number | null
          id?: number
          player_id: string
          room_id: string
          seat: number
          to_pos?: number | null
          token_idx?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          dice?: number | null
          from_pos?: number | null
          id?: number
          player_id?: string
          room_id?: string
          seat?: number
          to_pos?: number | null
          token_idx?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ludo_moves_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "ludo_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      ludo_players: {
        Row: {
          color: string
          finished_count: number
          id: string
          joined_at: string
          room_id: string
          seat: number
          tokens: Json
          user_id: string
        }
        Insert: {
          color: string
          finished_count?: number
          id?: string
          joined_at?: string
          room_id: string
          seat: number
          tokens?: Json
          user_id: string
        }
        Update: {
          color?: string
          finished_count?: number
          id?: string
          joined_at?: string
          room_id?: string
          seat?: number
          tokens?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ludo_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "ludo_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      ludo_rooms: {
        Row: {
          consecutive_sixes: number
          created_at: string
          current_turn_seat: number
          finished_at: string | null
          host_id: string
          id: string
          last_dice: number | null
          last_roll_at: string | null
          max_players: number
          started_at: string | null
          status: string
          turn_deadline: string | null
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          consecutive_sixes?: number
          created_at?: string
          current_turn_seat?: number
          finished_at?: string | null
          host_id: string
          id?: string
          last_dice?: number | null
          last_roll_at?: string | null
          max_players?: number
          started_at?: string | null
          status?: string
          turn_deadline?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          consecutive_sixes?: number
          created_at?: string
          current_turn_seat?: number
          finished_at?: string | null
          host_id?: string
          id?: string
          last_dice?: number | null
          last_roll_at?: string | null
          max_players?: number
          started_at?: string | null
          status?: string
          turn_deadline?: string | null
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: []
      }
      message_reports: {
        Row: {
          created_at: string
          id: string
          kind: string
          message_body: string
          reason: string | null
          reported_user_id: string
          reporter_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message_body?: string
          reason?: string | null
          reported_user_id: string
          reporter_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message_body?: string
          reason?: string | null
          reported_user_id?: string
          reporter_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id?: string | null
          status?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          audio_duration_ms: number | null
          audio_url: string | null
          body: string
          channel: string
          created_at: string
          id: string
          recipient_id: string | null
          reply_to_body: string | null
          reply_to_id: string | null
          reply_to_name: string | null
          sender_id: string
          tribe_id: string | null
        }
        Insert: {
          audio_duration_ms?: number | null
          audio_url?: string | null
          body: string
          channel: string
          created_at?: string
          id?: string
          recipient_id?: string | null
          reply_to_body?: string | null
          reply_to_id?: string | null
          reply_to_name?: string | null
          sender_id: string
          tribe_id?: string | null
        }
        Update: {
          audio_duration_ms?: number | null
          audio_url?: string | null
          body?: string
          channel?: string
          created_at?: string
          id?: string
          recipient_id?: string | null
          reply_to_body?: string | null
          reply_to_id?: string | null
          reply_to_name?: string | null
          sender_id?: string
          tribe_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          meta: Json | null
          recipient_id: string | null
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          recipient_id?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          recipient_id?: string | null
          title?: string
        }
        Relationships: []
      }
      paddle_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          environment: string
          granted: boolean
          granted_at: string | null
          granted_coins: number
          granted_gems: number
          granted_rubies: number
          granted_shield_days: number
          granted_vip_days: number
          id: string
          pack_id: string
          paddle_transaction_id: string
          refund_banned_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          environment?: string
          granted?: boolean
          granted_at?: string | null
          granted_coins?: number
          granted_gems?: number
          granted_rubies?: number
          granted_shield_days?: number
          granted_vip_days?: number
          id?: string
          pack_id: string
          paddle_transaction_id: string
          refund_banned_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          environment?: string
          granted?: boolean
          granted_at?: string | null
          granted_coins?: number
          granted_gems?: number
          granted_rubies?: number
          granted_shield_days?: number
          granted_vip_days?: number
          id?: string
          pack_id?: string
          paddle_transaction_id?: string
          refund_banned_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      play_products: {
        Row: {
          created_at: string
          default_currency: string
          description_ar: string
          description_en: string
          id: string
          price_micros: number
          product_type: string
          rewards: Json
          sku: string
          status: string
          sync_error: string | null
          sync_status: string
          synced_at: string | null
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          description_ar?: string
          description_en?: string
          id?: string
          price_micros: number
          product_type?: string
          rewards?: Json
          sku: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          description_ar?: string
          description_en?: string
          id?: string
          price_micros?: number
          product_type?: string
          rewards?: Json
          sku?: string
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      play_rtdn_events: {
        Row: {
          created_at: string
          error: string | null
          id: string
          message_id: string
          notification_type: string | null
          processed: boolean
          processed_at: string | null
          purchase_token: string | null
          raw: Json
          sku: string | null
          subscription_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          message_id: string
          notification_type?: string | null
          processed?: boolean
          processed_at?: string | null
          purchase_token?: string | null
          raw: Json
          sku?: string | null
          subscription_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          message_id?: string
          notification_type?: string | null
          processed?: boolean
          processed_at?: string | null
          purchase_token?: string | null
          raw?: Json
          sku?: string | null
          subscription_id?: string | null
        }
        Relationships: []
      }
      play_sync_config: {
        Row: {
          apikey: string
          id: number
          updated_at: string
          webhook_url: string
        }
        Insert: {
          apikey: string
          id?: number
          updated_at?: string
          webhook_url: string
        }
        Update: {
          apikey?: string
          id?: number
          updated_at?: string
          webhook_url?: string
        }
        Relationships: []
      }
      player_daughter: {
        Row: {
          created_at: string
          feed_count_today: number
          feed_day: string | null
          feed_xp: number
          last_fed_at: string | null
          name: string
          outfit: string
          stage: number
          total_fish_fed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feed_count_today?: number
          feed_day?: string | null
          feed_xp?: number
          last_fed_at?: string | null
          name?: string
          outfit?: string
          stage?: number
          total_fish_fed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feed_count_today?: number
          feed_day?: string | null
          feed_xp?: number
          last_fed_at?: string | null
          name?: string
          outfit?: string
          stage?: number
          total_fish_fed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      polar_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          environment: string
          granted_at: string | null
          id: string
          pack_id: string
          polar_checkout_id: string
          polar_order_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          environment?: string
          granted_at?: string | null
          id?: string
          pack_id: string
          polar_checkout_id: string
          polar_order_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          environment?: string
          granted_at?: string | null
          id?: string
          pack_id?: string
          polar_checkout_id?: string
          polar_order_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profanity_warnings: {
        Row: {
          body: string
          created_at: string
          id: string
          matched_word: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          matched_word?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          matched_word?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profanity_words: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          word: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          word: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          word?: string
        }
        Relationships: []
      }
      profile_media: {
        Row: {
          caption: string
          created_at: string
          duration_ms: number | null
          id: string
          media_type: string
          media_url: string
          thumbnail_url: string | null
          user_id: string
        }
        Insert: {
          caption?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          media_type: string
          media_url: string
          thumbnail_url?: string | null
          user_id: string
        }
        Update: {
          caption?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          media_type?: string
          media_url?: string
          thumbnail_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_session_id: string | null
          active_session_ip: string | null
          active_session_started_at: string | null
          active_session_ua: string | null
          album_privacy: string
          armor_last_bought_at: string | null
          avatar_emoji: string
          avatar_frame: string | null
          avatar_url: string | null
          bg_burned_until: string | null
          bio: string
          bubble_frame: string | null
          coins: number
          created_at: string
          display_name: string
          display_name_changed_at: string | null
          elite_vip_expires_at: string | null
          elite_vip_level: number
          elite_vip_login_broadcast_enabled: boolean
          friend_requests_closed: boolean
          gems: number
          golden_fisher_last_activated_at: string | null
          golden_fisher_no_shield: boolean
          golden_fisher_paused: boolean
          golden_fisher_until: string | null
          id: string
          last_destroyer_at: string | null
          last_destroyer_id: string | null
          last_destroyer_kind: string | null
          last_destroyer_message: string | null
          last_destroyer_name: string | null
          level: number
          market_expert_until: string | null
          media_banned: boolean
          name_frame: string | null
          online_at: string
          profile_frame: string | null
          protection_until: string | null
          purchases_blocked: boolean
          referral_code: string | null
          referral_locked_at: string | null
          referred_by: string | null
          reports_disabled: boolean
          rubies: number
          selected_bg_id: string
          shield_cooldown_until: string | null
          ship_flag: string
          skill_def: number
          skill_fish: number
          skill_luck: number
          skill_points: number
          skill_speed: number
          skill_str: number
          steal_blocked_until: string | null
          total_damage_dealt: number
          tribe_gems: number
          tribe_id: string | null
          username: string
          username_changed_at: string | null
          vip_expires_at: string | null
          vip_level: number
          vip_points: number
          vip_subs_claimed: number
          weekly_xp: number
          xp: number
          xp_today: number
          xp_today_date: string | null
        }
        Insert: {
          active_session_id?: string | null
          active_session_ip?: string | null
          active_session_started_at?: string | null
          active_session_ua?: string | null
          album_privacy?: string
          armor_last_bought_at?: string | null
          avatar_emoji?: string
          avatar_frame?: string | null
          avatar_url?: string | null
          bg_burned_until?: string | null
          bio?: string
          bubble_frame?: string | null
          coins?: number
          created_at?: string
          display_name: string
          display_name_changed_at?: string | null
          elite_vip_expires_at?: string | null
          elite_vip_level?: number
          elite_vip_login_broadcast_enabled?: boolean
          friend_requests_closed?: boolean
          gems?: number
          golden_fisher_last_activated_at?: string | null
          golden_fisher_no_shield?: boolean
          golden_fisher_paused?: boolean
          golden_fisher_until?: string | null
          id: string
          last_destroyer_at?: string | null
          last_destroyer_id?: string | null
          last_destroyer_kind?: string | null
          last_destroyer_message?: string | null
          last_destroyer_name?: string | null
          level?: number
          market_expert_until?: string | null
          media_banned?: boolean
          name_frame?: string | null
          online_at?: string
          profile_frame?: string | null
          protection_until?: string | null
          purchases_blocked?: boolean
          referral_code?: string | null
          referral_locked_at?: string | null
          referred_by?: string | null
          reports_disabled?: boolean
          rubies?: number
          selected_bg_id?: string
          shield_cooldown_until?: string | null
          ship_flag?: string
          skill_def?: number
          skill_fish?: number
          skill_luck?: number
          skill_points?: number
          skill_speed?: number
          skill_str?: number
          steal_blocked_until?: string | null
          total_damage_dealt?: number
          tribe_gems?: number
          tribe_id?: string | null
          username: string
          username_changed_at?: string | null
          vip_expires_at?: string | null
          vip_level?: number
          vip_points?: number
          vip_subs_claimed?: number
          weekly_xp?: number
          xp?: number
          xp_today?: number
          xp_today_date?: string | null
        }
        Update: {
          active_session_id?: string | null
          active_session_ip?: string | null
          active_session_started_at?: string | null
          active_session_ua?: string | null
          album_privacy?: string
          armor_last_bought_at?: string | null
          avatar_emoji?: string
          avatar_frame?: string | null
          avatar_url?: string | null
          bg_burned_until?: string | null
          bio?: string
          bubble_frame?: string | null
          coins?: number
          created_at?: string
          display_name?: string
          display_name_changed_at?: string | null
          elite_vip_expires_at?: string | null
          elite_vip_level?: number
          elite_vip_login_broadcast_enabled?: boolean
          friend_requests_closed?: boolean
          gems?: number
          golden_fisher_last_activated_at?: string | null
          golden_fisher_no_shield?: boolean
          golden_fisher_paused?: boolean
          golden_fisher_until?: string | null
          id?: string
          last_destroyer_at?: string | null
          last_destroyer_id?: string | null
          last_destroyer_kind?: string | null
          last_destroyer_message?: string | null
          last_destroyer_name?: string | null
          level?: number
          market_expert_until?: string | null
          media_banned?: boolean
          name_frame?: string | null
          online_at?: string
          profile_frame?: string | null
          protection_until?: string | null
          purchases_blocked?: boolean
          referral_code?: string | null
          referral_locked_at?: string | null
          referred_by?: string | null
          reports_disabled?: boolean
          rubies?: number
          selected_bg_id?: string
          shield_cooldown_until?: string | null
          ship_flag?: string
          skill_def?: number
          skill_fish?: number
          skill_luck?: number
          skill_points?: number
          skill_speed?: number
          skill_str?: number
          steal_blocked_until?: string | null
          total_damage_dealt?: number
          tribe_gems?: number
          tribe_id?: string | null
          username?: string
          username_changed_at?: string | null
          vip_expires_at?: string | null
          vip_level?: number
          vip_points?: number
          vip_subs_claimed?: number
          weekly_xp?: number
          xp?: number
          xp_today?: number
          xp_today_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tribe_fk"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_progress: {
        Row: {
          claimed: boolean
          day_key: string
          id: string
          progress: number
          quest_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claimed?: boolean
          day_key: string
          id?: string
          progress?: number
          quest_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claimed?: boolean
          day_key?: string
          id?: string
          progress?: number
          quest_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quest_progress_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "daily_quests"
            referencedColumns: ["id"]
          },
        ]
      }
      redemption_codes: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          extra_rewards: Json
          id: string
          item_id: string | null
          item_kind: string | null
          max_uses: number
          note: string
          quantity: number
          reward_coins: number
          reward_elite_vip_days: number
          reward_elite_vip_level: number
          reward_gems: number
          reward_type: string
          reward_vip_days: number
          reward_vip_level: number
          reward_xp: number
          uses_count: number
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          extra_rewards?: Json
          id?: string
          item_id?: string | null
          item_kind?: string | null
          max_uses?: number
          note?: string
          quantity?: number
          reward_coins?: number
          reward_elite_vip_days?: number
          reward_elite_vip_level?: number
          reward_gems?: number
          reward_type: string
          reward_vip_days?: number
          reward_vip_level?: number
          reward_xp?: number
          uses_count?: number
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          extra_rewards?: Json
          id?: string
          item_id?: string | null
          item_kind?: string | null
          max_uses?: number
          note?: string
          quantity?: number
          reward_coins?: number
          reward_elite_vip_days?: number
          reward_elite_vip_level?: number
          reward_gems?: number
          reward_type?: string
          reward_vip_days?: number
          reward_vip_level?: number
          reward_xp?: number
          uses_count?: number
        }
        Relationships: []
      }
      referral_blocked_attempts: {
        Row: {
          created_at: string
          id: string
          invitee_id: string
          inviter_id: string
          matched_value: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          id?: string
          invitee_id: string
          inviter_id: string
          matched_value?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          id?: string
          invitee_id?: string
          inviter_id?: string
          matched_value?: string | null
          reason?: string
        }
        Relationships: []
      }
      referral_earnings: {
        Row: {
          amount_cents: number
          created_at: string
          gems_awarded: number
          id: string
          invitee_id: string
          inviter_id: string
          kind: string
          note: string | null
          txn_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          gems_awarded?: number
          id?: string
          invitee_id: string
          inviter_id: string
          kind?: string
          note?: string | null
          txn_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          gems_awarded?: number
          id?: string
          invitee_id?: string
          inviter_id?: string
          kind?: string
          note?: string | null
          txn_id?: string
        }
        Relationships: []
      }
      royal_box_claims: {
        Row: {
          claim_date: string
          contents: Json
          id: string
          user_id: string
        }
        Insert: {
          claim_date: string
          contents?: Json
          id?: string
          user_id: string
        }
        Update: {
          claim_date?: string
          contents?: Json
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      shield_type_activations: {
        Row: {
          item_id: string
          last_activated_at: string
          user_id: string
        }
        Insert: {
          item_id: string
          last_activated_at?: string
          user_id: string
        }
        Update: {
          item_id?: string
          last_activated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ship_catalog: {
        Row: {
          active: boolean
          armor: number
          attack_power: number
          code: string
          created_at: string
          description: string
          fish_pool: Json
          fishing_power: number
          fishing_seconds: number
          id: string
          image_url: string | null
          market_level_required: number
          max_hp: number
          name: string
          price_coins: number
          price_gems: number
          price_tribe_gems: number
          rarity: string
          repair_seconds: number
          sort_order: number
          speed: number
          storage: number
          tribe_only: boolean
        }
        Insert: {
          active?: boolean
          armor?: number
          attack_power?: number
          code: string
          created_at?: string
          description?: string
          fish_pool?: Json
          fishing_power?: number
          fishing_seconds?: number
          id?: string
          image_url?: string | null
          market_level_required?: number
          max_hp?: number
          name: string
          price_coins?: number
          price_gems?: number
          price_tribe_gems?: number
          rarity?: string
          repair_seconds?: number
          sort_order?: number
          speed?: number
          storage?: number
          tribe_only?: boolean
        }
        Update: {
          active?: boolean
          armor?: number
          attack_power?: number
          code?: string
          created_at?: string
          description?: string
          fish_pool?: Json
          fishing_power?: number
          fishing_seconds?: number
          id?: string
          image_url?: string | null
          market_level_required?: number
          max_hp?: number
          name?: string
          price_coins?: number
          price_gems?: number
          price_tribe_gems?: number
          rarity?: string
          repair_seconds?: number
          sort_order?: number
          speed?: number
          storage?: number
          tribe_only?: boolean
        }
        Relationships: []
      }
      ship_listings: {
        Row: {
          buyer_id: string | null
          created_at: string
          id: string
          price: number
          seller_id: string
          ship_id: string
          sold_at: string | null
          status: string
          template_id: number
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          price: number
          seller_id: string
          ship_id: string
          sold_at?: string | null
          status?: string
          template_id: number
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          id?: string
          price?: number
          seller_id?: string
          ship_id?: string
          sold_at?: string | null
          status?: string
          template_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ship_listings_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_listings_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_listings_ship_id_fkey"
            columns: ["ship_id"]
            isOneToOne: true
            referencedRelation: "ships_owned"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ship_listings_ship_id_fkey"
            columns: ["ship_id"]
            isOneToOne: true
            referencedRelation: "ships_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ship_overrides: {
        Row: {
          level: number
          overrides: Json
          updated_at: string
        }
        Insert: {
          level: number
          overrides?: Json
          updated_at?: string
        }
        Update: {
          level?: number
          overrides?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ship_slot_layout: {
        Row: {
          bg_id: string
          left_pct: number
          mode: string
          scale: number
          slot_index: number
          top_pct: number
          updated_at: string
        }
        Insert: {
          bg_id: string
          left_pct: number
          mode: string
          scale?: number
          slot_index: number
          top_pct: number
          updated_at?: string
        }
        Update: {
          bg_id?: string
          left_pct?: number
          mode?: string
          scale?: number
          slot_index?: number
          top_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      ships_owned: {
        Row: {
          acquired_at: string
          at_sea: boolean
          catalog_code: string | null
          destroyed_at: string | null
          fishing_started_at: string | null
          hp: number
          id: string
          in_storage: boolean
          last_fishing_reward_at: string | null
          max_hp: number
          max_stars: number
          preferred_fish_id: string | null
          repair_ends_at: string | null
          source_txn_id: string | null
          stars: number
          stealing_ends_at: string | null
          stealing_started_at: string | null
          stealing_target_ship_id: string | null
          stealing_target_user_id: string | null
          template_id: number
          user_id: string
        }
        Insert: {
          acquired_at?: string
          at_sea?: boolean
          catalog_code?: string | null
          destroyed_at?: string | null
          fishing_started_at?: string | null
          hp?: number
          id?: string
          in_storage?: boolean
          last_fishing_reward_at?: string | null
          max_hp?: number
          max_stars?: number
          preferred_fish_id?: string | null
          repair_ends_at?: string | null
          source_txn_id?: string | null
          stars?: number
          stealing_ends_at?: string | null
          stealing_started_at?: string | null
          stealing_target_ship_id?: string | null
          stealing_target_user_id?: string | null
          template_id: number
          user_id: string
        }
        Update: {
          acquired_at?: string
          at_sea?: boolean
          catalog_code?: string | null
          destroyed_at?: string | null
          fishing_started_at?: string | null
          hp?: number
          id?: string
          in_storage?: boolean
          last_fishing_reward_at?: string | null
          max_hp?: number
          max_stars?: number
          preferred_fish_id?: string | null
          repair_ends_at?: string | null
          source_txn_id?: string | null
          stars?: number
          stealing_ends_at?: string | null
          stealing_started_at?: string | null
          stealing_target_ship_id?: string | null
          stealing_target_user_id?: string | null
          template_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ships_owned_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ships_owned_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_orders: {
        Row: {
          amount_usd: number | null
          created_at: string
          error: string | null
          id: string
          pack_id: string | null
          processed_at: string | null
          raw_payload: Json | null
          shopify_order_id: number
          shopify_order_name: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          pack_id?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
          shopify_order_id: number
          shopify_order_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          pack_id?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
          shopify_order_id?: number
          shopify_order_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      shopify_products: {
        Row: {
          created_at: string
          id: string
          pack_id: string
          price_usd: number
          shopify_product_id: number
          shopify_variant_id: number
          updated_at: string
          variant_gid: string
        }
        Insert: {
          created_at?: string
          id?: string
          pack_id: string
          price_usd: number
          shopify_product_id: number
          shopify_variant_id: number
          updated_at?: string
          variant_gid: string
        }
        Update: {
          created_at?: string
          id?: string
          pack_id?: string
          price_usd?: number
          shopify_product_id?: number
          shopify_variant_id?: number
          updated_at?: string
          variant_gid?: string
        }
        Relationships: []
      }
      sign_slot_layout: {
        Row: {
          bg_id: string
          left_pct: number
          top_pct: number
          updated_at: string
          width_pct: number
        }
        Insert: {
          bg_id: string
          left_pct?: number
          top_pct?: number
          updated_at?: string
          width_pct?: number
        }
        Update: {
          bg_id?: string
          left_pct?: number
          top_pct?: number
          updated_at?: string
          width_pct?: number
        }
        Relationships: []
      }
      site_layout: {
        Row: {
          key: string
          position: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          position: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          position?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      stripe_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          granted: boolean
          granted_at: string | null
          id: string
          pack_id: string
          status: string
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          pack_id: string
          status?: string
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          pack_id?: string
          status?: string
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id?: string
          paddle_subscription_id?: string
          price_id?: string
          product_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_gifts: {
        Row: {
          amount: number
          claimed: boolean
          created_at: string
          id: string
          kind: string
          message: string
          recipient_id: string
          sender_id: string
          ship_id: string | null
        }
        Insert: {
          amount?: number
          claimed?: boolean
          created_at?: string
          id?: string
          kind: string
          message?: string
          recipient_id: string
          sender_id: string
          ship_id?: string | null
        }
        Update: {
          amount?: number
          claimed?: boolean
          created_at?: string
          id?: string
          kind?: string
          message?: string
          recipient_id?: string
          sender_id?: string
          ship_id?: string | null
        }
        Relationships: []
      }
      support_ticket_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          is_admin: boolean
          sender_id: string
          ticket_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_admin?: boolean
          sender_id: string
          ticket_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_admin?: boolean
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_note: string | null
          category: string
          created_at: string
          id: string
          image_path: string | null
          message: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          category: string
          created_at?: string
          id?: string
          image_path?: string | null
          message: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          created_at?: string
          id?: string
          image_path?: string | null
          message?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      transaction_logs: {
        Row: {
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          item_id: string | null
          kind: string
          meta: Json | null
          quantity: number
          total_amount: number
          unit_price: number
          user_id: string
        }
        Insert: {
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          item_id?: string | null
          kind: string
          meta?: Json | null
          quantity?: number
          total_amount?: number
          unit_price?: number
          user_id: string
        }
        Update: {
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          item_id?: string | null
          kind?: string
          meta?: Json | null
          quantity?: number
          total_amount?: number
          unit_price?: number
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          kind: string
          meta: Json | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          kind: string
          meta?: Json | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          meta?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_achievements: {
        Row: {
          code: string
          description: string | null
          earned_at: string
          emoji: string | null
          id: string
          title: string
          tribe_id: string
        }
        Insert: {
          code: string
          description?: string | null
          earned_at?: string
          emoji?: string | null
          id?: string
          title: string
          tribe_id: string
        }
        Update: {
          code?: string
          description?: string | null
          earned_at?: string
          emoji?: string | null
          id?: string
          title?: string
          tribe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_achievements_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_donations: {
        Row: {
          amount: number
          created_at: string
          id: string
          tribe_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          tribe_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          tribe_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tribe_enemies: {
        Row: {
          added_by: string
          created_at: string
          enemy_tribe_id: string
          id: string
          note: string | null
          tribe_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          enemy_tribe_id: string
          id?: string
          note?: string | null
          tribe_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          enemy_tribe_id?: string
          id?: string
          note?: string | null
          tribe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_enemies_enemy_tribe_id_fkey"
            columns: ["enemy_tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tribe_enemies_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_enemy_players: {
        Row: {
          added_by: string
          created_at: string
          enemy_user_id: string
          id: string
          reason: string | null
          tribe_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          enemy_user_id: string
          id?: string
          reason?: string | null
          tribe_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          enemy_user_id?: string
          id?: string
          reason?: string | null
          tribe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_enemy_players_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_fish_event_gold: {
        Row: {
          amount: number
          created_at: string
          event_id: string
          id: string
          tribe_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          event_id: string
          id?: string
          tribe_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          tribe_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_fish_event_gold_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "tribe_fish_events"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_fish_events: {
        Row: {
          active: boolean
          banner_emoji: string
          banner_theme: string
          created_at: string
          created_by: string | null
          description: string
          ends_at: string
          id: string
          metric: string
          prize_tiers: Json
          prizes_distributed_at: string | null
          reward_gems: number
          starts_at: string
          title: string
          winner_tribe_id: string | null
          winner_tribe_points: number
        }
        Insert: {
          active?: boolean
          banner_emoji?: string
          banner_theme?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at: string
          id?: string
          metric?: string
          prize_tiers?: Json
          prizes_distributed_at?: string | null
          reward_gems?: number
          starts_at?: string
          title: string
          winner_tribe_id?: string | null
          winner_tribe_points?: number
        }
        Update: {
          active?: boolean
          banner_emoji?: string
          banner_theme?: string
          created_at?: string
          created_by?: string | null
          description?: string
          ends_at?: string
          id?: string
          metric?: string
          prize_tiers?: Json
          prizes_distributed_at?: string | null
          reward_gems?: number
          starts_at?: string
          title?: string
          winner_tribe_id?: string | null
          winner_tribe_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "tribe_fish_events_winner_tribe_id_fkey"
            columns: ["winner_tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_gem_daily: {
        Row: {
          day: string
          donation_gems: number
          pvp_wins: number
          ship_kills: number
          user_id: string
        }
        Insert: {
          day: string
          donation_gems?: number
          pvp_wins?: number
          ship_kills?: number
          user_id: string
        }
        Update: {
          day?: string
          donation_gems?: number
          pvp_wins?: number
          ship_kills?: number
          user_id?: string
        }
        Relationships: []
      }
      tribe_join_requests: {
        Row: {
          created_at: string
          id: string
          status: string
          tribe_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          tribe_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          tribe_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tribe_members: {
        Row: {
          donation_coins: number
          joined_at: string
          last_donation_at: string | null
          role: string
          tribe_id: string
          user_id: string
        }
        Insert: {
          donation_coins?: number
          joined_at?: string
          last_donation_at?: string | null
          role?: string
          tribe_id: string
          user_id: string
        }
        Update: {
          donation_coins?: number
          joined_at?: string
          last_donation_at?: string | null
          role?: string
          tribe_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tribe_members_tribe_id_fkey"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tribe_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tribe_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tribe_wars: {
        Row: {
          created_at: string
          declarer_id: string
          declarer_tribe_id: string | null
          ended_at: string | null
          id: string
          message: string
          status: string
          target_id: string
          target_tribe_id: string | null
        }
        Insert: {
          created_at?: string
          declarer_id: string
          declarer_tribe_id?: string | null
          ended_at?: string | null
          id?: string
          message?: string
          status?: string
          target_id: string
          target_tribe_id?: string | null
        }
        Update: {
          created_at?: string
          declarer_id?: string
          declarer_tribe_id?: string | null
          ended_at?: string | null
          id?: string
          message?: string
          status?: string
          target_id?: string
          target_tribe_id?: string | null
        }
        Relationships: []
      }
      tribes: {
        Row: {
          banner: string
          created_at: string
          description: string
          emblem: string
          id: string
          join_mode: string
          level: number
          name: string
          overflow_warning_until: string | null
          owner_id: string
          points: number
          total_donations: number
          treasure_coins: number
          treasure_tribe_gems: number
        }
        Insert: {
          banner?: string
          created_at?: string
          description?: string
          emblem?: string
          id?: string
          join_mode?: string
          level?: number
          name: string
          overflow_warning_until?: string | null
          owner_id: string
          points?: number
          total_donations?: number
          treasure_coins?: number
          treasure_tribe_gems?: number
        }
        Update: {
          banner?: string
          created_at?: string
          description?: string
          emblem?: string
          id?: string
          join_mode?: string
          level?: number
          name?: string
          overflow_warning_until?: string | null
          owner_id?: string
          points?: number
          total_donations?: number
          treasure_coins?: number
          treasure_tribe_gems?: number
        }
        Relationships: [
          {
            foreignKeyName: "tribes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tribes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      unmapped_payments: {
        Row: {
          amount_cents: number
          created_at: string
          email: string | null
          environment: string
          id: string
          pack_id_hint: string | null
          paddle_transaction_id: string
          raw: Json | null
          reason: string
          resolved: boolean
          resolved_at: string | null
          user_id_hint: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          email?: string | null
          environment: string
          id?: string
          pack_id_hint?: string | null
          paddle_transaction_id: string
          raw?: Json | null
          reason: string
          resolved?: boolean
          resolved_at?: string | null
          user_id_hint?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          email?: string | null
          environment?: string
          id?: string
          pack_id_hint?: string | null
          paddle_transaction_id?: string
          raw?: Json | null
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          user_id_hint?: string | null
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          claimed: boolean
          progress: number
          unlocked_at: string | null
          user_id: string
        }
        Insert: {
          achievement_id: string
          claimed?: boolean
          progress?: number
          unlocked_at?: string | null
          user_id: string
        }
        Update: {
          achievement_id?: string
          claimed?: boolean
          progress?: number
          unlocked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_action_throttle: {
        Row: {
          action: string
          last_at: string
          user_id: string
        }
        Insert: {
          action: string
          last_at?: string
          user_id: string
        }
        Update: {
          action?: string
          last_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_enemies: {
        Row: {
          created_at: string
          enemy_id: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          enemy_id: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          enemy_id?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_fish_market: {
        Row: {
          created_at: string
          level: number
          updated_at: string
          upgrade_cost_coins: number | null
          upgrade_ends_at: string | null
          upgrade_started_at: string | null
          upgrading_to: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          level?: number
          updated_at?: string
          upgrade_cost_coins?: number | null
          upgrade_ends_at?: string | null
          upgrade_started_at?: string | null
          upgrading_to?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          level?: number
          updated_at?: string
          upgrade_cost_coins?: number | null
          upgrade_ends_at?: string | null
          upgrade_started_at?: string | null
          upgrading_to?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_ips: {
        Row: {
          first_seen: string
          hits: number
          ip: string
          last_seen: string
          user_id: string
        }
        Insert: {
          first_seen?: string
          hits?: number
          ip: string
          last_seen?: string
          user_id: string
        }
        Update: {
          first_seen?: string
          hits?: number
          ip?: string
          last_seen?: string
          user_id?: string
        }
        Relationships: []
      }
      user_layout: {
        Row: {
          key: string
          position: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          key: string
          position: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          key?: string
          position?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_market: {
        Row: {
          created_at: string
          level: number
          updated_at: string
          upgrade_cost_coins: number | null
          upgrade_ends_at: string | null
          upgrade_started_at: string | null
          upgrading_to: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          level?: number
          updated_at?: string
          upgrade_cost_coins?: number | null
          upgrade_ends_at?: string | null
          upgrade_started_at?: string | null
          upgrading_to?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          level?: number
          updated_at?: string
          upgrade_cost_coins?: number | null
          upgrade_ends_at?: string | null
          upgrade_started_at?: string | null
          upgrading_to?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_market_state: {
        Row: {
          freeze_started_at: string | null
          freeze_until: string | null
          frozen_prices: Json
          rot_freeze_offset_seconds: number
          trader_anchor: string | null
          trader_snapshot: Json
          trader_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          freeze_started_at?: string | null
          freeze_until?: string | null
          frozen_prices?: Json
          rot_freeze_offset_seconds?: number
          trader_anchor?: string | null
          trader_snapshot?: Json
          trader_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          freeze_started_at?: string | null
          freeze_until?: string | null
          frozen_prices?: Json
          rot_freeze_offset_seconds?: number
          trader_anchor?: string | null
          trader_snapshot?: Json
          trader_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vip_daily_claims: {
        Row: {
          claim_date: string
          claimed_at: string
          gems_awarded: number
          id: string
          user_id: string
          vip_level: number
        }
        Insert: {
          claim_date: string
          claimed_at?: string
          gems_awarded: number
          id?: string
          user_id: string
          vip_level: number
        }
        Update: {
          claim_date?: string
          claimed_at?: string
          gems_awarded?: number
          id?: string
          user_id?: string
          vip_level?: number
        }
        Relationships: []
      }
      vip_shield_claims: {
        Row: {
          claim_date: string
          id: string
          shields_awarded: number
          user_id: string
          vip_level: number
        }
        Insert: {
          claim_date: string
          id?: string
          shields_awarded?: number
          user_id: string
          vip_level: number
        }
        Update: {
          claim_date?: string
          id?: string
          shields_awarded?: number
          user_id?: string
          vip_level?: number
        }
        Relationships: []
      }
      weapons_catalog: {
        Row: {
          aoe: boolean
          created_at: string
          damage: number
          id: string
          updated_at: string
          xp: number
        }
        Insert: {
          aoe?: boolean
          created_at?: string
          damage: number
          id: string
          updated_at?: string
          xp?: number
        }
        Update: {
          aoe?: boolean
          created_at?: string
          damage?: number
          id?: string
          updated_at?: string
          xp?: number
        }
        Relationships: []
      }
      weekly_xp_config: {
        Row: {
          description: string
          enabled: boolean
          id: boolean
          last_distributed_at: string | null
          prize_tiers: Json
          title: string
          updated_at: string
          week_started_at: string
        }
        Insert: {
          description?: string
          enabled?: boolean
          id?: boolean
          last_distributed_at?: string | null
          prize_tiers?: Json
          title?: string
          updated_at?: string
          week_started_at?: string
        }
        Update: {
          description?: string
          enabled?: boolean
          id?: boolean
          last_distributed_at?: string | null
          prize_tiers?: Json
          title?: string
          updated_at?: string
          week_started_at?: string
        }
        Relationships: []
      }
      weekly_xp_history: {
        Row: {
          created_at: string
          id: string
          week_ended_at: string
          week_started_at: string
          winners: Json
        }
        Insert: {
          created_at?: string
          id?: string
          week_ended_at?: string
          week_started_at: string
          winners?: Json
        }
        Update: {
          created_at?: string
          id?: string
          week_ended_at?: string
          week_started_at?: string
          winners?: Json
        }
        Relationships: []
      }
      world_boss: {
        Row: {
          created_at: string
          defeated_at: string | null
          defeated_by: string | null
          expires_at: string
          hp_current: number
          hp_max: number
          id: string
          loot_distributed: boolean
          name: string
          spawned_at: string
        }
        Insert: {
          created_at?: string
          defeated_at?: string | null
          defeated_by?: string | null
          expires_at?: string
          hp_current?: number
          hp_max?: number
          id?: string
          loot_distributed?: boolean
          name?: string
          spawned_at?: string
        }
        Update: {
          created_at?: string
          defeated_at?: string | null
          defeated_by?: string | null
          expires_at?: string
          hp_current?: number
          hp_max?: number
          id?: string
          loot_distributed?: boolean
          name?: string
          spawned_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_emoji: string | null
          avatar_frame: string | null
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          level: number | null
          name_frame: string | null
          online_at: string | null
          selected_bg_id: string | null
          tribe_id: string | null
        }
        Insert: {
          avatar_emoji?: string | null
          avatar_frame?: string | null
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          level?: number | null
          name_frame?: string | null
          online_at?: string | null
          selected_bg_id?: string | null
          tribe_id?: string | null
        }
        Update: {
          avatar_emoji?: string | null
          avatar_frame?: string | null
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          level?: number | null
          name_frame?: string | null
          online_at?: string | null
          selected_bg_id?: string | null
          tribe_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tribe_fk"
            columns: ["tribe_id"]
            isOneToOne: false
            referencedRelation: "tribes"
            referencedColumns: ["id"]
          },
        ]
      }
      ships_public: {
        Row: {
          acquired_at: string | null
          at_sea: boolean | null
          catalog_code: string | null
          id: string | null
          max_hp: number | null
          template_id: number | null
          user_id: string | null
        }
        Insert: {
          acquired_at?: string | null
          at_sea?: boolean | null
          catalog_code?: string | null
          id?: string | null
          max_hp?: number | null
          template_id?: number | null
          user_id?: string | null
        }
        Update: {
          acquired_at?: string | null
          at_sea?: boolean | null
          catalog_code?: string | null
          id?: string | null
          max_hp?: number | null
          template_id?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ships_owned_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ships_owned_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _arena_grant_pearls_on_win: {
        Args: { _won: boolean }
        Returns: undefined
      }
      _audit_current_reason: { Args: never; Returns: string }
      _audit_current_source: { Args: never; Returns: string }
      _client_ip: { Args: never; Returns: string }
      _client_ua: { Args: never; Returns: string }
      _consume_boss_attack: { Args: { p_user: string }; Returns: Json }
      _daughter_cashback_pct: { Args: { _stage: number }; Returns: number }
      _daughter_stage_for: { Args: { _fed: number }; Returns: number }
      _detect_bot_and_ban: {
        Args: { _action: string; _uid: string }
        Returns: undefined
      }
      _distribute_boss_loot: { Args: { p_boss_id: string }; Returns: undefined }
      _dragon_equipment_default_stats: {
        Args: { _rarity: string }
        Returns: Json
      }
      _effective_fishing_elapsed: {
        Args: {
          _as_of?: string
          _ship_id: string
          _started_at: string
          _user: string
        }
        Returns: number
      }
      _enforce_combat_cooldown: { Args: never; Returns: undefined }
      _enforce_rate_limit: {
        Args: { _action: string; _min_ms: number }
        Returns: undefined
      }
      _fish_price_bounds: {
        Args: { _fish_id: string }
        Returns: {
          max_p: number
          min_p: number
        }[]
      }
      _gen_unique_username: { Args: never; Returns: string }
      _grant_ship_with_storage: {
        Args: { _catalog_code: string; _uid: string }
        Returns: string
      }
      _market_expert_max_price: {
        Args: { _fish_id: string; _uid: string }
        Returns: number
      }
      _mutate_currency: {
        Args: {
          _coins?: number
          _gems?: number
          _rubies?: number
          _user: string
          _xp?: number
        }
        Returns: undefined
      }
      _pay_coins_with_gem_fallback: {
        Args: { _coins_needed: number; _uid: string }
        Returns: undefined
      }
      _prep_pvp_checks: { Args: { _uid: string }; Returns: undefined }
      _record_fish_sale_gold: {
        Args: { _amount: number; _uid: string }
        Returns: undefined
      }
      _require_market_level: { Args: { _min: number }; Returns: undefined }
      _require_ship_at_sea: { Args: { _uid: string }; Returns: undefined }
      _ship_repair_ratio: {
        Args: { _destroyed_at: string; _repair_ends_at: string }
        Returns: number
      }
      _ship_repair_seconds: { Args: { _template_id: number }; Returns: number }
      _try_anti_block: {
        Args: { _anti_id: string; _defender: string; _pct: number }
        Returns: boolean
      }
      _upsert_anti_block_notif: {
        Args: {
          _anti_id: string
          _kind: string
          _peer_id: string
          _peer_name: string
          _recipient: string
          _weapon_label: string
        }
        Returns: undefined
      }
      accept_all_friend_requests: { Args: never; Returns: number }
      accept_join_request: { Args: { _request_id: string }; Returns: undefined }
      activate_golden_fisher: { Args: never; Returns: Json }
      activate_market_expert: { Args: never; Returns: Json }
      add_vip_points: {
        Args: { _pts: number; _user: string }
        Returns: undefined
      }
      add_xp: { Args: { _uid: string; _xp: number }; Returns: undefined }
      admin_adjust_tribe_points:
        | { Args: { _delta: number; _tribe_id: string }; Returns: Json }
        | {
            Args: { p_delta: number; p_reason?: string; p_tribe_id: string }
            Returns: Json
          }
      admin_archive_code: { Args: { _code_id: string }; Returns: Json }
      admin_count_online: { Args: { _within_minutes: number }; Returns: number }
      admin_delete_dragon_equipment: {
        Args: { _row_id: string }
        Returns: undefined
      }
      admin_delete_tribe: { Args: { _tribe_id: string }; Returns: undefined }
      admin_find_codes: {
        Args: { _q: string }
        Returns: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          extra_rewards: Json
          id: string
          item_id: string | null
          item_kind: string | null
          max_uses: number
          note: string
          quantity: number
          reward_coins: number
          reward_elite_vip_days: number
          reward_elite_vip_level: number
          reward_gems: number
          reward_type: string
          reward_vip_days: number
          reward_vip_level: number
          reward_xp: number
          uses_count: number
        }[]
        SetofOptions: {
          from: "*"
          to: "redemption_codes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_get_elite_vip: {
        Args: { _user_id: string }
        Returns: {
          elite_vip_expires_at: string
          elite_vip_level: number
        }[]
      }
      admin_get_player_dragon_equipment: {
        Args: { _player: string }
        Returns: {
          acquired_at: string
          equipped: boolean
          id: string
          name: string
          rarity: string
          slot: string
          smelted: boolean
        }[]
      }
      admin_get_player_email: { Args: { _uid: string }; Returns: string }
      admin_get_player_fish: {
        Args: { _player: string }
        Returns: {
          fish_id: string
          quantity: number
          total_caught: number
        }[]
      }
      admin_get_player_inventory: {
        Args: { _player: string }
        Returns: {
          acquired_at: string
          id: string
          item_id: string
          item_type: string
          meta: Json
          quantity: number
        }[]
      }
      admin_get_referrals_overview: {
        Args: { p_limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_url: string
          blocked_invites: number
          clean_invites: number
          display_name: string
          gems_earned: number
          inviter_id: string
          last_invite_at: string
          username: string
        }[]
      }
      admin_grant_code_to_online: {
        Args: { _code: string; _within_minutes: number }
        Returns: {
          failed: number
          granted: number
          targeted: number
        }[]
      }
      admin_grant_inventory_item: {
        Args: {
          _item_id: string
          _item_type: string
          _player: string
          _quantity: number
        }
        Returns: undefined
      }
      admin_grant_lootbox: {
        Args: { _player: string; _type_id: string }
        Returns: string
      }
      admin_grant_referral_gift: {
        Args: { p_gems: number; p_note?: string; p_user_id: string }
        Returns: Json
      }
      admin_grant_staff: {
        Args: { _email: string; _paths: string[]; _role: string }
        Returns: string
      }
      admin_hard_ban: {
        Args: { _admin?: string; _reason?: string; _uid: string }
        Returns: Json
      }
      admin_hard_delete_user: { Args: { _uid: string }; Returns: undefined }
      admin_lift_sanction: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      admin_list_redemptions: {
        Args: { _code_id: string }
        Returns: {
          avatar_emoji: string
          display_name: string
          redeemed_at: string
          user_id: string
        }[]
      }
      admin_list_staff: {
        Args: never
        Returns: {
          allowed_paths: string[]
          display_name: string
          email: string
          is_super: boolean
          roles: string[]
          user_id: string
        }[]
      }
      admin_mass_gift: {
        Args: { _coins: number; _gems: number; _xp: number }
        Returns: number
      }
      admin_max_dragon: {
        Args: { _player: string }
        Returns: {
          created_at: string
          daily_arena_date: string | null
          daily_arena_extra_bought: number
          daily_arena_used: number
          dp: number
          element: string
          hatched_at: string | null
          name: string
          pearl_level: number
          pearls: number
          pvp_losses: number
          pvp_wins: number
          stage: number
          total_boss_damage: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "dragons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_permanent_ban: {
        Args: { _reason?: string; _uid: string }
        Returns: number
      }
      admin_profile_totals: {
        Args: never
        Returns: {
          total_coins: number
          total_gems: number
          total_xp: number
        }[]
      }
      admin_recent_chat_senders:
        | {
            Args: { _limit?: number }
            Returns: {
              avatar_url: string
              display_name: string
              last_at: string
              last_body: string
              msg_count: number
              sender_id: string
            }[]
          }
        | {
            Args: { _limit?: number; _since?: string }
            Returns: {
              avatar_url: string
              display_name: string
              distinct_count: number
              last_at: string
              last_body: string
              msg_count: number
              sender_id: string
            }[]
          }
      admin_redeem_code_for: {
        Args: { p_code: string; p_target_user: string }
        Returns: Json
      }
      admin_redeem_code_for_all: { Args: { p_code: string }; Returns: Json }
      admin_remove_email_ban: { Args: { p_email: string }; Returns: Json }
      admin_revert_economy_window: {
        Args: { _from: string; _reason?: string; _source: string; _to: string }
        Returns: {
          coins_reverted: number
          gems_reverted: number
          user_id: string
        }[]
      }
      admin_revert_fish_window: {
        Args: { _from: string; _source: string; _to: string }
        Returns: {
          fish_id: string
          qty_reversed: number
          user_id: string
        }[]
      }
      admin_revoke_redemption:
        | { Args: { _code_id: string; _user_id: string }; Returns: Json }
        | {
            Args: { _code_id: string; _reclaim?: boolean; _user_id: string }
            Returns: Json
          }
      admin_revoke_staff: { Args: { _uid: string }; Returns: undefined }
      admin_search_player_ids_by_email: {
        Args: { _q: string }
        Returns: {
          email: string
          id: string
        }[]
      }
      admin_set_dragon: {
        Args: {
          _dp?: number
          _pearl_level?: number
          _pearls?: number
          _player: string
          _stage?: number
        }
        Returns: {
          created_at: string
          daily_arena_date: string | null
          daily_arena_extra_bought: number
          daily_arena_used: number
          dp: number
          element: string
          hatched_at: string | null
          name: string
          pearl_level: number
          pearls: number
          pvp_losses: number
          pvp_wins: number
          stage: number
          total_boss_damage: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "dragons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_inventory_quantity: {
        Args: { _quantity: number; _row_id: string }
        Returns: undefined
      }
      admin_set_market_levels: {
        Args: { _fish_level: number; _player: string; _ship_level: number }
        Returns: Json
      }
      admin_set_media_ban: {
        Args: { _banned: boolean; _target: string }
        Returns: undefined
      }
      admin_set_player_currency: {
        Args: {
          _coins: number
          _gems: number
          _level: number
          _player: string
          _xp: number
        }
        Returns: undefined
      }
      admin_set_player_fish: {
        Args: {
          _fish_id: string
          _player: string
          _quantity: number
          _total_caught: number
        }
        Returns: undefined
      }
      admin_set_player_full: {
        Args: {
          _coins: number
          _gems: number
          _level: number
          _player: string
          _rubies: number
          _xp: number
        }
        Returns: undefined
      }
      admin_set_profile_fields: {
        Args: {
          _avatar_emoji?: string
          _avatar_url?: string
          _bio?: string
          _clear_avatar?: boolean
          _target: string
        }
        Returns: undefined
      }
      admin_set_staff_paths: {
        Args: { _paths: string[]; _uid: string }
        Returns: undefined
      }
      admin_set_staff_role: {
        Args: { _role: string; _uid: string }
        Returns: undefined
      }
      admin_set_tribe_points: {
        Args: { p_reason?: string; p_tribe_id: string; p_value: number }
        Returns: Json
      }
      admin_set_username: {
        Args: { _new: string; _target: string }
        Returns: Json
      }
      admin_unhard_ban: {
        Args: { _admin?: string; _uid: string }
        Returns: Json
      }
      admin_wipe_exploit: { Args: { _user_id: string }; Returns: Json }
      admin_wipe_profile: { Args: { _target: string }; Returns: Json }
      allocate_skill_point: { Args: { _stat: string }; Returns: Json }
      apply_referral_code: {
        Args: { p_code: string; p_device_id?: string }
        Returns: Json
      }
      apply_ship_damage: {
        Args: {
          _damage: number
          _ship_id: string
          _skip_fishing_check?: boolean
        }
        Returns: {
          destroyed: boolean
          new_hp: number
          repair_ends_at: string
        }[]
      }
      apply_ship_damage_v2: {
        Args: {
          _ship_id: string
          _skip_fishing_check?: boolean
          _weapon_id: string
        }
        Returns: {
          blocked: boolean
          damage_applied: number
          destroyed: boolean
          new_hp: number
          repair_ends_at: string
        }[]
      }
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      arena_attack_request: { Args: never; Returns: Json }
      arena_attack_status: { Args: never; Returns: Json }
      arena_award_pearls: { Args: never; Returns: Json }
      arena_dragon_duel: { Args: { _opponent: string }; Returns: Json }
      arena_dragon_overall_level: {
        Args: { _dp: number; _stage: number }
        Returns: number
      }
      assign_crew_to_ship: {
        Args: { _crew_id: string; _ship_id: string }
        Returns: {
          expires_at: string
          inventory_id: string
        }[]
      }
      attack_boss: { Args: { p_use_free?: boolean }; Returns: Json }
      attack_boss_with: { Args: { p_weapon: string }; Returns: Json }
      attacker_has_destroyed_ship: {
        Args: { _user_id: string }
        Returns: boolean
      }
      audit_player_currency: {
        Args: { _uid: string }
        Returns: {
          coins_diff: number
          current_coins: number
          current_gems: number
          display_name: string
          gems_diff: number
          ledger_coins: number
          ledger_gems: number
          player_id: string
        }[]
      }
      award_arena_score: {
        Args: { _score: number; _week_start?: string; _won?: boolean }
        Returns: Json
      }
      award_dragon_dp: { Args: { p_damage: number }; Returns: Json }
      award_event_xp: {
        Args: { _amount: number; _user: string }
        Returns: number
      }
      award_vip_cashback: {
        Args: { _gold_spent: number; _source?: string; _uid: string }
        Returns: number
      }
      boss_attack_status: { Args: never; Returns: Json }
      boss_award_pearls: { Args: { _boss_id: string }; Returns: Json }
      boss_hit_my_ship: { Args: { p_ship_id: string }; Returns: Json }
      broadcast_nuke: {
        Args: { _message: string; _target_id: string }
        Returns: undefined
      }
      build_trader_snapshot: { Args: never; Returns: Json }
      bump_achievement_progress: {
        Args: { _delta: number; _goal_type: string; _user: string }
        Returns: undefined
      }
      bump_quest_progress: {
        Args: { _delta: number; _goal_type: string; _user: string }
        Returns: undefined
      }
      burn_target_bg: { Args: { _target_id: string }; Returns: string }
      buy_anti_to_inventory: {
        Args: { _item_id: string; _qty: number }
        Returns: Json
      }
      buy_background: {
        Args: { _bg_id: string; _price: number }
        Returns: undefined
      }
      buy_background_gems: {
        Args: { _bg_id: string; _gems: number }
        Returns: undefined
      }
      buy_catalog_item: {
        Args: { _item_id: string; _item_type: string }
        Returns: undefined
      }
      buy_disabler_to_inventory: {
        Args: { _item_id: string; _qty: number }
        Returns: Json
      }
      buy_dragon_equipment: {
        Args: { p_currency: string; p_rarity: string; p_slot: string }
        Returns: Json
      }
      buy_lootbox: { Args: { _type_id: string }; Returns: string }
      buy_market_freeze: { Args: { _hours: number }; Returns: string }
      buy_phoenix_pack_1: { Args: never; Returns: string }
      buy_phoenix_pack_3: { Args: never; Returns: string[] }
      buy_protection: {
        Args: { _coins_cost: number; _days: number; _gems_cost: number }
        Returns: string
      }
      buy_shield_to_inventory: {
        Args: {
          _coins_cost: number
          _gems_cost: number
          _item_id: string
          _qty: number
        }
        Returns: Json
      }
      buy_ship_by_code: {
        Args: {
          _code: string
          _max_hp: number
          _price_coins: number
          _template_id: number
        }
        Returns: string
      }
      buy_trader_unlock: { Args: never; Returns: string }
      buy_with_coins:
        | {
            Args: {
              _coins_cost: number
              _item_id: string
              _item_type: string
              _meta?: Json
            }
            Returns: undefined
          }
        | {
            Args: {
              _coins_cost: number
              _count?: number
              _item_id: string
              _item_type: string
              _meta?: Json
            }
            Returns: undefined
          }
      buy_with_coins_gem_fallback: {
        Args: {
          _coins_cost: number
          _count?: number
          _item_id: string
          _item_type: string
          _meta?: Json
        }
        Returns: undefined
      }
      buy_with_gems:
        | {
            Args: {
              _gems_cost: number
              _item_id: string
              _item_type: string
              _meta?: Json
            }
            Returns: undefined
          }
        | {
            Args: {
              _count?: number
              _gems_cost: number
              _item_id: string
              _item_type: string
              _meta?: Json
            }
            Returns: undefined
          }
      can_view_album: {
        Args: { _owner: string; _viewer: string }
        Returns: boolean
      }
      cancel_steal_mission: {
        Args: { _attacker_ship_id: string }
        Returns: {
          stolen_count: number
          total_value: number
        }[]
      }
      catch_thief: {
        Args: { _attacker_ship_id: string }
        Returns: {
          blocked_until: string
        }[]
      }
      change_username: { Args: { _new: string }; Returns: Json }
      check_profanity: { Args: { _body: string }; Returns: string }
      claim_achievement: { Args: { _ach_id: string }; Returns: Json }
      claim_daily_dragon_rockets: { Args: never; Returns: Json }
      claim_daily_login: {
        Args: never
        Returns: {
          coins_awarded: number
          day_index: number
          gems_awarded: number
          xp_awarded: number
        }[]
      }
      claim_daily_login_pirate: {
        Args: never
        Returns: {
          day_index: number
          new_streak: number
          reward_id: string
          reward_qty: number
          reward_type: string
        }[]
      }
      claim_daily_quest: { Args: { _quest_id: string }; Returns: Json }
      claim_elite_vip_daily_gems: { Args: never; Returns: Json }
      claim_quest: {
        Args: { _day_key: string; _quest_id: string }
        Returns: undefined
      }
      claim_royal_box: { Args: never; Returns: Json }
      claim_session: { Args: { _token: string }; Returns: undefined }
      claim_steal_mission: {
        Args: { _attacker_ship_id: string; _force?: boolean }
        Returns: {
          fish_summary: Json
          stolen_count: number
          total_value: number
        }[]
      }
      claim_vip_daily: { Args: never; Returns: Json }
      claim_vip_shield: { Args: never; Returns: Json }
      cleanup_elite_login_broadcasts: { Args: never; Returns: undefined }
      cleanup_expired_sanctions: { Args: never; Returns: undefined }
      cleanup_global_banners: { Args: never; Returns: undefined }
      cleanup_old_competition_catches: { Args: never; Returns: undefined }
      cleanup_old_notifications_batch: { Args: never; Returns: number }
      cleanup_voice_artifacts: { Args: never; Returns: undefined }
      collect_fishing_reward: {
        Args: {
          _client_progress?: number
          _requested_fish_id?: string
          _ship_id: string
        }
        Returns: {
          base_qty: number
          duration_seconds: number
          elapsed_seconds: number
          fish_id: string
          fish_qty: number
          luck_bonus: number
          xp_awarded: number
        }[]
      }
      compute_dragon_overall_level: {
        Args: { _dp: number; _stage: number }
        Returns: number
      }
      compute_vip_level: { Args: { _points: number }; Returns: number }
      consume_inventory_item: {
        Args: { _count?: number; _item_id: string; _item_type: string }
        Returns: undefined
      }
      daily_rockets_status: { Args: never; Returns: Json }
      daily_xp_cap: { Args: never; Returns: number }
      daughter_apply_purchase_bonus: {
        Args: { _spent_coins: number; _spent_gems: number }
        Returns: Json
      }
      daughter_gem_cost: { Args: { _from_stage: number }; Returns: number }
      delete_dm_conversation: { Args: { p_other: string }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_inventory_rows: { Args: { _ids: string[] }; Returns: number }
      device_admin_approve_appeal: {
        Args: { _appeal_id: string }
        Returns: Json
      }
      device_admin_reject_appeal: {
        Args: { _appeal_id: string }
        Returns: Json
      }
      device_assign_slot:
        | { Args: { _hardware_hash: string; _user_id: string }; Returns: Json }
        | {
            Args: {
              _fingerprint_version?: number
              _hardware_hash: string
              _user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _fingerprint_version?: number
              _hardware_hash: string
              _user_id: string
            }
            Returns: Json
          }
      device_audit_log: {
        Args: {
          _actor: string
          _details: Json
          _event: string
          _hw: string
          _slot: number
          _user: string
          _version: number
        }
        Returns: undefined
      }
      device_is_privileged: { Args: { _uid: string }; Returns: boolean }
      device_migrate_choose:
        | {
            Args: { _hardware_hash: string; _user_a: string; _user_b: string }
            Returns: Json
          }
        | {
            Args: {
              _fingerprint_version?: number
              _hardware_hash: string
              _user_a: string
              _user_b: string
            }
            Returns: Json
          }
      device_migration_candidates: {
        Args: { _hardware_hash: string }
        Returns: Json
      }
      device_rate_limit_check: {
        Args: { _hardware_hash: string }
        Returns: Json
      }
      device_slot_check:
        | {
            Args: { _email?: string; _hardware_hash: string; _user_id?: string }
            Returns: Json
          }
        | {
            Args: {
              _email?: string
              _fingerprint_version?: number
              _hardware_hash: string
              _user_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _email: string
              _fingerprint_version?: number
              _hardware_hash: string
              _user_id: string
            }
            Returns: Json
          }
      device_slot_metrics: { Args: { _days?: number }; Returns: Json }
      device_submit_appeal: {
        Args: { _email: string; _hardware_hash: string; _message: string }
        Returns: Json
      }
      distribute_tribe_fish_event_prizes: {
        Args: { p_event_id: string }
        Returns: Json
      }
      distribute_weekly_xp_prizes: { Args: never; Returns: Json }
      dm_accept_request: { Args: { _other: string }; Returns: Json }
      dm_block: { Args: { _other: string }; Returns: Json }
      dm_cancel_request: { Args: { _other: string }; Returns: Json }
      dm_reject_request: { Args: { _other: string }; Returns: Json }
      dm_unblock: { Args: { _other: string }; Returns: Json }
      donate_to_tribe: {
        Args: { _amount: number; _tribe_id: string }
        Returns: Json
      }
      dragon_attack_bonus_pct: { Args: { _level: number }; Returns: number }
      dragon_defense_bonus: { Args: { _user_id: string }; Returns: number }
      dragon_defense_bonus_pct: { Args: { _level: number }; Returns: number }
      dragon_is_hatched: { Args: { _user: string }; Returns: boolean }
      dragon_overall_level: { Args: { _user_id: string }; Returns: number }
      dragon_pearl_upgrade: { Args: never; Returns: Json }
      dragon_pearl_upgrade_cost: {
        Args: { _from_level: number }
        Returns: number
      }
      dragon_stage_for_dp: { Args: { _dp: number }; Returns: number }
      drop_my_protection: { Args: never; Returns: undefined }
      effective_market_level: { Args: { _user_id: string }; Returns: number }
      effective_vip_level: { Args: { _user: string }; Returns: number }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      equip_dragon_item: { Args: { p_item_id: string }; Returns: Json }
      feed_daughter: { Args: { _fish_stock_ids: string[] }; Returns: Json }
      feed_daughter_caught: { Args: { _fish_ids: string[] }; Returns: Json }
      finalize_competition: {
        Args: { _competition_id: string }
        Returns: undefined
      }
      finalize_due_competitions: { Args: never; Returns: undefined }
      finalize_fish_market_upgrades: { Args: never; Returns: undefined }
      finalize_market_upgrades: { Args: never; Returns: undefined }
      finalize_ship_repairs:
        | { Args: never; Returns: undefined }
        | { Args: { _user: string }; Returns: undefined }
      fire_disabler: {
        Args: { _disabler_id: string; _target_id: string }
        Returns: Json
      }
      fish_market_capacity: { Args: { _level: number }; Returns: number }
      fish_market_finish_upgrade_with_gems: { Args: never; Returns: number }
      fish_market_start_upgrade: {
        Args: never
        Returns: {
          cost_coins: number
          ends_at: string
          new_level: number
        }[]
      }
      fish_market_upgrade_cost: {
        Args: { _level: number }
        Returns: {
          cost_coins: number
          seconds: number
        }[]
      }
      flag_cheat: {
        Args: {
          _details?: Json
          _kind: string
          _severity: number
          _user: string
        }
        Returns: undefined
      }
      forum_admin_ban: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      forum_admin_unban: { Args: { _user_id: string }; Returns: undefined }
      free_strike_status: { Args: never; Returns: Json }
      generate_referral_code: { Args: never; Returns: string }
      get_active_boss: { Args: never; Returns: Json }
      get_active_competitions: {
        Args: never
        Returns: {
          banner_emoji: string
          banner_text: string
          banner_theme: string
          description: string
          ends_at: string
          hide_target: boolean
          id: string
          metric: string
          prize_tiers: Json
          prizes_distributed_at: string
          reward_coins: number
          reward_gems: number
          reward_text: string
          reward_xp: number
          starts_at: string
          target_fish_id: string
          title: string
        }[]
      }
      get_combat_multiplier: { Args: { _user_id: string }; Returns: number }
      get_competition_leaderboard: {
        Args: { _competition_id: string }
        Returns: {
          avatar_emoji: string
          avatar_url: string
          display_name: string
          level: number
          score: number
          user_id: string
        }[]
      }
      get_currency_leaderboard: {
        Args: { _col: string; _limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          coins: number
          display_name: string
          gems: number
          id: string
          level: number
          name_frame: string
          xp: number
        }[]
      }
      get_destroyer_messages: {
        Args: { _defender_id: string }
        Returns: {
          attacker_id: string
          attacker_name: string
          created_at: string
          id: string
          kind: string
          message: string
        }[]
      }
      get_effective_shop_price: {
        Args: { _base_price: number; _user_id: string }
        Returns: number
      }
      get_elite_vip_level: { Args: { _user_id: string }; Returns: number }
      get_fish_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          display_name: string
          level: number
          name_frame: string
          total_fish: number
          unique_fish: number
          user_id: string
        }[]
      }
      get_fish_stock_summary: {
        Args: never
        Returns: {
          fish_id: string
          oldest_caught_at: string
          qty: number
        }[]
      }
      get_my_daughter: {
        Args: never
        Returns: {
          created_at: string
          feed_count_today: number
          feed_day: string | null
          feed_xp: number
          last_fed_at: string | null
          name: string
          outfit: string
          stage: number
          total_fish_fed: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "player_daughter"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_elite_vip: {
        Args: never
        Returns: {
          elite_vip_expires_at: string
          elite_vip_level: number
        }[]
      }
      get_my_profile_private: {
        Args: never
        Returns: {
          active_session_id: string
          album_privacy: string
          armor_last_bought_at: string
          bg_burned_until: string
          golden_fisher_last_activated_at: string
          golden_fisher_until: string
          last_destroyer_at: string
          last_destroyer_id: string
          last_destroyer_kind: string
          last_destroyer_message: string
          last_destroyer_name: string
          media_banned: boolean
          protection_until: string
          referral_code: string
          referral_locked_at: string
          referred_by: string
          steal_blocked_until: string
          username_changed_at: string
          vip_expires_at: string
          vip_points: number
          vip_subs_claimed: number
        }[]
      }
      get_my_referral_stats: { Args: never; Returns: Json }
      get_my_ships: {
        Args: never
        Returns: {
          acquired_at: string
          at_sea: boolean
          catalog_code: string | null
          destroyed_at: string | null
          fishing_started_at: string | null
          hp: number
          id: string
          in_storage: boolean
          last_fishing_reward_at: string | null
          max_hp: number
          max_stars: number
          preferred_fish_id: string | null
          repair_ends_at: string | null
          source_txn_id: string | null
          stars: number
          stealing_ends_at: string | null
          stealing_started_at: string | null
          stealing_target_ship_id: string | null
          stealing_target_user_id: string | null
          template_id: number
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ships_owned"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_ships_private: {
        Args: never
        Returns: {
          fishing_started_at: string
          id: string
          last_fishing_reward_at: string
          stealing_ends_at: string
          stealing_target_ship_id: string
          stealing_target_user_id: string
        }[]
      }
      get_my_vip: {
        Args: never
        Returns: {
          vip_expires_at: string
          vip_level: number
        }[]
      }
      get_my_wallet: {
        Args: never
        Returns: {
          coins: number
          gems: number
          level: number
          protection_until: string
          rubies: number
          xp: number
        }[]
      }
      get_online_players: {
        Args: { _limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          bio: string
          bubble_frame: string
          created_at: string
          display_name: string
          id: string
          level: number
          name_frame: string
          online_at: string
          profile_frame: string
          selected_bg_id: string
          tribe_id: string
          username: string
          xp: number
        }[]
      }
      get_or_init_dragon: {
        Args: never
        Returns: {
          created_at: string
          daily_arena_date: string | null
          daily_arena_extra_bought: number
          daily_arena_used: number
          dp: number
          element: string
          hatched_at: string | null
          name: string
          pearl_level: number
          pearls: number
          pvp_losses: number
          pvp_wins: number
          stage: number
          total_boss_damage: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "dragons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_player_crews: {
        Args: { _player_id: string }
        Returns: {
          item_id: string
          ship_id: string
        }[]
      }
      get_player_dragon_public_info: { Args: { _uid: string }; Returns: Json }
      get_profile_by_username: {
        Args: { _username: string }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          bio: string
          bubble_frame: string
          created_at: string
          display_name: string
          id: string
          level: number
          name_frame: string
          online_at: string
          profile_frame: string
          selected_bg_id: string
          tribe_id: string
          username: string
          xp: number
        }[]
      }
      get_profiles_public: {
        Args: { _ids: string[] }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          bio: string
          bubble_frame: string
          created_at: string
          display_name: string
          id: string
          level: number
          name_frame: string
          online_at: string
          profile_frame: string
          selected_bg_id: string
          tribe_id: string
          username: string
          xp: number
        }[]
      }
      get_referral_leaderboard_alltime: {
        Args: { p_limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          display_name: string
          gems_earned: number
          inviter_id: string
          invites_count: number
          rank: number
          username: string
        }[]
      }
      get_referral_leaderboard_weekly: {
        Args: { p_limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          display_name: string
          gems_earned: number
          inviter_id: string
          invites_count: number
          rank: number
          username: string
        }[]
      }
      get_server_time: {
        Args: never
        Returns: {
          server_now: string
          server_today: string
        }[]
      }
      get_ship_market_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          display_name: string
          level: number
          market_level: number
          name_frame: string
          user_id: string
        }[]
      }
      get_staff_user_ids: { Args: never; Returns: string[] }
      get_tribe_effort_leaderboard: {
        Args: { _limit?: number; _mode?: string }
        Returns: {
          attack_score: number
          banner: string
          donation_score: number
          emblem: string
          level: number
          members: number
          name: string
          power: number
          support_score: number
          tribe_id: string
        }[]
      }
      get_weekly_xp_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          avatar_emoji: string
          avatar_url: string
          display_name: string
          level: number
          user_id: string
          weekly_xp: number
        }[]
      }
      gift_gold: {
        Args: { _amount: number; _recipient: string }
        Returns: undefined
      }
      golden_fisher_active_until: { Args: { _user: string }; Returns: string }
      golden_fisher_tick: { Args: { _user: string }; Returns: Json }
      golden_fisher_tick_all: { Args: never; Returns: Json }
      grant_cosmic_frame: { Args: never; Returns: Json }
      grant_inventory_item: {
        Args: {
          _item_id: string
          _item_type: string
          _qty: number
          _user: string
        }
        Returns: undefined
      }
      grant_pack_ships: {
        Args: {
          _dragon_t1: number
          _dragon_t2: number
          _dragon_t3: number
          _phoenix: number
          _txn_id: string
          _user: string
        }
        Returns: Json
      }
      grant_paddle_purchase: {
        Args: {
          _amount_cents: number
          _coins: number
          _env: string
          _gems: number
          _pack_id: string
          _rubies: number
          _shield_days: number
          _txn_id: string
          _user: string
          _vip_days: number
        }
        Returns: Json
      }
      grant_polar_purchase: {
        Args: {
          _amount_cents: number
          _checkout_id: string
          _coins?: number
          _env?: string
          _gems?: number
          _order_id: string
          _pack_id: string
          _rubies?: number
          _shield_days?: number
          _user: string
          _vip_days?: number
        }
        Returns: boolean
      }
      grant_referral_bonus: {
        Args: { _amount_cents: number; _txn_id: string; _user: string }
        Returns: undefined
      }
      grant_stripe_purchase: {
        Args: {
          _amount_cents: number
          _coins: number
          _gems: number
          _pack_id: string
          _rubies: number
          _session_id: string
          _shield_days: number
          _user: string
          _vip_days: number
        }
        Returns: Json
      }
      grant_vip: {
        Args: { _days: number; _level: number; _user: string }
        Returns: Json
      }
      has_bought_starter: { Args: { _user: string }; Returns: boolean }
      has_fishing_ship: { Args: { _user_id: string }; Returns: boolean }
      has_pvp_fleet: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_fish_caught: {
        Args: { _fish_id: string; _qty: number }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_banned: { Args: { _user_id: string }; Returns: boolean }
      is_chat_mod: { Args: { _uid: string }; Returns: boolean }
      is_device_banned: { Args: { _device_id: string }; Returns: boolean }
      is_disallowed_religious_name: {
        Args: { p_name: string }
        Returns: boolean
      }
      is_display_name_taken: {
        Args: { p_except?: string; p_name: string }
        Returns: boolean
      }
      is_email_banned: { Args: { _email: string }; Returns: boolean }
      is_ip_banned: { Args: { _ip: string }; Returns: boolean }
      is_market_pvp_unlocked: { Args: { _user_id: string }; Returns: boolean }
      is_muted: { Args: { _user: string }; Returns: boolean }
      is_privileged_caller: { Args: never; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      is_tribe_member: {
        Args: { _tribe_id: string; _user_id: string }
        Returns: boolean
      }
      is_tribe_officer: {
        Args: { _tribe_id: string; _user_id: string }
        Returns: boolean
      }
      join_tribe_open: { Args: { _tribe_id: string }; Returns: undefined }
      jumanji_auto_donate_missing: { Args: never; Returns: Json }
      jumanji_auto_donate_tick: { Args: never; Returns: Json }
      launch_ad_bomb: {
        Args: { _target_id: string; _video_key: string }
        Returns: string
      }
      launch_nuke: { Args: { _target_id: string }; Returns: string }
      leave_tribe: { Args: { _tribe_id: string }; Returns: Json }
      level_from_xp: { Args: { _xp: number }; Returns: number }
      ludo_active_room_for: { Args: { _uid: string }; Returns: string }
      ludo_bot_play: { Args: { _room_id: string }; Returns: undefined }
      ludo_cleanup_stale: { Args: never; Returns: undefined }
      ludo_cleanup_stale_rooms: { Args: never; Returns: undefined }
      ludo_color_start_offset: { Args: { _color: string }; Returns: number }
      ludo_create_room: { Args: { _max_players?: number }; Returns: string }
      ludo_forfeit: { Args: { _room_id: string }; Returns: undefined }
      ludo_is_in_room: {
        Args: { _room: string; _uid: string }
        Returns: boolean
      }
      ludo_join_room: { Args: { _room_id: string }; Returns: undefined }
      ludo_leave_room: { Args: { _room_id: string }; Returns: undefined }
      ludo_move_token: {
        Args: { _room_id: string; _token_idx: number }
        Returns: Json
      }
      ludo_next_active_seat: {
        Args: { _current_seat: number; _max_players: number; _room_id: string }
        Returns: number
      }
      ludo_player_has_move:
        | {
            Args: { _dice: number; _seat: number; _tokens: Json }
            Returns: boolean
          }
        | {
            Args: {
              _color?: string
              _dice: number
              _seat: number
              _tokens: Json
            }
            Returns: boolean
          }
      ludo_quick_match: { Args: { _players?: number }; Returns: string }
      ludo_roll_dice: { Args: { _room_id: string }; Returns: number }
      ludo_skip_turn: { Args: { _room_id: string }; Returns: undefined }
      mark_me_offline: { Args: never; Returns: undefined }
      market_finish_upgrade_with_gems: { Args: never; Returns: number }
      market_start_upgrade: {
        Args: never
        Returns: {
          cost_coins: number
          ends_at: string
          new_level: number
        }[]
      }
      market_upgrade_cost: {
        Args: { _level: number }
        Returns: {
          cost_coins: number
          seconds: number
        }[]
      }
      message_contains_link: { Args: { _body: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_ar: { Args: { p: string }; Returns: string }
      normalize_for_profanity: { Args: { _t: string }; Returns: string }
      notify_steal_started: {
        Args: {
          _attacker_emoji: string
          _attacker_name: string
          _attacker_user_id: string
          _target_user_id: string
        }
        Returns: undefined
      }
      officer_set_tribe: {
        Args: { _target: string; _tribe_id: string }
        Returns: undefined
      }
      open_lootbox: { Args: { _box_id: string }; Returns: Json }
      open_lucky_box: { Args: never; Returns: Json }
      pause_golden_fisher: { Args: never; Returns: Json }
      player_attack_bonus: { Args: { p_user: string }; Returns: Json }
      post_elite_vip_login_broadcast: { Args: never; Returns: undefined }
      process_tribe_overflow_kicks: { Args: never; Returns: number }
      promote_next_owner: { Args: { _tribe_id: string }; Returns: string }
      purge_old_messages: { Args: never; Returns: undefined }
      push_global_banner: {
        Args: {
          _attacker_id: string
          _attacker_name: string
          _emoji?: string
          _kind: string
          _message: string
          _target_id: string
          _target_name: string
          _title?: string
        }
        Returns: undefined
      }
      pvp_fleet_count: { Args: { _user_id: string }; Returns: number }
      pvp_requirement_error: {
        Args: { _actor_label?: string; _user_id: string }
        Returns: string
      }
      pvp_ship_level: {
        Args: { _catalog_code: string; _template_id: number }
        Returns: number
      }
      qa_award: {
        Args: { _coins: number; _gems: number; _user: string; _xp: number }
        Returns: undefined
      }
      qa_day_key: { Args: never; Returns: string }
      quote_fish_sale_by_qty: {
        Args: { _fish_id: string; _qty: number }
        Returns: {
          current_price: number
          effective_unit_price: number
          rot: number
          sold: number
          total_amount: number
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_fish_prices: { Args: never; Returns: undefined }
      record_attack: {
        Args: {
          _attacker_won: boolean
          _damage: number
          _damage_dealt: number
          _defender_id: string
          _target_ship_id: string
          _xp_gain?: number
        }
        Returns: string
      }
      redeem_code: { Args: { p_code: string }; Returns: Json }
      refresh_boss_attacks: { Args: never; Returns: Json }
      refund_ban_user: {
        Args: { _reason?: string; _txn_id: string }
        Returns: Json
      }
      register_device: { Args: { _device_id: string }; Returns: Json }
      reject_all_friend_requests: { Args: never; Returns: number }
      remove_ad_bombs: { Args: never; Returns: number }
      remove_golden_fisher: { Args: never; Returns: Json }
      rename_daughter: { Args: { _name: string }; Returns: undefined }
      rename_tribe: {
        Args: { _new_name: string; _tribe_id: string }
        Returns: Json
      }
      repair_burned_bg: { Args: never; Returns: boolean }
      repair_ship_instant: {
        Args: { _gems_cost: number; _ship_id: string }
        Returns: undefined
      }
      repair_ship_with_crew: {
        Args: { _crew_id: string; _ship_id: string }
        Returns: {
          max_hp: number
          new_hp: number
          repair_ends_at: string
          repaired_count: number
        }[]
      }
      repair_target_burned_bg: {
        Args: { _target_id: string }
        Returns: undefined
      }
      report_cheat: {
        Args: { _details: Json; _kind: string }
        Returns: undefined
      }
      request_join_tribe: { Args: { _tribe_id: string }; Returns: Json }
      reset_player_to_ledger: { Args: { _uid: string }; Returns: Json }
      resume_golden_fisher: { Args: never; Returns: Json }
      revoke_paddle_purchase: {
        Args: {
          _block_account?: boolean
          _coins?: number
          _gems?: number
          _revoke_elite_level?: number
          _rubies?: number
          _shield_days?: number
          _txn_id: string
          _vip_days?: number
        }
        Returns: Json
      }
      revoke_vip_protection: { Args: { _user: string }; Returns: undefined }
      rl_guard: {
        Args: { _action: string; _min_interval_ms: number }
        Returns: number
      }
      search_profiles_public: {
        Args: { _limit?: number; _q: string }
        Returns: {
          avatar_emoji: string
          avatar_frame: string
          avatar_url: string
          bio: string
          bubble_frame: string
          created_at: string
          display_name: string
          id: string
          level: number
          name_frame: string
          online_at: string
          profile_frame: string
          selected_bg_id: string
          tribe_id: string
          username: string
          xp: number
        }[]
      }
      sell_fish: { Args: { _fish_stock_ids: string[] }; Returns: number }
      sell_fish_by_qty:
        | { Args: { _fish_id: string; _qty: number }; Returns: number }
        | {
            Args: { _client_version: string; _fish_id: string; _qty: number }
            Returns: number
          }
      sell_fish_caught: {
        Args: { _fish_id: string; _qty: number; _unit_price?: number }
        Returns: {
          coins_earned: number
          new_coins: number
          remaining: number
        }[]
      }
      sell_ship: {
        Args: { _refund_coins: number; _ship_id: string }
        Returns: undefined
      }
      send_chat_message_safe: {
        Args: {
          _body: string
          _channel: string
          _recipient_id?: string
          _reply_to_body?: string
          _reply_to_id?: string
          _reply_to_name?: string
          _tribe_id?: string
        }
        Returns: Json
      }
      send_friend_request: { Args: { p_target: string }; Returns: Json }
      send_support: {
        Args: {
          _crew_id?: string
          _kind: string
          _recipient_id: string
          _ship_id: string
        }
        Returns: undefined
      }
      set_audit_context: {
        Args: { _reason?: string; _source: string }
        Returns: undefined
      }
      set_daughter_outfit: {
        Args: { _outfit: string }
        Returns: {
          created_at: string
          feed_count_today: number
          feed_day: string | null
          feed_xp: number
          last_fed_at: string | null
          name: string
          outfit: string
          stage: number
          total_fish_fed: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "player_daughter"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_elite_vip_login_broadcast: {
        Args: { _enabled: boolean }
        Returns: boolean
      }
      set_friend_requests_closed: {
        Args: { p_closed: boolean }
        Returns: boolean
      }
      set_guide_fish: {
        Args: { _fish_id: string; _ship_db_id: string }
        Returns: Json
      }
      set_my_tribe: { Args: { _tribe_id: string }; Returns: undefined }
      set_pinned_chat: { Args: { _body: string }; Returns: undefined }
      set_ship_at_sea: {
        Args: { _at_sea: boolean; _ship_id: string }
        Returns: undefined
      }
      set_tribe_join_mode: {
        Args: { _mode: string; _tribe_id: string }
        Returns: undefined
      }
      shield_purchases_last_week: { Args: { _user: string }; Returns: number }
      ship_from_storage: { Args: { p_ship_id: string }; Returns: Json }
      ship_to_storage: { Args: { p_ship_id: string }; Returns: Json }
      signup_block_reason: {
        Args: { _device_id: string; _email: string }
        Returns: string
      }
      skip_shield_type_cooldown: { Args: { _item_id: string }; Returns: Json }
      smelt_dragon_items: {
        Args: { p_a_id: string; p_b_id: string }
        Returns: Json
      }
      split_inventory_assign: {
        Args: { _inv_id: string; _new_meta: Json }
        Returns: string
      }
      stamp_global_last_attack: {
        Args: {
          _attacker_id: string
          _attacker_name: string
          _kind: string
          _target_id: string
          _target_name: string
        }
        Returns: undefined
      }
      start_steal_mission: {
        Args: {
          _attacker_ship_id: string
          _target_ship_id: string
          _target_user_id: string
        }
        Returns: {
          ends_at: string
        }[]
      }
      steal_fish: {
        Args: {
          _attacker_ship_id?: string
          _defender_id: string
          _max_count?: number
          _target_ship_id?: string
        }
        Returns: {
          stolen_count: number
          total_value: number
        }[]
      }
      submarine_capacity_for_stars: {
        Args: { _stars: number }
        Returns: number
      }
      submit_message_report: {
        Args: {
          _kind: string
          _message_body?: string
          _reason?: string
          _reported_user_id: string
          _source_id?: string
        }
        Returns: string
      }
      swap_ship_with_storage: {
        Args: { p_active_id: string; p_storage_id: string }
        Returns: Json
      }
      sweep_expired_crews: { Args: never; Returns: number }
      sweep_expired_elite_vip: { Args: never; Returns: number }
      test_steal_cancel_moves_one_fish: { Args: never; Returns: boolean }
      test_steal_claim_moves_one_fish: { Args: never; Returns: boolean }
      touch_session: {
        Args: { _device_id: string; _ip: string }
        Returns: undefined
      }
      trader_snapshot_anchor: { Args: never; Returns: string }
      transfer_tribe_ownership: { Args: { _target: string }; Returns: Json }
      tribe_fish_event_leaderboard: {
        Args: { p_event_id: string }
        Returns: {
          members_count: number
          total_fish: number
          tribe_banner: string
          tribe_emblem: string
          tribe_id: string
          tribe_name: string
        }[]
      }
      tribe_fish_event_member_leaderboard: {
        Args: { p_event_id: string; p_tribe_id: string }
        Returns: {
          avatar_url: string
          total_fish: number
          user_id: string
          username: string
        }[]
      }
      tribe_level_from_donations: { Args: { _d: number }; Returns: number }
      tribes_ranking: {
        Args: { p_limit?: number }
        Returns: {
          level: number
          members_count: number
          points: number
          tribe_banner: string
          tribe_emblem: string
          tribe_id: string
          tribe_name: string
        }[]
      }
      update_inventory_meta: {
        Args: { _inv_id: string; _meta: Json }
        Returns: undefined
      }
      update_my_online_at: { Args: never; Returns: undefined }
      update_tribe_details: {
        Args: { _banner: string; _description: string; _tribe_id: string }
        Returns: Json
      }
      upgrade_daughter_with_gems: { Args: never; Returns: Json }
      upgrade_dragon_item: { Args: { p_item_id: string }; Returns: Json }
      upgrade_submarine: { Args: { _ship_id: string }; Returns: Json }
      use_crew_from_inventory: {
        Args: { _inventory_id: string; _ship_id?: string }
        Returns: Json
      }
      use_shield_from_inventory: { Args: { _item_id: string }; Returns: Json }
      user_market_remaining: { Args: { _uid: string }; Returns: number }
      users_same_device: { Args: { _a: string; _b: string }; Returns: boolean }
      validate_display_name: { Args: { p_name: string }; Returns: string }
      verify_and_get_vip_status: {
        Args: { _user_id: string }
        Returns: {
          combat_multiplier: number
          elite_level: number
          is_vip: boolean
        }[]
      }
      verify_session_integrity: { Args: { _token: string }; Returns: boolean }
      warn_overfull_tribes: { Args: never; Returns: number }
      xp_gain_scale: { Args: { _level: number }; Returns: number }
      xp_progress: { Args: { _user: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      lucky_box_rarity: "common" | "rare" | "legendary"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      lucky_box_rarity: ["common", "rare", "legendary"],
    },
  },
} as const
