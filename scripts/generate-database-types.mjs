import {setup} from '../tests/support/database.js';
import fs from 'node:fs';
const db=await setup();
const map=t=>t==='boolean'?'boolean':/^(bigint|integer|smallint|numeric|double precision)$/.test(t)?'number':t==='jsonb'?'Json':t.endsWith('[]')?map(t.slice(0,-2))+'[]':'string';
let output='// Generated from the complete repository migration chain. Run npm run types:generate.\nexport type Json = string | number | boolean | null | Json[] | { [key: string]: Json };\n';
const tables=(await db.query(`select table_name,column_name,data_type,udt_name,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows;
for(const table of [...new Set(tables.map(x=>x.table_name))]) output+=`export interface ${table} {\n`+tables.filter(x=>x.table_name===table).map(x=>` ${x.column_name}: ${map(x.data_type==='ARRAY'?x.udt_name.slice(1)+'[]':x.data_type)}${x.is_nullable==='YES'?' | null':''};`).join('\n')+'\n}\n';
output+='export interface RpcArgs {\n';
for(const f of (await db.query(`select proname,proargnames,oid from pg_proc where pronamespace='public'::regnamespace and proname in ('create_bookings','update_booking_group','cancel_booking_group','edit_profile_assignment','revoke_user_invitation','get_invitation_by_token') order by proname`)).rows) {
 const args=(await db.query('select unnest(proargnames) as name, format_type(unnest(proargtypes::oid[]),null) as type from pg_proc where oid=$1',[f.oid])).rows;
 output+=` ${f.proname}: {`+args.map(a=>`${a.name}: ${map(a.type)}`).join('; ')+'};\n';
}
output+='}\n';await db.close();
const file='src/types/database.ts';fs.mkdirSync('src/types',{recursive:true});
if(process.argv.includes('--check')) {if(fs.readFileSync(file,'utf8')!==output) throw new Error('Generated database types are stale');} else fs.writeFileSync(file,output);
