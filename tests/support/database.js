import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
export async function setup(beforeRepairs = false) {
 const db=new PGlite({extensions:{btree_gist,pgcrypto}});
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
 `);
 for(const file of fs.readdirSync('supabase/migrations').sort().filter(file => !beforeRepairs || file < '202611')) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 return db;
}
