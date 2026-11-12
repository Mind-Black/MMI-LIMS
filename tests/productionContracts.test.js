import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup} from './support/database.js';
const A='11111111-1111-1111-1111-111111111111', B='22222222-2222-2222-2222-222222222222';
async function actor(db,id,role='authenticated') {await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('SET ROLE '+role);}
test('Production contracts: signup, authorization, booking, cancellation and delivery recovery',async t=>{
 const db=await setup();t.after(()=>db.close());
 await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'a@example.com','{"access_level":"admin","is_approved":true,"job_title":"Scientist"}'),($2,'b@example.com','{}')`,[A,B]);
 let p=(await db.query('SELECT * FROM profiles WHERE id=$1',[A])).rows[0];
 assert.equal(p.job_title,'Scientist');assert.equal(p.access_level,'user');assert.equal(p.is_approved,false);
 await actor(db,null,'anon');await assert.rejects(db.query('SELECT * FROM profiles'),/permission denied/);
 await actor(db,null);assert.equal((await db.query('SELECT * FROM profiles')).rows.length,0);
 await assert.rejects(db.query("SELECT public.create_bookings('[]')"),/Not authenticated/);
 await actor(db,A);assert.equal((await db.query('SELECT * FROM profiles')).rows.length,1);
 await assert.rejects(db.query("UPDATE profiles SET access_level='admin' WHERE id=$1",[A]),/Unauthorized/);
 await actor(db,null,'none');await db.query("UPDATE profiles SET is_approved=true,licenses=jsonb_build_object('1','level_3') WHERE id IN ($1,$2)",[A,B]);
 await actor(db,A);
 const date='2035-01-15';
 const ranges=[{tool_id:1,project:'General',date,time:'10:00',end_time:'11:00'},{tool_id:1,project:'General',date,time:'12:00',end_time:'13:00'}];
 const rows=(await db.query('SELECT * FROM create_bookings($1)',[JSON.stringify(ranges)])).rows;
 assert.equal(rows.length,2);assert.equal(new Date(rows[0].ends_at)-new Date(rows[0].starts_at),3600000);
 const updated=(await db.query("SELECT update_booking_group($1,$2,'10:00','11:30','General') AS b",[[rows[0].id],date])).rows[0].b;
 assert.equal(updated.id,rows[0].id);assert.equal(new Date(updated.created_at).getTime(),new Date(rows[0].created_at).getTime());
 await assert.rejects(db.query('SELECT * FROM create_bookings($1)',[JSON.stringify(ranges)]),/conflict|overlap/);
 await assert.rejects(db.query('SELECT cancel_booking_group($1,true)',[[rows[0].id,999999]]),/unavailable/);
 assert.equal((await db.query('SELECT * FROM bookings')).rows.length,2);
 const result=(await db.query('SELECT cancel_booking_group($1,true) AS r',[[rows[0].id,rows[1].id]])).rows[0].r;
 assert.equal(result.cancelled_ids.length,2);assert.equal(result.event_ids.length,2);
 await assert.rejects(db.query('SELECT * FROM claim_notifications()'),/permission denied/);
 await actor(db,null,'none');
 let jobs=(await db.query('SELECT * FROM claim_notifications()')).rows;assert.equal(jobs.length,2);
 assert.equal((await db.query('SELECT * FROM claim_notifications()')).rows.length,0);
 await db.query('SELECT finish_notification($1,$2,$3)',[jobs[0].id,jobs[0].lease,'provider failure']);
 assert.equal((await db.query('SELECT notified FROM cancellation_events WHERE id=$1',[jobs[0].event_id])).rows[0].notified,false);
 await db.query('SELECT finish_notification($1,$2,NULL)',[jobs[1].id,jobs[1].lease]);
 assert.equal((await db.query('SELECT notified FROM cancellation_events WHERE id=$1',[jobs[1].event_id])).rows[0].notified,true);
 await assert.rejects(db.query("SELECT lab_instant('2026-03-29','03:30')"),/Nonexistent/);
 await assert.rejects(db.query("SELECT lab_instant('2026-10-25','03:30')"),/ambiguous/);
 // An ongoing booking may change its end, but not its start or be cancelled.
 await db.query("INSERT INTO bookings(tool_id,user_id,tool_name,user_name,project,date,time,end_time) VALUES(1,$1,'','','General',((now() AT TIME ZONE 'Europe/Vilnius')-interval '30 minutes')::date,((now() AT TIME ZONE 'Europe/Vilnius')-interval '30 minutes')::time,((now() AT TIME ZONE 'Europe/Vilnius')+interval '30 minutes')::time)",[A]);
 await actor(db,A);
 const ongoing=(await db.query('SELECT * FROM bookings')).rows[0];
 await assert.rejects(db.query('SELECT cancel_booking_group($1,false)',[[ongoing.id]]),/start/);
 await db.query("UPDATE bookings SET end_time=(end_time+interval '10 minutes')::time WHERE id=$1",[ongoing.id]);
 await assert.rejects(db.query("UPDATE bookings SET time=(time+interval '1 minute')::time WHERE id=$1",[ongoing.id]),/start time/);
});

test('Forward upgrade preserves legacy data and backfills profiles; graded licenses retain their access level',async t=>{
 const db=await setup(true);t.after(()=>db.close());
 await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[A,'legacy@example.com']);
 await db.query("INSERT INTO profiles(id,licenses,is_approved) VALUES($1,'[1,1]',true)",[A]);
 await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[B,'missing@example.com']);
 const repair=fs.readFileSync('supabase/migrations/20261107000001_production_contracts.sql','utf8');
 await db.exec(repair);
 assert.deepEqual((await db.query('SELECT licenses FROM profiles WHERE id=$1',[A])).rows[0].licenses,{'1':'level_3'});
 assert.equal((await db.query('SELECT is_approved FROM profiles WHERE id=$1',[B])).rows[0].is_approved,false);
 const other=await setup(true);t.after(()=>other.close());
 await other.query('INSERT INTO auth.users(id) VALUES($1)',[A]);
 await other.query(`INSERT INTO profiles(id,licenses) VALUES($1,jsonb_build_object('1','level_2'))`,[A]);
 await other.exec(repair);
 assert.deepEqual((await other.query('SELECT licenses FROM profiles')).rows[0].licenses,{'1':'level_2'});
});
test('Quota reservations fail closed; approval revocation removes private feed tokens',async t=>{
 const db=await setup();t.after(()=>db.close());
 await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[A,'quota@example.com']);
 await db.query('UPDATE profiles SET is_approved=true WHERE id=$1',[A]);await actor(db,A);
 for(let i=0;i<20;i++) await db.query('SELECT reserve_email_quota(1)');
 await assert.rejects(db.query('SELECT reserve_email_quota(1)'),/quota exceeded/);
 await db.query('SELECT rotate_calendar_token($1)',['a'.repeat(64)]);
 await actor(db,null,'none');await db.query('UPDATE profiles SET is_approved=false WHERE id=$1',[A]);
 assert.equal((await db.query('SELECT * FROM user_calendar_tokens')).rows.length,0);
});

test('Only admins can write tools; callers without an identity cannot',async t=>{
 const db=await setup();t.after(()=>db.close());
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'admin@example.com'),($2,'user@example.com')",[A,B]);
 await db.query("UPDATE profiles SET is_approved=true WHERE id IN ($1,$2)",[A,B]);
 await db.query("UPDATE profiles SET access_level='admin' WHERE id=$1",[A]);
 const insert="INSERT INTO tools(name,category) VALUES('New tool','Test')";
 await actor(db,null);await assert.rejects(db.query(insert),/row-level/);
 assert.equal((await db.query("UPDATE tools SET status='down' WHERE id=1")).affectedRows,0);
 await actor(db,B);await assert.rejects(db.query(insert),/row-level/);
 assert.equal((await db.query("UPDATE tools SET status='down' WHERE id=1")).affectedRows,0);
 await actor(db,A);await db.query(insert);
 assert.equal((await db.query("UPDATE tools SET status='down' WHERE id=1")).affectedRows,1);
 // Production carried hand-made duplicate policies; the migration must remove them.
 await actor(db,null,'none');
 await db.exec(`CREATE POLICY "Admins can update tools" ON tools FOR UPDATE TO authenticated USING(true);
  CREATE POLICY "Public tools are viewable by everyone" ON tools FOR SELECT TO authenticated USING(true);
  CREATE POLICY "Tools viewable by authenticated users" ON tools FOR SELECT USING(true);
  CREATE POLICY "Calendar token access restricted to owner" ON user_calendar_tokens FOR ALL USING(true);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261112191937_tools_admin_policy.sql','utf8'));
 const policies=(await db.query("SELECT tablename||'.'||policyname AS p FROM pg_policies WHERE tablename IN ('tools','user_calendar_tokens') ORDER BY 1")).rows.map(r=>r.p);
 assert.deepEqual(policies,['tools.tools_admin_all','tools.tools_read_all','user_calendar_tokens.user_calendar_tokens_owner']);
 await actor(db,B);assert.equal((await db.query("UPDATE tools SET status='up' WHERE id=1")).affectedRows,0);
 await actor(db,null);assert.equal((await db.query("UPDATE tools SET status='up' WHERE id=1")).affectedRows,0);
});

test('Graded access, confirmation and training remain secure for owners and tool managers',async t=>{
 const db=await setup();t.after(()=>db.close());
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'trainee@example.com'),($2,'manager@example.com')",[A,B]);
 await db.query("UPDATE profiles SET is_approved=true,licenses=jsonb_build_object('1','level_2') WHERE id=$1",[A]);
 await db.query('UPDATE profiles SET is_approved=true WHERE id=$1',[B]);
 await db.query('UPDATE tools SET primary_responsible_id=$1 WHERE id=1',[B]);
 await actor(db,A);
 const ranges=[{tool_id:1,project:'General',date:'2035-02-01',time:'10:00',end_time:'11:00'}];
 const b=(await db.query('SELECT * FROM create_bookings($1)',[JSON.stringify(ranges)])).rows[0];assert.equal(b.status,'pending_approval');
 await assert.rejects(db.query('SELECT confirm_booking($1)',[b.id]),/manager/);
 await assert.rejects(db.query("UPDATE bookings SET status='confirmed' WHERE id=$1",[b.id]),/managers/);
 await actor(db,B);await db.query('SELECT confirm_booking($1)',[b.id]);
 assert.equal((await db.query('SELECT status FROM bookings WHERE id=$1',[b.id])).rows[0].status,'confirmed');
 await db.query("SELECT set_user_tool_license($1,1,'level_3')",[A]);
 assert.equal((await db.query('SELECT licenses FROM profiles WHERE id=$1',[A])).rows[0].licenses['1'],'level_3');
 await assert.rejects(db.query("SELECT set_user_tool_license($1,2,'level_3')",[A]),/manager/);
 await actor(db,A);
 await assert.rejects(db.query("INSERT INTO training_requests(tool_id,tool_name,user_id,user_name,description,preferred_date) VALUES(1,'Tool',$1,'Other','Training','2035-01-01')",[B]),/row-level|owner/);
 const r=(await db.query("INSERT INTO training_requests(tool_id,tool_name,user_id,user_name,description,preferred_date,status) VALUES(1,'Spoofed',$1,'Spoofed','Training','2035-01-01','approved') RETURNING *",[A])).rows[0];
 assert.equal(r.status,'pending');assert.notEqual(r.tool_name,'Spoofed');
 await actor(db,B);await db.query('SELECT approve_training_request($1)',[r.id]);
 assert.equal((await db.query('SELECT licenses FROM profiles WHERE id=$1',[A])).rows[0].licenses['1'],'level_3','Existing higher access must not be downgraded');
 await assert.rejects(db.query('SELECT approve_training_request($1)',[r.id]),/already reviewed/);
});

test('Admin email invitations enforce RLS, protect token_hash, auto-approve on accept, and respect revocation',async t=>{
 const db=await setup();t.after(()=>db.close());
 const C='33333333-3333-3333-3333-333333333333', D='44444444-4444-4444-4444-444444444444';
 await db.query("INSERT INTO auth.users(id,email) VALUES($1,'admin@example.com'),($2,'user@example.com')",[A,B]);
 await db.query("UPDATE profiles SET is_approved=true WHERE id IN ($1,$2)",[A,B]);
 await db.query("UPDATE profiles SET access_level='admin' WHERE id=$1",[A]);

 const tokenHash1='a'.repeat(64);
 const tokenHash2='b'.repeat(64);
 const inv1=(await db.query(`INSERT INTO user_invitations(email,token_hash,first_name,last_name,job_title,projects,invited_by)
  VALUES('invitee@example.com',$1,'Ada','Lovelace','Researcher',ARRAY['Photonics','Nanotech'],$2) RETURNING id`,[tokenHash1,A])).rows[0];
 const inv2=(await db.query(`INSERT INTO user_invitations(email,token_hash,invited_by)
  VALUES('revoked@example.com',$1,$2) RETURNING id`,[tokenHash2,A])).rows[0];

 // Anon & non-admin cannot read user_invitations; token_hash is never selectable by authenticated
 await actor(db,null,'anon');
 await assert.rejects(db.query('SELECT id FROM user_invitations'),/permission denied/);
 const anonLookup=(await db.query('SELECT get_invitation_by_token($1) AS inv',[tokenHash1])).rows[0].inv;
 assert.equal(anonLookup.email,'invitee@example.com');
 assert.deepEqual(anonLookup.projects,['Photonics','Nanotech']);

 await actor(db,B);
 assert.equal((await db.query('SELECT id,email FROM user_invitations')).rows.length,0);
 await assert.rejects(db.query('SELECT revoke_user_invitation($1)',[inv2.id]),/Admin required/);

 await actor(db,A);
 assert.equal((await db.query('SELECT id,email,status FROM user_invitations')).rows.length,2);
 await assert.rejects(db.query('SELECT token_hash FROM user_invitations'),/permission denied/);

 // Revoke inv2 as admin
 const revoked=(await db.query('SELECT revoke_user_invitation($1) AS r',[inv2.id])).rows[0].r;
 assert.equal(revoked.status,'revoked');
 assert.equal((await db.query('SELECT get_invitation_by_token($1) AS inv',[tokenHash2])).rows[0].inv,null);

 // Accepting inv1 via user creation auto-approves and applies projects & fallback profile fields
 await actor(db,null,'none');
 await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'invitee@example.com','{}')`,[C]);
 const invitedProfile=(await db.query('SELECT * FROM profiles WHERE id=$1',[C])).rows[0];
 assert.equal(invitedProfile.is_approved,true);
 assert.equal(invitedProfile.access_level,'user');
 assert.equal(invitedProfile.first_name,'Ada');
 assert.equal(invitedProfile.last_name,'Lovelace');
 assert.equal(invitedProfile.job_title,'Researcher');
 assert.deepEqual(invitedProfile.projects,['Photonics','Nanotech']);
 assert.equal((await db.query('SELECT status FROM user_invitations WHERE id=$1',[inv1.id])).rows[0].status,'accepted');
 assert.equal((await db.query('SELECT get_invitation_by_token($1) AS inv',[tokenHash1])).rows[0].inv,null);

 // Revoked invitation does not auto-approve
 await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'revoked@example.com','{}')`,[D]);
 assert.equal((await db.query('SELECT is_approved FROM profiles WHERE id=$1',[D])).rows[0].is_approved,false);
});
