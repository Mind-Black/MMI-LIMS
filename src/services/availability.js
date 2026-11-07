import { supabase } from '../supabaseClient';
export const BOOKING_FIELDS = 'id, tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at, created_at, status, confirmed_by, confirmed_at';
export async function fetchBookingWindow(start, end, toolId) {
 const rows = [];
 let cursor = 0;
 for (;;) {
  let query = supabase.from('bookings').select(BOOKING_FIELDS).gte('date', start).lte('date', end).gt('id', cursor).order('id').limit(500);
  if (toolId != null) query = query.eq('tool_id', toolId);
  const {data,error} = await query;
  if (error) throw error;
  if (!data?.length) return rows;
  rows.push(...data);
  cursor = data[data.length-1].id;
 }
}
