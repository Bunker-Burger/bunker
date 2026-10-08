/** Supabase auth session cookie (`sb-<project>-auth-token`), possibly chunked (`.0`, `.1`, …). */
export function isAuthCookieName(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}
