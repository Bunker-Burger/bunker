# BB-11 Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private email/password admin access at `/bunker`, protect `/bunker/admin` with a server-validated Supabase session and active store membership, and keep all auth/admin responses out of offline caches.

**Architecture:** A Next.js 16 `proxy.ts` refreshes Supabase SSR cookies but never authorizes. Server Actions authenticate and log out, while a small server auth service reuses the existing `AdminAccessGate` for every membership decision; the admin layout is the final fail-closed boundary. Public catalog caching stays unchanged, and user-specific session reads remain `no-store`.

**Tech Stack:** Next.js 16 App Router, React 19 Server Actions, TypeScript 6, Supabase SSR/Auth/PostgREST, Zod, Serwist, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-bb-11-admin-auth-design.md`

## Global Constraints

- `/bunker` supports email and password only; no signup, recovery, invitations, or external identity providers.
- Authorization uses `auth.getUser()` plus an active `admin_memberships` row for `bunker-burger`; never `user_metadata`, `getSession()`, or a client-only check.
- The sole manually provisioned development account receives role `owner`; no additional Auth users or roles are created.
- All redirects are fixed internal constants: success to `/bunker/admin`, rejection/logout to `/bunker`; no `next`, `returnTo`, or user-provided destination.
- Session/admin reads use `cache: "no-store"`; `/bunker` and descendants are `NetworkOnly` in Serwist.
- No schema migration: membership provisioning is environment-specific operational data and no user UUID is committed.
- Preserve public catalog caching and avoid BB-12/BB-13 CRUD scope.
- Follow TDD: observe every new test fail for the intended reason before implementing its production code.

## Review Focus

- Malformed, empty, whitespace-only, or oversized credentials must return a safe validation error without calling Supabase — pinned in Task 3.
- A successful Auth login followed by missing/inactive/cross-store membership must sign out locally and expose the same message as invalid credentials — pinned in Task 2.
- A transient Auth or membership backend failure must fail closed without being mislabeled as invalid credentials — pinned in Tasks 2 and 4.
- Cookie refresh must preserve every cookie option and response header while missing configuration leaves public routes reachable — pinned in Task 1.
- Service-worker matching must cover `/bunker`, every descendant, query strings through pathname matching, and same-origin requests only — pinned in Task 5.

---

### Task 1: Supabase SSR session refresh proxy

**Files:**
- Create: `src/server/supabase/update-session.ts`
- Create: `src/server/supabase/update-session.test.ts`
- Create: `src/proxy.ts`
- Create: `src/proxy.test.ts`

**Interfaces:**
- Consumes: `readSupabaseConfig(): Result<SupabaseConfig, SupabaseConfigError>` and Supabase `createServerClient`.
- Produces: `updateSupabaseSession(request: NextRequest): Promise<NextResponse>` and `proxy(request: NextRequest): Promise<NextResponse>`; exported constant `config.matcher` excludes `_next/static`, `_next/image`, favicon, manifest/service-worker assets, and files with extensions.

- [ ] **Step 1: Write failing proxy/session tests**

Add tests named:

- `copies refreshed cookies to the forwarded request and response with all options`
- `calls getClaims rather than getSession and returns a no-store response after refresh`
- `keeps the public request reachable when Supabase configuration is absent`
- `matches application documents but excludes static and service-worker assets`

Assert the cookie adapter mutates both `request.cookies` and `response.cookies`, `auth.getClaims()` is called once, `auth.getSession()` is never referenced, and refreshed responses include `Cache-Control: private, no-store`.

- [ ] **Step 2: Run tests and confirm the missing-module failure**

Run: `pnpm vitest run src/server/supabase/update-session.test.ts src/proxy.test.ts`

Expected: FAIL because `update-session.ts` and `proxy.ts` do not exist.

- [ ] **Step 3: Implement session refresh**

Implement `updateSupabaseSession(request: NextRequest): Promise<NextResponse>` with a request-scoped Supabase SSR client. Its `setAll(cookies)` must update the incoming `NextRequest`, recreate `NextResponse.next({ request })`, copy each cookie and preserve the complete Supabase cookie options. Call `auth.getClaims()` exactly once. If public configuration is invalid, return `NextResponse.next({ request })`; authorization later still fails closed.

- [ ] **Step 4: Add the thin Next.js proxy entry point**

Implement `src/proxy.ts` as a named `proxy` export delegating to `updateSupabaseSession`, plus a static negative matcher covering application documents while excluding static/build/image/favicon/manifest/SW assets.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/server/supabase/update-session.test.ts src/proxy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/supabase/update-session.ts src/server/supabase/update-session.test.ts src/proxy.ts src/proxy.test.ts
git commit -m "feat: refresh Supabase admin sessions"
```

### Task 2: Store-admin authentication service

**Files:**
- Create: `src/server/auth/admin-session.ts`
- Create: `src/server/auth/admin-session.test.ts`
- Modify: `src/server/catalog/index.ts`

**Interfaces:**
- Consumes: `createSessionClient`, `createSupabaseAdminAccess`, `AdminAccessGate.requireStoreAdmin(storeSlug)`, `STORE_SLUG`.
- Produces:
  - `AdminLoginCredentials = { email: string; password: string }`
  - `AdminLoginOutcome = { kind: "authorized"; membership: AdminMembership } | { kind: "rejected" } | { kind: "unavailable" }`
  - `authenticateStoreAdmin(credentials: AdminLoginCredentials, dependencies?: AdminAuthDependencies): Promise<AdminLoginOutcome>`
  - `getCurrentStoreAdmin(dependencies?: AdminSessionDependencies): Promise<Result<AdminMembership, CatalogError>>`
  - `signOutCurrentSession(dependencies?: AdminLogoutDependencies): Promise<void>`

- [ ] **Step 1: Write failing service tests**

Add tests named:

- `returns the active store membership after password login`
- `maps invalid credentials to rejected without checking membership`
- `signs out locally and rejects a memberless, inactive, or cross-store user`
- `maps retryable auth and membership failures to unavailable and never authorizes`
- `gets the current admin through getUser and the membership gate without metadata`
- `signs out with scope local`

Use injected narrow dependencies and assert exact calls: `signInWithPassword({ email, password })`, `requireStoreAdmin("bunker-burger")`, and `signOut({ scope: "local" })`.

- [ ] **Step 2: Run tests and confirm the missing-module failure**

Run: `pnpm vitest run src/server/auth/admin-session.test.ts`

Expected: FAIL because `admin-session.ts` does not exist.

- [ ] **Step 3: Implement the orchestration service**

Create request-scoped defaults from `readSupabaseConfig()` and `createSessionClient()`. Treat an Auth 4xx login error as `rejected`; retryable/5xx/transport/config failures as `unavailable`. After successful Auth, require the existing store membership; on `unauthorized`, perform local signout and return `rejected`; on other errors, fail closed as `unavailable`.

- [ ] **Step 4: Expose the current-admin read without duplicating authorization**

Add a focused export in `src/server/catalog/index.ts` only if needed to avoid circular imports; the authoritative check must still be `createSupabaseAdminAccess(client).requireStoreAdmin(STORE_SLUG)`.

- [ ] **Step 5: Run focused and existing gate tests**

Run: `pnpm vitest run src/server/auth/admin-session.test.ts src/server/catalog/admin-access.test.ts src/server/supabase/clients.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/auth/admin-session.ts src/server/auth/admin-session.test.ts src/server/catalog/index.ts
git commit -m "feat: authorize store admin sessions"
```

### Task 3: Private login page and Server Action

**Files:**
- Create: `src/app/bunker/actions.ts`
- Create: `src/app/bunker/actions.test.ts`
- Create: `src/app/bunker/login-form.tsx`
- Create: `src/app/bunker/login-form.test.tsx`
- Create: `src/app/bunker/page.tsx`
- Create: `src/app/bunker/page.test.tsx`
- Create: `src/app/bunker/admin.module.css`

**Interfaces:**
- Consumes: `authenticateStoreAdmin` and `getCurrentStoreAdmin` from Task 2.
- Produces:
  - `LoginActionState = { message: string | null }`
  - `login(previousState: LoginActionState, formData: FormData): Promise<LoginActionState>` (redirects on success)
  - `LoginForm({ action? }: { action?: typeof login }): JSX.Element`
  - `/bunker` login page.

- [ ] **Step 1: Write failing action validation tests**

Test `login` for a valid form, malformed/empty/whitespace-only email, empty password, non-string fields, and bounded input lengths (email at most 320 characters, password at most 1,024). Invalid input returns `Email o contraseña incorrectos` and never calls the service. `rejected` returns that same text; `unavailable` returns `No pudimos iniciar sesión. Intentá nuevamente.`; `authorized` calls only `redirect("/bunker/admin")` outside error-catching code.

- [ ] **Step 2: Run the action tests red**

Run: `pnpm vitest run src/app/bunker/actions.test.ts`

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Implement the login action**

Use Zod to parse `FormData`, normalize only the email with `trim().toLowerCase()`, preserve the password verbatim, invoke `authenticateStoreAdmin`, and use the two exact public messages. Do not read or accept redirect fields.

- [ ] **Step 4: Write and run failing UI/page tests**

Test accessible labels `Email` and `Contraseña`, password input type, submit pending state, `role="alert"` for errors, absence of signup/recovery links, and an already-authorized session redirecting to `/bunker/admin`. Verify unavailable/no-session results render the login without private content.

Run: `pnpm vitest run src/app/bunker/login-form.test.tsx src/app/bunker/page.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 5: Implement the page and form**

Build a minimal branded login card using the existing design tokens and `useActionState`. The Server Component checks `getCurrentStoreAdmin`; redirect only when it returns an authorized membership. Do not expose the user id or Supabase errors in HTML.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run src/app/bunker/actions.test.ts src/app/bunker/login-form.test.tsx src/app/bunker/page.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/bunker src/server/auth/admin-session.ts
git commit -m "feat: add private admin login"
```

### Task 4: Protected admin shell and logout

**Files:**
- Create: `src/app/bunker/admin/layout.tsx`
- Create: `src/app/bunker/admin/layout.test.tsx`
- Create: `src/app/bunker/admin/page.tsx`
- Create: `src/app/bunker/admin/page.test.tsx`
- Modify: `src/app/bunker/actions.ts`
- Modify: `src/app/bunker/actions.test.ts`

**Interfaces:**
- Consumes: `getCurrentStoreAdmin`, `signOutCurrentSession`, fixed paths from Task 3.
- Produces: `logout(): Promise<never>` and a server-protected `/bunker/admin` layout that supplies the verified membership to its shell without client-side authorization.

- [ ] **Step 1: Write failing layout tests**

Test that active membership renders children and role, while missing, expired/revoked (`unauthorized`), inactive/cross-store, and transient backend (`unavailable`) results never render children and redirect to `/bunker`. Assert the rendered shell contains no user UUID or token.

- [ ] **Step 2: Run layout tests red**

Run: `pnpm vitest run src/app/bunker/admin/layout.test.tsx`

Expected: FAIL because the protected layout does not exist.

- [ ] **Step 3: Implement the dynamic no-store admin layout and landing**

Use `connection()` or the current Next.js 16 dynamic-request mechanism documented locally, then call `getCurrentStoreAdmin`. Redirect on every non-OK result. Render only brand, verified role, link to `/`, children, and the logout form. Add metadata/headers behavior that prevents private HTML caching.

- [ ] **Step 4: Write failing logout tests**

Test that `logout` calls `signOutCurrentSession`, `revalidatePath("/", "layout")`, then fixed `redirect("/bunker")`; repeat with an already-absent session and assert the same safe result. A signout failure must still fail closed and redirect without leaking details.

- [ ] **Step 5: Implement logout and landing page**

Keep logout as a Server Action invoked only through a POST form. Call `redirect` outside `try/catch`. The page copy is limited to the role and placeholders/links for future catalog administration; do not implement CRUD.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run src/app/bunker/actions.test.ts src/app/bunker/admin/layout.test.tsx src/app/bunker/admin/page.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/bunker/actions.ts src/app/bunker/actions.test.ts src/app/bunker/admin
git commit -m "feat: protect the admin shell"
```

### Task 5: Authorized navigation and offline exclusion

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`
- Modify: `src/components/storefront/storefront.tsx`
- Modify: `src/components/storefront/storefront.test.tsx`
- Create: `src/app/sw-routes.ts`
- Create: `src/app/sw-routes.test.ts`
- Modify: `src/app/sw.ts`

**Interfaces:**
- Consumes: `getCurrentStoreAdmin()` and existing `Storefront.showAdminNav`.
- Produces: `isSensitiveRuntimeRequest(input: { sameOrigin: boolean; url: { pathname: string } }): boolean` used by the first Serwist `NetworkOnly` rule.

- [ ] **Step 1: Write failing navigation tests**

Extend the home-page test to mock current-admin results and assert `showAdminNav` is true only for an OK active membership; absent, expired, unavailable, and cross-store results pass false. Extend storefront tests to assert the Admin item points to `/bunker/admin`, not the login page, and remains absent by default.

- [ ] **Step 2: Run navigation tests red**

Run: `pnpm vitest run src/app/page.test.tsx src/components/storefront/storefront.test.tsx`

Expected: FAIL because the page does not query the session and the current link points to `/bunker`.

- [ ] **Step 3: Implement server-derived navigation visibility**

Read current admin access in the home Server Component alongside the cached public catalog and pass only a boolean to `Storefront`. Keep catalog reads on their existing cached client; never cache the session result.

- [ ] **Step 4: Write failing service-worker matcher tests**

Test same-origin `/bunker`, `/bunker/`, `/bunker/admin`, nested admin paths, and existing operational APIs as true; `/`, `/bunkers`, and cross-origin `/bunker` as false. Path matching must not depend on query strings.

- [ ] **Step 5: Run matcher tests red**

Run: `pnpm vitest run src/app/sw-routes.test.ts`

Expected: FAIL because `sw-routes.ts` does not exist.

- [ ] **Step 6: Implement and wire the NetworkOnly matcher**

Move the pure predicate to `sw-routes.ts` and use it in the first runtime-cache rule before `defaultCache`. Match `pathname === "/bunker" || pathname.startsWith("/bunker/")` plus the existing operational endpoints.

- [ ] **Step 7: Run focused tests and build**

Run: `pnpm vitest run src/app/page.test.tsx src/components/storefront/storefront.test.tsx src/app/sw-routes.test.ts && pnpm build`

Expected: PASS; production build emits the service worker without caching admin/auth routes.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/app/page.test.tsx src/components/storefront/storefront.tsx src/components/storefront/storefront.test.tsx src/app/sw.ts src/app/sw-routes.ts src/app/sw-routes.test.ts
git commit -m "feat: expose admin navigation safely"
```

### Task 6: Cloud provisioning, integration coverage, and runbook

**Files:**
- Create: `src/server/auth/admin-session.integration.test.ts`
- Create: `tests/e2e/admin-auth.spec.ts`
- Create: `docs/runbooks/admin-provisioning.md`
- Modify: `.env.example` only if a required test variable is not already documented.

**Interfaces:**
- Consumes: development project credentials from existing `SUPABASE_TEST_ADMIN_EMAIL` and `SUPABASE_TEST_ADMIN_PASSWORD`; the configured cloud project and store slug.
- Produces: repeatable evidence for the real Auth → cookie → membership → admin route path and a production-safe provisioning procedure with no hardcoded UUID.

- [ ] **Step 1: Write integration tests against the linked development project**

Cover valid owner login, invalid password, current-session membership lookup, and logout. Assert the valid account resolves exactly one active `owner` membership for `bunker-burger`; do not create a second Auth user for negative coverage. Unit tests from Tasks 2–4 remain the coverage for memberless/cross-store conditions.

- [ ] **Step 2: Provision the existing sole Auth user in development**

Before mutation, query counts and abort unless there is exactly one Auth user, exactly one `bunker-burger` store, and no conflicting active membership. Upsert that user's membership as active `owner` directly in the development cloud project, then read it back and verify the three identifiers/values. Do not create a migration or write the UUID to disk.

- [ ] **Step 3: Demonstrate integration test sensitivity and pass**

Before provisioning (or inside a transaction that temporarily deactivates only the target membership), capture the expected unauthorized failure; restore/provision the membership and rerun:

Run: `pnpm vitest run src/server/auth/admin-session.integration.test.ts`

Expected after provisioning: PASS. Never leave the membership inactive after the sensitivity check.

- [ ] **Step 4: Write Playwright coverage**

Add tests for the public login surface, invalid credentials, direct anonymous access redirect, successful owner login, Admin tab visibility during the valid session, logout, and direct access after logout. Use environment credentials only and redact secrets from traces/screenshots.

- [ ] **Step 5: Write the provisioning runbook**

Document development and production steps: manually create the sole Auth user, resolve environment-local user/store UUIDs, insert/update one active `owner` membership, verify counts and access, and revoke by setting `is_active = false`. Explicitly prohibit `user_metadata`, service-role credentials in the browser, UUIDs copied between environments, signup enablement, and additional accounts.

- [ ] **Step 6: Run integration and E2E tests**

Run: `pnpm test:integration`

Run after the production build is running: `pnpm playwright test tests/e2e/admin-auth.spec.ts --project=desktop`

Expected: PASS with the configured development credentials.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth/admin-session.integration.test.ts tests/e2e/admin-auth.spec.ts docs/runbooks/admin-provisioning.md .env.example
git commit -m "test: cover cloud admin authentication"
```

### Task 7: Full verification and pull request

**Files:**
- Modify only files required to fix findings from the commands below.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a clean BB-11 branch, exact verification evidence, and a PR referencing Issue #11.

- [ ] **Step 1: Run static and unit verification**

Run sequentially:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0; record exact test counts.

- [ ] **Step 2: Run browser and Supabase verification**

Run relevant Playwright tests, the cloud integration suite, and the linked database tests already owned by the repo. Do not run Docker, `supabase start`, or `db reset --linked`.

- [ ] **Step 3: Inspect cloud security state**

Run Supabase Security Advisor and Performance Advisor. Confirm exactly one Auth user and exactly one active `owner` membership for `bunker-burger`; report unrelated pre-existing findings separately and do not broaden scope.

- [ ] **Step 4: Review the final diff**

Run `git diff origin/main...HEAD --check`, inspect the complete diff, confirm no secrets, UUIDs, generated SW artifacts, unrelated refactors, or schema migrations were added, and verify the worktree is clean.

- [ ] **Step 5: Commit any verification-only corrections**

```bash
git add <only corrected files>
git commit -m "fix: address BB-11 verification findings"
```

Skip this commit when no correction is needed.

- [ ] **Step 6: Push and open the PR**

Push `codex/bb-11-admin-auth`, create a PR against `main` titled `BB-11 — Implementar autenticación y protección administrativa`, link `Closes #11`, include the exact test/advisor/cloud evidence and residual risks, and do not merge it.
