import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {setup} from '../tests/support/database.js';
const envelope=JSON.parse(fs.readFileSync('.release-secrets/pre-release.encrypted.json','utf8'));
const keyText=execFileSync('pwsh.exe',['-NoProfile','-Command',`$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}`],{input:envelope.protectedKey,encoding:'utf8',windowsHide:true}).trim();
const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(keyText,'base64'),Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
const backup=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
const db=await setup(true);
try {
 await db.exec('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title text; DELETE FROM tools;');
 for(const table of ['auth.users','profiles','tools','bookings','training_requests']) {
 const rows=backup[table==='auth.users'?'auth_users':table];
 const [schema,name]=table.includes('.')?table.split('.'):['public',table];
 const columns=(await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,name])).rows.map(r=>r.column_name);
 for(const row of rows) {
 const keys=Object.keys(row).filter(k=>columns.includes(k));
 const unknown=Object.keys(row).filter(k=>!columns.includes(k)&&row[k]!=null);if(unknown.length) throw new Error('Snapshot has unreconciled columns on '+table+': '+unknown.join(','));
 await db.query(`INSERT INTO ${schema}.${name} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>typeof row[k]==='object'&&row[k]!==null&&!Array.isArray(row[k])?JSON.stringify(row[k]):row[k]));
 }
 }
 for(const file of fs.readdirSync('supabase/migrations').sort().filter(f=>f>='202611')) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 for(const table of ['tools','profiles','bookings','training_requests']) assert.equal((await db.query('SELECT count(*)::integer AS n FROM '+table)).rows[0].n,backup[table].length,table+' count changed');
 for(const p of backup.profiles) {const actual=(await db.query('SELECT licenses FROM profiles WHERE id=$1',[p.id])).rows[0]; if(JSON.stringify(actual.licenses)!==JSON.stringify(p.licenses)) throw new Error('Access levels changed');}
 for(const b of backup.bookings) {const actual=(await db.query('SELECT starts_at,ends_at FROM bookings WHERE id=$1',[b.id])).rows[0];if(new Date(actual.starts_at).getTime()!==new Date(b.starts_at).getTime()||new Date(actual.ends_at).getTime()!==new Date(b.ends_at).getTime())throw new Error('Booking interval changed');}
 console.log(JSON.stringify({restored:true,upgradeVerified:true,profiles:backup.profiles.length,tools:backup.tools.length,bookings:backup.bookings.length}));
} catch(error) { console.error('Restore drill failed: '+error.message); process.exitCode=1; } finally {await db.close();}
