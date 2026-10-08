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
- **Caché.** Las lecturas públicas usan un cliente anónimo sin cookies y la caché de datos de Next (`force-cache`, 300 s, tag `catalog`). Las de administración usan la sesión del usuario (cookies) y `no-store`. Cuando la administración modifique el catálogo debe invalidar el tag `CATALOG_CACHE_TAG`. El estado del local es la excepción: se lee siempre sin caché (ver "Estado del local").
- **Tipos generados.** `src/server/supabase/database.types.ts` sale del proyecto de desarrollo con `npm run db:types`, que usa `SUPABASE_DEV_DB_URL` (necesita Docker) o `SUPABASE_DEV_PROJECT_REF` (necesita `npx supabase login` o `SUPABASE_ACCESS_TOKEN`). Regenerarlo después de cada migración y commitearlo; `npm run db:types:check` detecta si quedó desactualizado.
- **Catálogo semilla.** `supabase/seed.sql` es idempotente (upsert por id) y solo para el proyecto de desarrollo: 4 categorías, 9 productos (1 borrador, 2 agotados, bebidas sin alcohol), grupos de opciones con defaults (incluye una opción sin stock) y 2 promociones (una activa los martes, otra pausada), con horarios de demostración en `America/Argentina/Tucuman` (lunes cerrado; viernes y sábado cruzan la medianoche) y tarifa de delivery fija. Se aplica con `npx supabase db query --linked -f supabase/seed.sql` o desde el SQL editor del proyecto de desarrollo; nunca en producción.

## Estado del local, horarios y delivery

- **Fuente de verdad en la base.** `stores.status_override` es el switch manual: `auto` (sigue los horarios), `open`, `paused` o `closed`; una tienda nueva arranca `closed`. `store_business_hours` guarda tramos semanales en la zona horaria de la tienda (`America/Argentina/Tucuman` por defecto, validada por trigger): `day_of_week` es el día en que abre el tramo y un `closes_at` que no es posterior a `opens_at` cierra al día siguiente (`00:00` = a medianoche). `stores.is_open` y `stores.business_hours` quedan deprecadas y la app no las lee.
- **Tarifa obligatoria.** `delivery_fee_cents` es `null` hasta configurarla y la base rechaza `auto`/`open` sin tarifa; el dominio, además, nunca acepta pedidos sin ella. No hay barrios, radios, mapas ni zonas: la tarifa es fija.
- **Decisión server-side, siempre fresca.** `evaluateStoreStatus` (`src/domain/store-status.ts`) calcula estado, `acceptingOrders`, cierre del tramo actual y próxima apertura con instantes reales de la zona horaria (correcto ante cambios de horario y cruces de medianoche; tramos contiguos se unen). `getStoreStatus()` (`@/server/catalog`) lee override, zona, tarifa y horarios con su propio select y el cliente operativo `createOperationalReadClient` (`cache: "no-store"`), separado de la lectura cacheable del catálogo: una pausa, un cierre o un cambio de tarifa rigen en la siguiente consulta, cotización o pago sin depender de invalidar `CATALOG_CACHE_TAG`. El service worker sirve `/api/store/status` solo desde la red (NetworkOnly).
- **Endpoint público.** `GET /api/store/status` devuelve el estado mínimo (`state`, `acceptingOrders`, `reason`, `closesAt`, `nextOpeningAt`, `deliveryFeeCents` como texto, `timezone`) con `Cache-Control: no-store`; ante cualquier error responde 404/503 con `acceptingOrders: false`.
- **Cerrado bloquea pagar y enviar, no navegar.** La carta y el carrito nunca consultan el estado. El checkout lo pide a `/api/store/status` solo para explicarlo (cerrado, pausado, próxima apertura) y mostrar la tarifa del servidor; ante un error dice que no pudo verificarlo. La web no ofrece ninguna acción de envío: hasta que BB-10 genere el mensaje desde una cotización validada en el servidor, el botón de WhatsApp queda deshabilitado (un total calculado en el navegador nunca confirma un pedido). `createAuthoritativeQuote` exige un local abierto y toma la tarifa únicamente del estado (una vez por pedido, nunca en retiro); `createCheckoutProPreference` lo vuelve a verificar antes de crear el pago en Mercado Pago.

## Promociones

- **Un solo motor** (`src/domain/promotions.ts`), usado por la cotización del servidor y por la estimación del navegador. Una regla está vigente si está activa (no pausada), `starts_at <= ahora < ends_at` y, si tiene `promotion_schedule`, la hora local de la tienda cae en uno de sus tramos semanales. Si `ends_at` es anterior a `starts_at`, el tramo cruza la medianoche (22:00–02:00); si son iguales, el tramo está vacío y nunca activa la regla.
- **No acumulables.** A cada pedido se aplica como máximo una promoción: entre las vigentes que le dan descuento gana el `priority` más alto, con desempate estable por `id`. No hay cupos, contadores ni topes por unidades.
- **Mecánicas** (`promotion_items` define los productos alcanzados):
  - `percent_off`: porcentaje de lo que se paga por esos productos (o por todo el pedido si no lista ninguno). Se calcula exacto en puntos básicos y se redondea hacia abajo.
  - `fixed_price`: combo. Cada set completo de productos × cantidad cuesta el precio fijo en lugar de sus precios base; los extras de opciones se cobran igual.
  - `buy_x_get_y`: por cada `buy + get` unidades, las `get` más baratas (a precio base) son gratis.
  - `free_delivery`: anula la tarifa de envío una sola vez, solo en delivery.
- **Cotización autoritativa.** `createAuthoritativeQuote` recibe las reglas de `PricingRepository.listPromotions()` y guarda la promoción aplicada en el snapshot (`PaymentQuote.promotion`), que reutilizan el mensaje de WhatsApp y Mercado Pago. `getPromotionsForQuote()` (`@/server/catalog`) lee las reglas con el cliente operativo sin caché, así una pausa rige en la próxima cotización. El navegador no envía precios, descuentos ni ids de promoción: el schema de checkout los rechaza.
- **Fuente pública real.** La carta y el total estimado leen `GET /api/store/promotions`: las mismas reglas que `getPromotionsForQuote()`, sin caché (`no-store`, y el service worker nunca la guarda), sin `description` ni `badge_text`, con los productos identificados por slug. El navegador la vuelve a leer cada minuto y al volver a la pestaña, así una pausa o un cambio de porcentaje llega a la página abierta. Si el endpoint falla, no se anuncia ningún descuento; no existe copia estática de reglas.
- **UI sin texto de precio libre.** El precio tachado sale del precio real y es exactamente lo que `quoteCart` descontaría a ese producto solo con la modalidad elegida (`promotionalPrice`): una promoción solo delivery no se anuncia mientras está elegido retiro, y si la que ganaría es envío gratis no se tacha nada. La explicación se genera desde la mecánica (`explainPromotion`); nunca se muestran `description` ni `badge_text` como precio.

## Administración (`/bunker`)

- **Sin registro público.** Los administradores se aprovisionan a mano: un usuario en Supabase Auth del proyecto correspondiente más una fila activa en `admin_memberships` para la tienda. `/bunker` solo ofrece email + contraseña.
  - No alcanza con que falte el formulario: la publishable key puede llamar a `signUp`. Por eso **"Allow new users to sign up" debe estar desactivado en cada proyecto cloud**, con el login por email habilitado.
  - `supabase/config.toml` solo describe el entorno local del CLI y no es el estado del cloud.
  - El test de integración lo verifica en desarrollo leyendo `/auth/v1/settings`. Recién con el registro desactivado prueba `signUp`, que debe responder `signup_disabled` sin crear usuario.
- **Autorización en el servidor, en cada request.** `getAdminSession()` (`src/server/auth/session.ts`) valida la sesión con Supabase Auth (`getUser`, nunca solo la cookie) y exige una membresía activa de `bunker-burger`. `user_metadata`, claims y estado del cliente no autorizan nada. Una sesión válida de otra tienda, inactiva, vencida sin refresh o revocada es `unauthorized`. Sin cookie de sesión no se consulta a Supabase.
- **`/bunker/admin`** llama a `requireAdminSession()`: quien no es admin va al login. Si la verificación no puede ejecutarse, muestra un error y no da acceso.
- **Login** (Server Action): si la cuenta no es admin de la tienda, la sesión recién creada se cierra en el acto. Hay un único mensaje para credenciales incorrectas y para falta de acceso. Solo redirige a rutas dentro de `/bunker/admin` (`safeAdminPath`), así que no hay open redirects.
- **Cookies.** `src/proxy.ts` (antes "middleware") renueva la sesión vencida una vez por request en `/` y `/bunker/**` y entrega los tokens rotados a la página y al navegador, que es el patrón de `@supabase/ssr`. No es autorización.
- **Cierre de sesión:** pide a Supabase revocar la sesión (`scope: "local"`) y **siempre** expira las cookies de Auth de este dispositivo (todos los chunks), porque el SDK las conserva si la revocación falla.
  - Si Supabase confirmó la revocación, el login dice "Cerraste sesión".
  - Si no (5xx, red, configuración), dice que solo se borró este dispositivo y que la revocación no se confirmó (`?sesion=local`).
  - `/bunker` además purga del Cache Storage cualquier respuesta de `/bunker/**`.
  - El service worker sirve `/bunker/**` siempre por red (`NetworkOnly`) y las páginas responden `no-store`, así que el admin nunca queda disponible offline.
- **Alcance de la revocación (decisión de producto: se acepta la ventana del JWT).**
  - Tras cerrar sesión, la app rechaza al instante cualquier copia de la cookie, porque cada request pasa por `getUser`, que consulta la sesión en Auth.
  - En cambio, un *access token* copiado antes del logout sigue valiendo **contra la Data API** (PostgREST valida firma y `exp`, y RLS solo mira `auth.uid()` + membresía) hasta su vencimiento: el "JWT expiry" del proyecto, por defecto 1 h.
  - Por eso toda escritura administrativa (BB-12/13) debe pasar por Server Actions que vuelvan a llamar a `requireAdminSession`, nunca por el cliente directo.
  - No se promete invalidación inmediata de accesos directos a la Data API.
- **Tab Admin:** aparece en la navegación de la carta solo con una sesión de admin validada en el servidor.

### Checklist de deploy (Auth)

En cada proyecto cloud (desarrollo y producción), sin compartir claves:
1. Authentication → Sign In / Providers: **"Allow new users to sign up" desactivado**, provider Email habilitado.
2. Verificar sin credenciales: `GET <SUPABASE_URL>/auth/v1/settings` con la publishable key en el header `apikey` debe devolver `"disable_signup": true`.
3. Revisar el "JWT expiry" (ventana máxima de un access token copiado tras un logout).
4. Aprovisionar cada admin a mano: crear el usuario desde el Dashboard (invitación) y agregar una fila activa en `admin_memberships` para `bunker-burger`.
5. Probar el login real en `/bunker` con un admin y con una cuenta sin membresía, que debe ser rechazada. Para desarrollo están los tests opt-in `SUPABASE_TEST_ADMIN_*` / `SUPABASE_TEST_MEMBERLESS_*`.

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
