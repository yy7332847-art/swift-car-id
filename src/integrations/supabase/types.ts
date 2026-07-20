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
      admin_audit_log: {
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
      detected_plates: {
        Row: {
          accuracy: number | null
          client_id: string | null
          confidence: number | null
          correction_note: string | null
          detected_at: string
          duplicate_decision: string | null
          duplicate_distance_m: number | null
          duplicate_gap_seconds: number | null
          duplicate_of_id: string | null
          id: string
          is_incomplete: boolean
          is_matched: boolean
          latitude: number | null
          longitude: number | null
          matched_plate_id: string | null
          plate_normalized: string | null
          plate_raw: string | null
          session_id: string
          spoken_text: string | null
          suspect_part: string | null
          user_id: string
        }
        Insert: {
          accuracy?: number | null
          client_id?: string | null
          confidence?: number | null
          correction_note?: string | null
          detected_at?: string
          duplicate_decision?: string | null
          duplicate_distance_m?: number | null
          duplicate_gap_seconds?: number | null
          duplicate_of_id?: string | null
          id?: string
          is_incomplete?: boolean
          is_matched?: boolean
          latitude?: number | null
          longitude?: number | null
          matched_plate_id?: string | null
          plate_normalized?: string | null
          plate_raw?: string | null
          session_id: string
          spoken_text?: string | null
          suspect_part?: string | null
          user_id: string
        }
        Update: {
          accuracy?: number | null
          client_id?: string | null
          confidence?: number | null
          correction_note?: string | null
          detected_at?: string
          duplicate_decision?: string | null
          duplicate_distance_m?: number | null
          duplicate_gap_seconds?: number | null
          duplicate_of_id?: string | null
          id?: string
          is_incomplete?: boolean
          is_matched?: boolean
          latitude?: number | null
          longitude?: number | null
          matched_plate_id?: string | null
          plate_normalized?: string | null
          plate_raw?: string | null
          session_id?: string
          spoken_text?: string | null
          suspect_part?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "detected_plates_duplicate_of_id_fkey"
            columns: ["duplicate_of_id"]
            isOneToOne: false
            referencedRelation: "detected_plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detected_plates_matched_plate_id_fkey"
            columns: ["matched_plate_id"]
            isOneToOne: false
            referencedRelation: "plates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detected_plates_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "recognition_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          description: string | null
          duration_days: number
          id: string
          is_active: boolean
          is_free: boolean
          max_sessions_per_day: number | null
          max_uploads: number | null
          name: string
          price_egp: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_days: number
          id?: string
          is_active?: boolean
          is_free?: boolean
          max_sessions_per_day?: number | null
          max_uploads?: number | null
          name: string
          price_egp?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_days?: number
          id?: string
          is_active?: boolean
          is_free?: boolean
          max_sessions_per_day?: number | null
          max_uploads?: number | null
          name?: string
          price_egp?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      plate_batches: {
        Row: {
          activated_at: string | null
          created_at: string
          file_name: string
          id: string
          is_active: boolean
          plates_count: number
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          file_name: string
          id?: string
          is_active?: boolean
          plates_count?: number
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          file_name?: string
          id?: string
          is_active?: boolean
          plates_count?: number
          user_id?: string
        }
        Relationships: []
      }
      plates: {
        Row: {
          bank: string | null
          batch_id: string
          car_type: string | null
          chassis: string | null
          created_at: string
          digits: string | null
          id: string
          letters: string | null
          plate_date: string | null
          plate_normalized: string
          plate_raw: string
          user_id: string
        }
        Insert: {
          bank?: string | null
          batch_id: string
          car_type?: string | null
          chassis?: string | null
          created_at?: string
          digits?: string | null
          id?: string
          letters?: string | null
          plate_date?: string | null
          plate_normalized: string
          plate_raw: string
          user_id: string
        }
        Update: {
          bank?: string | null
          batch_id?: string
          car_type?: string | null
          chassis?: string | null
          created_at?: string
          digits?: string | null
          id?: string
          letters?: string | null
          plate_date?: string | null
          plate_normalized?: string
          plate_raw?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "plate_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_requests: {
        Row: {
          admin_note: string | null
          contact: string | null
          created_at: string
          id: string
          note: string | null
          package_id: string
          processed_at: string | null
          processed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          note?: string | null
          package_id: string
          processed_at?: string | null
          processed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          note?: string | null
          package_id?: string
          processed_at?: string | null
          processed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      recognition_sessions: {
        Row: {
          client_id: string | null
          ended_at: string | null
          id: string
          notes: string | null
          path: Json
          start_latitude: number | null
          start_longitude: number | null
          started_at: string
          total_detected: number
          total_duplicates: number
          total_incomplete: number
          total_matched: number
          total_unique: number
          user_id: string
        }
        Insert: {
          client_id?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          path?: Json
          start_latitude?: number | null
          start_longitude?: number | null
          started_at?: string
          total_detected?: number
          total_duplicates?: number
          total_incomplete?: number
          total_matched?: number
          total_unique?: number
          user_id: string
        }
        Update: {
          client_id?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          path?: Json
          start_latitude?: number | null
          start_longitude?: number | null
          started_at?: string
          total_detected?: number
          total_duplicates?: number
          total_incomplete?: number
          total_matched?: number
          total_unique?: number
          user_id?: string
        }
        Relationships: []
      }
      subscription_history: {
        Row: {
          created_at: string
          ended_at: string | null
          expires_at: string | null
          id: string
          package_id: string | null
          package_name: string | null
          reason: string | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          package_id?: string | null
          package_name?: string | null
          reason?: string | null
          started_at?: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          id?: string
          package_id?: string | null
          package_name?: string | null
          reason?: string | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          package_id: string | null
          starts_at: string | null
          status: string
          suspend_reason: string | null
          suspended_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          package_id?: string | null
          starts_at?: string | null
          status?: string
          suspend_reason?: string | null
          suspended_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          package_id?: string | null
          starts_at?: string | null
          status?: string
          suspend_reason?: string | null
          suspended_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_subscription: {
        Args: { _days: number; _user_id: string }
        Returns: undefined
      }
      admin_activate_package: {
        Args: { _package_id: string; _user_id: string }
        Returns: undefined
      }
      admin_process_request: {
        Args: { _admin_note: string; _approve: boolean; _request_id: string }
        Returns: undefined
      }
      admin_set_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_suspend_user: {
        Args: { _reason: string; _user_id: string }
        Returns: undefined
      }
      admin_unsuspend_user: { Args: { _user_id: string }; Returns: undefined }
      create_purchase_request: {
        Args: { _contact: string; _note: string; _package_id: string }
        Returns: string
      }
      deactivate_subscription: {
        Args: { _user_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_active_plate_batch: {
        Args: { _batch_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
