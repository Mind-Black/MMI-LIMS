import {platformKey} from '../_shared/config.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
const escapeHtml=(text: string) => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async req => {
 const secret=Deno.env.get('NOTIFICATION_WORKER_SECRET');
 if(req.method!=='POST'||!secret||req.headers.get('Authorization')!==`Bearer ${secret}`) return new Response('Unauthorized',{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,platformKey('secret'));
 try {
 const {data:jobs,error}=await db.rpc('claim_notifications'); if(error) throw error;
 let sentCount=0,failedCount=0;
 for(const job of jobs||[]) {
 let failure: string|null=null;
 try {
 const {data:event,error}=await db.from('cancellation_events').select('tool_name,date,time').eq('id',job.event_id).single(); if(error) throw error;
 const tool=escapeHtml(event.tool_name),date=escapeHtml(event.date),time=escapeHtml(event.time);
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`cancellation-${job.id}`},body:JSON.stringify({from:Deno.env.get('EMAIL_FROM')||'MMI-LIMS <no-reply@lims.gradientfab.com>',to:job.email,subject:`Slot available: ${event.tool_name}`,html:`<p>A slot is available for <strong>${tool}</strong> on ${date} at ${time}.</p><p><a href="${escapeHtml(Deno.env.get('SITE_URL')||'https://mind-black.github.io/MMI-LIMS/')}">Open bookings</a></p>`}),signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw new Error(`Email provider returned ${response.status}`);
 sentCount++;
 } catch(error) {failure=String(error);failedCount++;}
 const {error:finishError}=await db.rpc('finish_notification',{p_id:job.id,p_lease:job.lease,p_error:failure}); if(finishError) throw finishError;
 }
 console.log(JSON.stringify({sentCount,failedCount}));
 return Response.json({sentCount,failedCount});
 } catch(error) {console.error(error);return Response.json({error:'Worker failed; unacknowledged leases will retry'},{status:500});}
});
