import { supabase } from '../supabaseClient';
import type {RpcArgs, bookings} from '../types/database';
type Range = Pick<bookings, 'tool_id'|'project'|'date'|'time'|'end_time'>;
async function command<N extends keyof RpcArgs>(name: N, args: RpcArgs[N]) {
 const {data,error} = await supabase.rpc(name,args);
 if(error) throw error;
 return data;
}
export const createBookings = (ranges: Range[]): Promise<bookings[]> => command('create_bookings',{p_ranges:ranges.map(({tool_id,project,date,time,end_time})=>({tool_id,project,date,time,end_time}))});
export const updateBookingGroup = (args: RpcArgs['update_booking_group']): Promise<bookings> => command('update_booking_group',args);
export const cancelBookingGroup = (ids: number[],notify: boolean): Promise<{cancelled_ids:number[],event_ids:string[]}> => command('cancel_booking_group',{p_ids:ids,p_notify_users:notify});
export const bookingError = (error: {code?:string,message?:string}) => error.code==='23P01'?'That time was just reserved. Refresh availability and choose another time.':error.message||'Booking request failed.';
