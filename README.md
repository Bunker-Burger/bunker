# Búnker Burger

Carta, carrito y checkout para Búnker Burger, Aguilares (Tucumán). La operación diaria se confirma por WhatsApp; Mercado Pago Checkout Pro es opcional.

## Desarrollo

1. Instalar Node.js 22 (`.nvmrc`).
2. Copiar `.env.example` a `.env.local` y completar las claves disponibles.
3. Ejecutar `npm ci`.
4. Enlazar la CLI con el proyecto Supabase cloud de desarrollo mediante `npx supabase link --project-ref <ref>`.
5. Revisar migraciones con `npm run db:push:dry` y aplicarlas con `npm run db:push`.
6. Ejecutar `npm run dev`.

Mercado Pago se oculta automáticamente si falta cualquiera de sus variables requeridas. Las claves secretas nunca llevan prefijo `NEXT_PUBLIC_`.

## Scripts

| Script | Uso |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (Turbopack, service worker desactivado). |
| `npm run build` / `npm start` | Build de producción (webpack, genera `public/sw.js`) y servidor. |
| `npm run lint` | ESLint sin warnings permitidos. |
| `npm run typecheck` | `tsc --noEmit` en modo estricto. |
| `npm test` / `npm run test:watch` | Pruebas unitarias con Vitest. |
| `npm run test:e2e` | Playwright (mobile + desktop, Chromium) contra el build de producción; correr `npm run build` antes. |
| `npm run db:push:dry` / `db:push` / `db:test` | Migraciones y pgTAP contra Supabase cloud de desarrollo. |
| `npm run db:types` / `db:types:check` | Regenera / verifica `src/server/supabase/database.types.ts` desde el proyecto de desarrollo. |
| `npm run test:integration` | Lee el catálogo semilla del proyecto de desarrollo con el repositorio real y prueba el acceso admin (usa `.env.local`). Los casos "usuario sin membresía" y "admin activo" solo corren si se definen `SUPABASE_TEST_MEMBERLESS_EMAIL/PASSWORD` y `SUPABASE_TEST_ADMIN_EMAIL/PASSWORD` de cuentas de prueba del proyecto de desarrollo. |

Antes de abrir un PR: `npm run lint`, `npm run typecheck`, `npm test` y las pruebas específicas. El CI de PR ejecuta unitarios, build, Playwright y **exige el estado `cloud/pgTAP-reviewed` para el SHA exacto**; NO carga secretos ni ejecuta SQL de PR contra la base cloud directamente.

## Supabase y acceso a datos

- **Dos proyectos cloud separados.** `SUPABASE_PROJECT_ENV` identifica development/production; no usar credenciales de producción en CI/previews.
- **Verificación cloud confiable:** el workflow `.github/workflows/cloud-db-reviewed.yml` existe únicamente en `main` y se activa manualmente mediante `workflow_dispatch` desde la rama `main`. Solicita número de PR abierta hacia main y **SHA completo (40 caracteres) previamente revisado**. Valida mediante GitHub API que la PR y su HEAD coincidan exactamente con ese SHA y, en otro job, usa exclusivamente código/herramientas de `main`; solo extrae archivos `.sql` regulares del commit autorizado, sin instalar ni ejecutar scripts de npm/JS de la PR. El secreto PostgreSQL se introduce únicamente en los pasos SQL privilegiados. Si un commit cambia, exige nueva ejecución; el resultado pgTAP real publica el estado `cloud/pgTAP-reviewed` para ese SHA.
- **Acción del mantenedor para verificar antes de merge:** ir a **Actions → Cloud DB — ejecución revisada (main) → Run workflow**; seleccionar `main`, informar `pr_number`, `reviewed_sha` completo y `operation=pgTAP`. Tras pasar pgTAP, reejecutar el job `pgTAP cloud revisado (SHA exacto)` del CI de la PR; un SHA nuevo invalida el resultado anterior. No es suficiente que un control ejecutado dentro de la PR se autodeclare autorizado.
- **Migraciones privilegiadas:** el mismo workflow de `main` admite `operation=dry-run` o `apply`; aplicar exige escribir exactamente `zokkgocmcaqcujltfkjf` en `confirm_project`. Nunca se aplican migraciones automáticamente desde la PR y no se debe usar `migration repair reverted` para ocultar diferencias entre ramas. El SQL proviene exclusivamente de un SHA aprobado de la PR y no se ejecutan otros archivos de esa rama.
- **Configuración administrativa imprescindible:** `SUPABASE_DEV_DB_URL` debe existir SOLO como secreto del Environment `main`, nunca como Repository/Organization secret accesible por PR. **En GitHub → Settings → Environments → main → Deployment branches, autorizar únicamente `main`; eliminar `feat/bb-05-option-engine`, `pull/27/merge` y todas las refs de PR.** Sin esa configuración fuera del repositorio no se puede demostrar el aislamiento del secreto. Comprobar disponibilidad efectiva de Environment secrets según el plan GitHub; no asumir reglas de aprobación que el plan no incluya. Si no están disponibles en repo privado, migrar el secreto a un mecanismo privilegiado realmente aislado antes de habilitar el flujo cloud; no moverlo a Repository secrets.
- **Lecturas administrativas autenticadas.** `getAdminCatalog()` valida primero la sesión con Supabase Auth (`auth.getUser()`, que detecta sesiones expiradas o revocadas) y una membresía activa en `admin_memberships` para esa tienda (`admin-access.ts`). Sin sesión, con sesión expirada, sin membresía activa o con membresía de otra tienda devuelve `unauthorized` sin leer el catálogo; nunca devuelve el subconjunto público como si fuera admin. RLS sigue siendo la barrera autoritativa.
- **La UI no habla con Supabase.** Rutas y componentes reciben objetos de dominio desde `@/server/catalog` (`getPublicCatalog`, `getAdminCatalog`). `src/test/data-access-boundary.test.ts` falla si `src/app` o `src/components` importan `@supabase/*`, los clientes, los tipos generados o consultan tablas.
- **Capas** (`src/server/catalog`): `rows.ts` (selects de PostgREST y validación con zod; el dinero viaja como texto y se convierte a `bigint`), `adapters.ts` (filas → dominio, con orden determinístico), `supabase-catalog-repository.ts` (implementa el puerto `CatalogRepository`), `catalog-service.ts` (`loadPublicCatalog` filtra categorías visibles y promociones vigentes al momento; `loadAdminCatalog` exige el gate de admin). Los grupos de opciones conservan `selectionMode` (`single`/`multiple`) tal como está persistido. Los tests unitarios inyectan `in-memory-catalog-repository.ts` e `in-memory-admin-access.ts`; no simulan una conexión a Supabase.
- **Errores controlados.** Toda lectura devuelve `Result<…, CatalogError>` con `not_found`, `unauthorized`, `unavailable`, `invalid_data` o `misconfigured`, y se registra en el log con `reportCatalogError`. Nunca se devuelve un catálogo parcial.
- **Caché.** Las lecturas públicas usan un cliente anónimo sin cookies y la caché de datos de Next (`force-cache`, 300 s, tag `catalog`). Las de administración usan la sesión del usuario (cookies) y `no-store`. Cuando la administración modifique el catálogo debe invalidar el tag `CATALOG_CACHE_TAG`.
- **Tipos generados.** `src/server/supabase/database.types.ts` sale del proyecto de desarrollo con `npm run db:types`, que usa `SUPABASE_DEV_DB_URL` (necesita Docker) o `SUPABASE_DEV_PROJECT_REF` (necesita `npx supabase login` o `SUPABASE_ACCESS_TOKEN`). Regenerarlo después de cada migración y commitearlo; `npm run db:types:check` detecta si quedó desactualizado.
- **Catálogo semilla.** `supabase/seed.sql` es idempotente (upsert por id) y solo para el proyecto de desarrollo: 4 categorías, 9 productos (1 borrador, 2 agotados, bebidas sin alcohol), grupos de opciones con defaults (incluye una opción sin stock) y 2 promociones (una activa los martes, otra pausada). Se aplica con `npx supabase db query --linked -f supabase/seed.sql` o desde el SQL editor del proyecto de desarrollo; nunca en producción.

## UI

Tailwind CSS 4.3 se carga desde `src/app/globals.css`, que es la única fuente de tokens (colores, tipografía, radios, sombras, `tap` de 44 px y ancho `content` de 1280 px). La paleta por defecto de Tailwind está deshabilitada: usar solo utilidades de tokens (`bg-surface`, `text-primary`, `text-headline-md`, `rounded-lg`, `min-h-tap`…) o `var(--color-*)` en CSS. Oswald (títulos y precios) y Space Grotesk (cuerpo y controles) se cargan con `next/font`.

- Primitives en `src/components/ui`: Button, Card, Badge, Dialog, Drawer, Tabs, Input, Textarea, Select, Switch, Label, Skeleton, EmptyState/ErrorState y Toaster (`toast` de sonner).
- Shell en `src/components/shell`: `AppShell`, `SiteHeader`, `Container` y la única `BottomNav`, que respeta safe areas y se oculta mientras el teclado virtual está abierto.
- `/design-system` muestra todos los primitives y estados; se sirve en local y previews, nunca en producción (`VERCEL_ENV=production`). Playwright la audita con axe (WCAG 2.1 AA), teclado y targets de 44 px, y `tests/e2e/responsive.spec.ts` recorre carta y demo a 320, 390, 768 y 1280 px.
- `src/test/design-tokens.test.ts` falla si aparecen colores, familias, tamaños, tracking o radios hardcodeados fuera de `globals.css` (la geometría de layout queda fuera a propósito).
- shadcn/ui está configurado en `components.json`. Al agregar componentes con `npx shadcn@latest add <componente>`, adaptarlos a los tokens; si se suman tokens nuevos, registrarlos también en `src/lib/utils.ts` para que `cn` los combine bien.

## Excepciones de versiones

Todas las dependencias directas están fijadas a versiones exactas y el lockfile está versionado.

- **TypeScript 6.0.3** en lugar de 7.x: `typescript-eslint` (usado por `eslint-config-next`) solo soporta `>=4.8.4 <6.1.0` y aborta con TS 7. Volver a `latest` cuando typescript-eslint publique soporte (ver typescript-eslint/typescript-eslint#10940).
- **Build con webpack** (`next build --webpack`): `@serwist/next` todavía no soporta Turbopack. El desarrollo sigue usando Turbopack con el service worker desactivado.
