/** Prefer current platform keys; retain compatibility with local legacy-key environments. */
export function platformKey(kind: 'publishable'|'secret'): string {
 const dictionary=JSON.parse(Deno.env.get(kind==='publishable'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS')||'{}');
 return dictionary.default || Deno.env.get(kind==='publishable'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY') || '';
}
