import {platformKey} from '../_shared/config.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Content-Type':'application/json'};
Deno.serve(async req => {
 if(req.method==='OPTIONS') return new Response('ok',{headers});
 if(req.method!=='POST') return new Response('Method not allowed',{status:405,headers});
 try {
 const client=createClient(Deno.env.get('SUPABASE_URL')!,platformKey('publishable'),{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 const {data:{user},error}=await client.auth.getUser();
 if(error||!user) return new Response('Unauthorized',{status:401,headers});
 const {cancellationEventId}=await req.json();
 if(!cancellationEventId) return new Response('Committed event required',{status:400,headers});
 const {data:event,error:eventError}=await client.from('cancellation_events').select('id,notified').eq('id',cancellationEventId).single();
 if(eventError||!event) return new Response('Event unavailable',{status:404,headers});
 return Response.json({status:event.notified?'completed':'queued'},{headers});
 } catch(error) { console.error(error); return Response.json({error:'Notification request failed'},{status:500,headers}); }
});
