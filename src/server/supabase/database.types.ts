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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_memberships: {
        Row: {
          created_at: string
          is_active: boolean
          role: Database["public"]["Enums"]["admin_role"]
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["admin_role"]
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["admin_role"]
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_memberships_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          slug: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          slug: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name?: string
          slug?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      option_groups: {
        Row: {
          applicable_category_kinds: Database["public"]["Enums"]["category_kind"][]
          created_at: string
          id: string
          is_required: boolean
          maximum_selections: number
          minimum_selections: number
          name: string
          selection_mode: Database["public"]["Enums"]["option_selection_mode"]
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          applicable_category_kinds?: Database["public"]["Enums"]["category_kind"][]
          created_at?: string
          id?: string
          is_required?: boolean
          maximum_selections?: number
          minimum_selections?: number
          name: string
          selection_mode: Database["public"]["Enums"]["option_selection_mode"]
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          applicable_category_kinds?: Database["public"]["Enums"]["category_kind"][]
          created_at?: string
          id?: string
          is_required?: boolean
          maximum_selections?: number
          minimum_selections?: number
          name?: string
          selection_mode?: Database["public"]["Enums"]["option_selection_mode"]
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_groups_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      options: {
        Row: {
          created_at: string
          description: string
          id: string
          is_available: boolean
          name: string
          option_group_id: string
          price_delta_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_available?: boolean
          name: string
          option_group_id: string
          price_delta_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_available?: boolean
          name?: string
          option_group_id?: string
          price_delta_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "options_option_group_id_fkey"
            columns: ["option_group_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          customer_name: string | null
          customer_phone: string | null
          expires_at: string | null
          external_reference: string
          id: string
          idempotency_key: string
          provider: string
          provider_payment_id: string | null
          provider_preference_id: string | null
          provider_status: string | null
          quote_id: string | null
          status: Database["public"]["Enums"]["payment_attempt_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          external_reference: string
          id?: string
          idempotency_key: string
          provider?: string
          provider_payment_id?: string | null
          provider_preference_id?: string | null
          provider_status?: string | null
          quote_id?: string | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          external_reference?: string
          id?: string
          idempotency_key?: string
          provider?: string
          provider_payment_id?: string | null
          provider_preference_id?: string | null
          provider_status?: string | null
          quote_id?: string | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_quote_store_fk"
            columns: ["quote_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_quotes"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_attempts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_quotes: {
        Row: {
          created_at: string
          currency: string
          delivery_cents: number
          discount_cents: number
          expires_at: string
          fulfillment_channel: Database["public"]["Enums"]["fulfillment_channel"]
          id: string
          lines: Json
          store_id: string
          subtotal_cents: number
          total_cents: number
        }
        Insert: {
          created_at?: string
          currency?: string
          delivery_cents?: number
          discount_cents?: number
          expires_at: string
          fulfillment_channel: Database["public"]["Enums"]["fulfillment_channel"]
          id?: string
          lines: Json
          store_id: string
          subtotal_cents: number
          total_cents: number
        }
        Update: {
          created_at?: string
          currency?: string
          delivery_cents?: number
          discount_cents?: number
          expires_at?: string
          fulfillment_channel?: Database["public"]["Enums"]["fulfillment_channel"]
          id?: string
          lines?: Json
          store_id?: string
          subtotal_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_quotes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          claimed_at: string
          completed_at: string | null
          delivery_count: number
          event_id: string
          last_error_code: string | null
          processing_status: Database["public"]["Enums"]["payment_webhook_processing_status"]
          provider: string
          provider_payment_id: string
          received_at: string
        }
        Insert: {
          claimed_at?: string
          completed_at?: string | null
          delivery_count?: number
          event_id: string
          last_error_code?: string | null
          processing_status?: Database["public"]["Enums"]["payment_webhook_processing_status"]
          provider?: string
          provider_payment_id: string
          received_at?: string
        }
        Update: {
          claimed_at?: string
          completed_at?: string | null
          delivery_count?: number
          event_id?: string
          last_error_code?: string | null
          processing_status?: Database["public"]["Enums"]["payment_webhook_processing_status"]
          provider?: string
          provider_payment_id?: string
          received_at?: string
        }
        Relationships: []
      }
      product_images: {
        Row: {
          alt_text: string
          created_at: string
          focal_x: number
          focal_y: number
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text: string
          created_at?: string
          focal_x?: number
          focal_y?: number
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          alt_text?: string
          created_at?: string
          focal_x?: number
          focal_y?: number
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_option_groups: {
        Row: {
          created_at: string
          default_option_ids: string[]
          maximum_selections_override: number | null
          minimum_selections_override: number | null
          option_group_id: string
          product_id: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          default_option_ids?: string[]
          maximum_selections_override?: number | null
          minimum_selections_override?: number | null
          option_group_id: string
          product_id: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          default_option_ids?: string[]
          maximum_selections_override?: number | null
          minimum_selections_override?: number | null
          option_group_id?: string
          product_id?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_groups_group_fk"
            columns: ["option_group_id", "store_id"]
            isOneToOne: false
            referencedRelation: "option_groups"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_option_groups_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
        ]
      }
      products: {
        Row: {
          alcohol_by_volume: number
          base_price_cents: number
          category_id: string
          contains_alcohol: boolean
          created_at: string
          description: string
          dietary_metadata: Json
          id: string
          is_available: boolean
          is_featured: boolean
          is_published: boolean
          name: string
          requires_age_verification: boolean
          slug: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          alcohol_by_volume?: number
          base_price_cents?: number
          category_id: string
          contains_alcohol?: boolean
          created_at?: string
          description?: string
          dietary_metadata?: Json
          id?: string
          is_available?: boolean
          is_featured?: boolean
          is_published?: boolean
          name: string
          requires_age_verification?: boolean
          slug: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          alcohol_by_volume?: number
          base_price_cents?: number
          category_id?: string
          contains_alcohol?: boolean
          created_at?: string
          description?: string
          dietary_metadata?: Json
          id?: string
          is_available?: boolean
          is_featured?: boolean
          is_published?: boolean
          name?: string
          requires_age_verification?: boolean
          slug?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_store_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_items: {
        Row: {
          created_at: string
          product_id: string
          promotion_id: string
          quantity: number
          store_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          promotion_id: string
          quantity?: number
          store_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          promotion_id?: string
          quantity?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_items_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_rules"
            referencedColumns: ["id", "store_id"]
          },
        ]
      }
      promotion_rules: {
        Row: {
          applies_to_delivery: boolean
          applies_to_pickup: boolean
          badge_text: string | null
          buy_quantity: number | null
          created_at: string
          description: string
          ends_at: string
          fixed_price_cents: number | null
          get_quantity: number | null
          id: string
          is_active: boolean
          name: string
          percent_off: number | null
          priority: number
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          slug: string
          starts_at: string
          store_id: string
          updated_at: string
        }
        Insert: {
          applies_to_delivery?: boolean
          applies_to_pickup?: boolean
          badge_text?: string | null
          buy_quantity?: number | null
          created_at?: string
          description?: string
          ends_at: string
          fixed_price_cents?: number | null
          get_quantity?: number | null
          id?: string
          is_active?: boolean
          name: string
          percent_off?: number | null
          priority: number
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          slug: string
          starts_at: string
          store_id: string
          updated_at?: string
        }
        Update: {
          applies_to_delivery?: boolean
          applies_to_pickup?: boolean
          badge_text?: string | null
          buy_quantity?: number | null
          created_at?: string
          description?: string
          ends_at?: string
          fixed_price_cents?: number | null
          get_quantity?: number | null
          id?: string
          is_active?: boolean
          name?: string
          percent_off?: number | null
          priority?: number
          promotion_type?: Database["public"]["Enums"]["promotion_type"]
          slug?: string
          starts_at?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_schedule: {
        Row: {
          created_at: string
          day_of_week: number
          ends_at: string
          id: string
          promotion_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          ends_at: string
          id?: string
          promotion_id: string
          starts_at: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          ends_at?: string
          id?: string
          promotion_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_schedule_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotion_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      store_business_hours: {
        Row: {
          closes_at: string
          created_at: string
          day_of_week: number
          id: string
          opens_at: string
          store_id: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          day_of_week: number
          id?: string
          opens_at: string
          store_id: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          day_of_week?: number
          id?: string
          opens_at?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_business_hours_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_payment_methods: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_enabled: boolean
          method: Database["public"]["Enums"]["payment_method_kind"]
          public_instructions: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_enabled?: boolean
          method: Database["public"]["Enums"]["payment_method_kind"]
          public_instructions?: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_enabled?: boolean
          method?: Database["public"]["Enums"]["payment_method_kind"]
          public_instructions?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_payment_methods_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          business_hours: Json
          created_at: string
          currency: string
          delivery_fee_cents: number | null
          id: string
          is_open: boolean
          is_public: boolean
          name: string
          slug: string
          status_override: Database["public"]["Enums"]["store_status_override"]
          timezone: string
          updated_at: string
          whatsapp_e164: string
        }
        Insert: {
          business_hours?: Json
          created_at?: string
          currency?: string
          delivery_fee_cents?: number | null
          id?: string
          is_open?: boolean
          is_public?: boolean
          name: string
          slug: string
          status_override?: Database["public"]["Enums"]["store_status_override"]
          timezone?: string
          updated_at?: string
          whatsapp_e164: string
        }
        Update: {
          business_hours?: Json
          created_at?: string
          currency?: string
          delivery_fee_cents?: number | null
          id?: string
          is_open?: boolean
          is_public?: boolean
          name?: string
          slug?: string
          status_override?: Database["public"]["Enums"]["store_status_override"]
          timezone?: string
          updated_at?: string
          whatsapp_e164?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_move_promotion: {
        Args: {
          direction: string
          target_promotion_id: string
          target_store_id: string
        }
        Returns: boolean
      }
      admin_save_promotion: {
        Args: {
          items: Json
          promotion: Json
          schedule: Json
          target_promotion_id: string
          target_store_id: string
        }
        Returns: string
      }
      apply_mercado_pago_payment: {
        Args: {
          target_amount_cents: number
          target_currency: string
          target_external_reference: string
          target_provider_payment_id: string
          target_provider_status: string
        }
        Returns: string
      }
      claim_payment_webhook_event: {
        Args: { target_event_id: string; target_provider_payment_id: string }
        Returns: string
      }
    }
    Enums: {
      admin_role: "owner" | "admin"
      category_kind: "burger" | "sandwich" | "side" | "drink" | "other"
      fulfillment_channel: "delivery" | "pickup"
      option_selection_mode: "single" | "multiple"
      payment_attempt_status:
        | "created"
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "refunded"
        | "expired"
      payment_method_kind: "cash" | "bank_transfer" | "mercado_pago"
      payment_webhook_processing_status: "processing" | "completed" | "failed"
      promotion_type:
        | "fixed_price"
        | "percent_off"
        | "buy_x_get_y"
        | "free_delivery"
      store_status_override: "auto" | "open" | "paused" | "closed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      admin_role: ["owner", "admin"],
      category_kind: ["burger", "sandwich", "side", "drink", "other"],
      fulfillment_channel: ["delivery", "pickup"],
      option_selection_mode: ["single", "multiple"],
      payment_attempt_status: [
        "created",
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "refunded",
        "expired",
      ],
      payment_method_kind: ["cash", "bank_transfer", "mercado_pago"],
      payment_webhook_processing_status: ["processing", "completed", "failed"],
      promotion_type: [
        "fixed_price",
        "percent_off",
        "buy_x_get_y",
        "free_delivery",
      ],
      store_status_override: ["auto", "open", "paused", "closed"],
    },
  },
} as const
