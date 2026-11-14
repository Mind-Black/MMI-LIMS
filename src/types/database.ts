// Generated from the complete repository migration chain. Run npm run types:generate.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export interface booking_external_mappings {
 id: string;
 tool_id: number;
 booking_id: number | null;
 external_id: string;
 origin: string;
 service_id: string | null;
 service_name: string | null;
 booker_email: string | null;
 updated_at: string;
}
export interface bookings {
 id: number;
 tool_id: number;
 tool_name: string;
 user_id: string;
 user_name: string;
 project: string;
 date: string;
 time: string;
 end_time: string;
 created_at: string;
 starts_at: string;
 ends_at: string;
 status: string;
 confirmed_by: string | null;
 confirmed_at: string | null;
}
export interface cancellation_events {
 id: string;
 booking_id: number | null;
 tool_id: number;
 user_id: string;
 cancelled_by: string;
 tool_name: string;
 date: string;
 time: string;
 end_time: string;
 notified: boolean;
 notified_at: string | null;
 created_at: string;
}
export interface email_logs {
 id: string;
 sender_id: string;
 recipient_email: string;
 booking_id: number | null;
 created_at: string;
}
export interface legacy_license_references {
 user_id: string;
 tool_key: string;
 access_level: string;
 recorded_at: string;
}
export interface ms_bookings_staff_mappings {
 tool_id: number;
 user_email: string;
 external_staff_id: string;
 updated_at: string;
}
export interface ms_bookings_sync_queue {
 id: string;
 tool_id: number;
 booking_id: number | null;
 action: string;
 external_id: string | null;
 payload: Json;
 status: string;
 attempts: number;
 available_at: string;
 lease: string | null;
 last_error: string | null;
 created_at: string;
 synced_at: string | null;
}
export interface notification_deliveries {
 id: string;
 event_id: string;
 recipient_id: string;
 email: string;
 status: string;
 attempts: number;
 available_at: string;
 lease: string | null;
 last_error: string | null;
 sent_at: string | null;
}
export interface profiles {
 id: string;
 first_name: string | null;
 last_name: string | null;
 access_level: string;
 is_approved: boolean;
 licenses: Json;
 projects: string[];
 updated_at: string;
 email: string | null;
 phone: string | null;
 job_title: string | null;
}
export interface tools {
 id: number;
 name: string;
 category: string;
 status: string;
 location: string | null;
 license_req: boolean;
 description: string | null;
 image_url: string | null;
 created_at: string | null;
 primary_responsible_id: string | null;
 secondary_responsible_id: string | null;
 rate_category: string;
 ms_bookings_email: string | null;
 ms_bookings_service_id: string | null;
 ms_bookings_sync_enabled: boolean;
}
export interface training_requests {
 id: number;
 tool_id: number;
 tool_name: string;
 user_id: string;
 user_name: string;
 user_email: string | null;
 description: string;
 preferred_date: string;
 status: string;
 reviewed_by: string | null;
 reviewed_at: string | null;
 notes: string | null;
 created_at: string;
}
export interface user_calendar_tokens {
 user_id: string;
 token_hash: string;
 created_at: string;
}
export interface RpcArgs {
 cancel_booking_group: {p_ids: number[]; p_notify_users: boolean};
 create_bookings: {p_ranges: Json};
 edit_profile_assignment: {p_user_id: string; p_kind: string; p_value: string; p_add: boolean};
 update_booking_group: {p_old_ids: number[]; p_date: string; p_start_time: string; p_end_time: string; p_project: string};
}
