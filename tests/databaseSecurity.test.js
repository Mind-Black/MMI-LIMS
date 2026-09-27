import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

function createTestDb() {
  return new PGlite({
    extensions: {
      btree_gist,
      pgcrypto
    }
  });
}

// Helper to set up minimal auth simulation in PGlite
async function setupAuthMock(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    BEGIN
      RETURN current_setting('request.jwt.claim.sub', true)::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
    BEGIN
      RETURN COALESCE(current_setting('request.jwt.claim.role', true), 'authenticated');
    EXCEPTION WHEN OTHERS THEN
      RETURN 'authenticated';
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);
}

async function setActor(db, userId, role = 'authenticated') {
  if (role) {
    await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated`);
    await db.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated`);
    await db.query(`GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated`);
    await db.query(`SET ROLE ${role}`);
  } else {
    await db.query(`RESET ROLE`);
  }
  if (userId) {
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false)`);
  } else {
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
  await db.query(`SELECT set_config('request.jwt.claim.role', '${role}', false)`);
}

test('Migration Sequence: Fresh Database to Current Hardened Schema', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  // 1. Initial schema
  const initialSql = fs.readFileSync(path.join(migrationsDir, '20231201000000_initial_schema.sql'), 'utf8');
  await db.exec(initialSql);

  // 2. Calendar token migration
  const tokenSql = fs.readFileSync(path.join(migrationsDir, '20231214_add_calendar_token.sql'), 'utf8');
  await db.exec(tokenSql);

  // 3. Security and constraints migration
  const securitySql = fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8');
  await db.exec(securitySql);

  // Verify tables exist
  const tablesRes = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  const tables = tablesRes.rows.map(r => r.table_name);
  assert.ok(tables.includes('tools'), 'tools table should exist');
  assert.ok(tables.includes('profiles'), 'profiles table should exist');
  assert.ok(tables.includes('bookings'), 'bookings table should exist');
  assert.ok(tables.includes('user_calendar_tokens'), 'user_calendar_tokens table should exist');
  assert.ok(tables.includes('cancellation_events'), 'cancellation_events table should exist');
});

test('R1 (P0): update_booking_group prevents cross-owner deletion', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  // Run full migration chain
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231201000000_initial_schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231214_add_calendar_token.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8'));

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';

  // Seed users and profiles
  await db.query(`INSERT INTO auth.users (id, email) VALUES ('${userA}', 'a@test.com'), ('${userB}', 'b@test.com')`);
  await db.query(`INSERT INTO public.profiles (id, first_name, last_name, access_level, is_approved, licenses, projects) VALUES
    ('${userA}', 'User', 'A', 'user', true, '["1"]'::jsonb, '{"ProjectAlpha"}'),
    ('${userB}', 'User', 'B', 'user', true, '["1"]'::jsonb, '{"ProjectBeta"}')
  `);

  // Seed bookings for User A and User B tomorrow
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const b1Res = await db.query(`
    INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at)
    VALUES (1, 'Raith EBPG 5200', '${userA}', 'User A', 'ProjectAlpha', '${tomorrow}', '10:00:00', '10:30:00',
      ('${tomorrow} 10:00:00')::timestamptz, ('${tomorrow} 10:30:00')::timestamptz)
    RETURNING id;
  `);
  const b1Id = b1Res.rows[0].id;

  const b2Res = await db.query(`
    INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at)
    VALUES (1, 'Raith EBPG 5200', '${userB}', 'User B', 'ProjectBeta', '${tomorrow}', '11:00:00', '11:30:00',
      ('${tomorrow} 11:00:00')::timestamptz, ('${tomorrow} 11:30:00')::timestamptz)
    RETURNING id;
  `);
  const b2Id = b2Res.rows[0].id;

  // Act as User A
  await setActor(db, userA);

  // Attempt to update with mixed IDs [b1Id, b2Id]
  await assert.rejects(
    async () => {
      await db.query(`
        SELECT public.update_booking_group(
          ARRAY[${b1Id}, ${b2Id}]::bigint[],
          1,
          '${tomorrow}'::date,
          '10:00:00'::time,
          '11:00:00'::time,
          'ProjectAlpha',
          'User A',
          'Raith EBPG 5200'
        );
      `);
    },
    (err) => {
      assert.match(err.message, /Cannot update bookings across multiple users|Unauthorized/);
      return true;
    },
    'update_booking_group must reject mixed-owner booking IDs'
  );

  // Verify that User B booking still exists!
  const b2Check = await db.query(`SELECT id FROM public.bookings WHERE id = ${b2Id}`);
  assert.equal(b2Check.rows.length, 1, 'User B booking MUST NOT be deleted');

  // Verify that User A cannot directly delete User B booking (affected rows = 0)
  const delRes = await db.query(`DELETE FROM public.bookings WHERE id = ${b2Id}`);
  assert.equal(delRes.affectedRows || delRes.rowCount || 0, 0, 'User A delete must affect 0 rows');

  const b2StillExists = await db.query(`SELECT id FROM public.bookings WHERE id = ${b2Id}`);
  assert.equal(b2StillExists.rows.length, 1, 'User B booking must remain unaffected');
});

test('R7: Enforce project assignment and reject past modifications', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231201000000_initial_schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231214_add_calendar_token.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8'));

  const userA = '33333333-3333-3333-3333-333333333333';
  await db.query(`INSERT INTO auth.users (id, email) VALUES ('${userA}', 'c@test.com')`);
  await db.query(`INSERT INTO public.profiles (id, first_name, last_name, access_level, is_approved, licenses, projects) VALUES
    ('${userA}', 'User', 'C', 'user', true, '["1"]'::jsonb, '{"AllowedProject"}')
  `);

  await setActor(db, userA);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // 1. Reject unassigned project
  await assert.rejects(
    async () => {
      await db.query(`
        INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at)
        VALUES (1, 'Raith EBPG 5200', '${userA}', 'User C', 'UnassignedProject', '${tomorrow}', '14:00:00', '14:30:00',
          ('${tomorrow} 14:00:00')::timestamptz, ('${tomorrow} 14:30:00')::timestamptz)
      `);
    },
    (err) => {
      assert.match(err.message, /User is not assigned to project/);
      return true;
    }
  );

  // 2. Reject booking in the past
  await assert.rejects(
    async () => {
      await db.query(`
        INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at)
        VALUES (1, 'Raith EBPG 5200', '${userA}', 'User C', 'AllowedProject', '2020-01-01', '14:00:00', '14:30:00',
          '2020-01-01 14:00:00Z'::timestamptz, '2020-01-01 14:30:00Z'::timestamptz)
      `);
    },
    (err) => {
      assert.match(err.message, /Cannot create bookings in the past/);
      return true;
    }
  );
});

test('R3: First-admin provisioning works without authenticated context', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231201000000_initial_schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231214_add_calendar_token.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8'));

  const adminId = '99999999-9999-9999-9999-999999999999';
  await db.query(`INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@test.com')`);
  await db.query(`INSERT INTO public.profiles (id, first_name, last_name, access_level, is_approved) VALUES
    ('${adminId}', 'First', 'Admin', 'user', false)
  `);

  // Direct SQL update (auth.uid() is null in SQL editor)
  await setActor(db, null);
  await db.query(`UPDATE public.profiles SET access_level = 'admin', is_approved = true WHERE id = '${adminId}'`);

  const res = await db.query(`SELECT access_level, is_approved, updated_at FROM public.profiles WHERE id = '${adminId}'`);
  assert.equal(res.rows[0].access_level, 'admin');
  assert.equal(res.rows[0].is_approved, true);
  assert.ok(res.rows[0].updated_at !== null, 'updated_at must be populated');
});

test('R8: Pending accounts can only view their own profile and zero bookings', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231201000000_initial_schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20231214_add_calendar_token.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8'));

  const pendingUser = '44444444-4444-4444-4444-444444444444';
  const approvedUser = '55555555-5555-5555-5555-555555555555';

  await db.query(`INSERT INTO auth.users (id, email) VALUES ('${pendingUser}', 'pending@test.com'), ('${approvedUser}', 'approved@test.com')`);
  await db.query(`INSERT INTO public.profiles (id, first_name, last_name, access_level, is_approved) VALUES
    ('${pendingUser}', 'Pending', 'User', 'user', false),
    ('${approvedUser}', 'Approved', 'User', 'user', true)
  `);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  await db.query(`
    INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time, end_time, starts_at, ends_at)
    VALUES (1, 'Raith EBPG 5200', '${approvedUser}', 'Approved User', 'General', '${tomorrow}', '10:00:00', '10:30:00',
      ('${tomorrow} 10:00:00')::timestamptz, ('${tomorrow} 10:30:00')::timestamptz)
  `);

  // Act as pending user
  await setActor(db, pendingUser);

  // 1. Pending user selecting profiles: should ONLY see 1 row (their own)
  const profRes = await db.query(`SELECT id FROM public.profiles`);
  assert.equal(profRes.rows.length, 1, 'Pending user must only see their own profile');
  assert.equal(profRes.rows[0].id, pendingUser);

  // 2. Pending user selecting bookings: should see 0 rows
  const bookRes = await db.query(`SELECT id FROM public.bookings`);
  assert.equal(bookRes.rows.length, 0, 'Pending user must see zero bookings');

  // Act as approved user
  await setActor(db, approvedUser);
  const appProfRes = await db.query(`SELECT id FROM public.profiles`);
  assert.equal(appProfRes.rows.length, 2, 'Approved user can view directory profiles');
  const appBookRes = await db.query(`SELECT id FROM public.bookings`);
  assert.equal(appBookRes.rows.length, 1, 'Approved user can view active bookings');
});

test('R13 & R2: Upgrading legacy database with 23:30 booking safely rolls over midnight', async () => {
  const db = createTestDb();
  await setupAuthMock(db);

  // Simulate legacy database without starts_at/ends_at, with plaintext calendar_token and 23:30 booking
  await db.exec(`
    CREATE TABLE public.tools (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name text NOT NULL,
      category text NOT NULL,
      status text NOT NULL DEFAULT 'up',
      location text,
      license_req boolean NOT NULL DEFAULT true,
      description text
    );

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      first_name text,
      last_name text,
      access_level text DEFAULT 'user',
      is_approved boolean DEFAULT true,
      licenses jsonb DEFAULT '[]'::jsonb,
      calendar_token text
    );

    CREATE TABLE public.bookings (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tool_id bigint NOT NULL REFERENCES public.tools(id),
      tool_name text NOT NULL,
      user_id uuid NOT NULL,
      user_name text NOT NULL,
      project text NOT NULL,
      date date NOT NULL,
      time time NOT NULL,
      end_time time
    );
  `);

  const uId = '66666666-6666-6666-6666-666666666666';
  await db.query(`INSERT INTO auth.users (id, email) VALUES ('${uId}', 'legacy@test.com')`);
  await db.query(`INSERT INTO public.tools (id, name, category, status) VALUES (1, 'Legacy Tool', 'Metrology', 'up')`);
  await db.query(`INSERT INTO public.profiles (id, first_name, last_name, calendar_token) VALUES ('${uId}', 'Old', 'User', 'legacy-plaintext-token')`);

  // Insert a 23:30 legacy booking missing end_time
  await db.query(`
    INSERT INTO public.bookings (tool_id, tool_name, user_id, user_name, project, date, time)
    VALUES (1, 'Legacy Tool', '${uId}', 'Old User', 'General', '2026-09-28', '23:30:00')
  `);

  // Run the forward migration
  await db.exec(fs.readFileSync(path.join(migrationsDir, '20260927000001_security_and_constraints.sql'), 'utf8'));

  // Verify token migrated to user_calendar_tokens and dropped from profiles
  const tokenRes = await db.query(`SELECT token_hash FROM public.user_calendar_tokens WHERE user_id = '${uId}'`);
  assert.equal(tokenRes.rows.length, 1);
  assert.equal(tokenRes.rows[0].token_hash.length, 64);

  // Verify 23:30 booking ends_at is correctly 30 minutes later (next day midnight in Europe/Vilnius)
  const bRes = await db.query(`SELECT starts_at, ends_at FROM public.bookings WHERE user_id = '${uId}'`);
  const startsAt = new Date(bRes.rows[0].starts_at).getTime();
  const endsAt = new Date(bRes.rows[0].ends_at).getTime();
  assert.equal(endsAt - startsAt, 30 * 60 * 1000, 'Duration must be exactly 30 minutes');
  assert.ok(endsAt > startsAt, 'ends_at must be strictly greater than starts_at');
});
