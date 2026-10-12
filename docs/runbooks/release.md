# Release, producción y rollback (BB-19)

Cómo sale una versión a producción, qué variables usa cada entorno, cómo se rotan, y qué hacer antes de migrar, si
algo falla o para volver atrás. Las previews están en `vercel-preview.md` y la evidencia cloud en `cloud-evidence.md`.

## 0. Decisiones del dueño (12/10)

- **Un solo proyecto Supabase** (`zokkgocmcaqcujltfkjf`), que es producción. No hay proyecto de desarrollo, así que
  BB-19 queda re-escopeado:
  - las previews no reciben base (allowlist vacía);
  - CI no toca la nube;
  - las migraciones van a ese único proyecto con el protocolo de §4.
- **Deploy de producción automático** después de cada merge a `main` con CI en verde.
- **Vercel sigue en Hobby por ahora.** Es un bloqueo de lanzamiento (§9): Hobby no admite uso comercial.

## 1. Entornos

| | Local | CI (`pull_request`) | Preview (Vercel) | Production (Vercel) |
|---|---|---|---|---|
| Código | rama local | HEAD de la PR | HEAD de la PR, publicado a mano desde `main` | `main`, después de CI verde |
| Supabase | ninguno, o `.env.local` del mantenedor | ninguno | **ninguno** | el único proyecto |
| Secretos | `.env.local`, nunca versionado | ninguno | ninguno | variables de Production en Vercel |
| Workflow | — | `ci.yml`, `vercel-preview.yml` | `vercel-preview-deploy.yml` | `vercel-production.yml` |

## 2. Variables por entorno

`vercel-production-guard.mjs` **sólo acepta** en Production de Vercel las variables que la app lee, y exige las tres
obligatorias. Si sobra o falta algo, **no publica** y el run queda en rojo. El sitio en vivo no cambia.

| Variable | Production (Vercel) | Preview | Entorno `main` de GitHub | Qué es |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **obligatoria** | — | sí (CI cloud) | `https://<ref>.supabase.co` del único proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **obligatoria** | — | sí | clave publicable; nunca `sb_secret_…` |
| `SUPABASE_PROJECT_ENV` | **obligatoria**, `production` | — | — | la app sólo acepta el proyecto de producción en Production |
| `SUPABASE_PRODUCTION_PROJECT_REF` | recomendada | — | — | ref del proyecto; tiene que coincidir con la URL |
| `SUPABASE_SERVICE_ROLE_KEY` | cuando haya pagos MP | — | sí | escritura de intentos de pago desde el servidor |
| `APP_URL` | cuando haya pagos MP | — | — | `https://…`; base de `back_urls` y `notification_url` |
| `NEXT_PUBLIC_SITE_URL` | opcional | — | — | URL pública (https) |
| `RATE_LIMIT_UPSTREAM_URL`, `RATE_LIMIT_API_KEY`, `RATE_LIMIT_TIMEOUT_MS` | cuando haya pagos MP | — | — | cuota distribuida que exige Mercado Pago en producción |
| `PRIVACY_CONTACT_WHATSAPP` / `PRIVACY_CONTACT_EMAIL` | cuando el dueño lo dé (BB-18 A9) | — | — | contacto de privacidad independiente de la base |
| `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` | sólo al habilitar MP (#38) | — | — | credenciales de Mercado Pago |
| `SUPABASE_SECRET_KEY`, `SUPABASE_TEST_*`, `SUPABASE_DEV_DB_URL` | **prohibidas** | — | sí (sólo CI) | la app no las lee; son de CI |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | — | — | sí (`main` y `preview`) | deploy con la CLI |

**Hoy (12/10) Production no pasa el guard.** Tiene `SUPABASE_SECRET_KEY` y `SUPABASE_TEST_ADMIN_*` cargadas y le falta
`SUPABASE_PROJECT_ENV=production`. El primer deploy automático va a fallar sin publicar hasta que se corrija en Vercel →
Settings → Environment Variables.

## 3. Dominios, callbacks y webhook

- **Sitio:** `https://bunker-burger.vercel.app`, alias de producción. Un dominio propio se agrega en Vercel → Domains;
  después hay que actualizar `APP_URL`, `NEXT_PUBLIC_SITE_URL` y la URL del sitio en Supabase Auth.
- **Supabase Auth** (login del admin): en Authentication → URL Configuration, el *Site URL* tiene que ser el dominio de
  producción. Los cambios de Auth se verifican con el harness de `admin-auth-reviewed.yml`.
- **Mercado Pago**, al habilitarlo (#38):
  - `back_urls` = `APP_URL/?payment=…&ref=…` y `notification_url` = `APP_URL/api/payments/mercado-pago/webhook` (sólo
    si `APP_URL` es https);
  - en el panel de Mercado Pago, en Webhooks, va la misma URL de notificación, y su clave secreta va como
    `MERCADO_PAGO_WEBHOOK_SECRET` (`mercado-pago-webhook.md`).

## 4. Migraciones (un solo proyecto)

1. **PR:** el delta SQL se revisa con el protocolo de `cloud-evidence.md`. Sólo migraciones **compatibles**: agregar
   columnas, tablas o funciones, sin borrar ni renombrar algo que la versión anterior de la app use. Un borrado va en
   otra release, después de que ninguna versión en producción lo necesite.
2. **Backup antes de aplicar** (§5).
3. **Dry-run:** `cloud-db-reviewed.yml` con `operation: dry-run` sobre el SHA. Tiene que listar sólo la migración nueva.
4. **Apply:** con la decisión del mantenedor por escrito, `operation: apply` y `confirm_project`.
5. **Después:** pgTAP (`operation: pgTAP`) y Auth config. Se registra en `migration-log.md`.

Como la base es la de producción, **la migración queda aplicada antes de que la app nueva se publique**. Por eso tiene
que ser compatible con la versión que está en línea.

## 5. Backup

- El plan Free de Supabase no ofrece restauración a un punto en el tiempo ni backups descargables. Antes de cada
  `apply` hay que hacer un volcado a mano:
  ```bash
  supabase db dump --linked --file backup-$(date +%Y%m%d-%H%M).sql
  ```
  Y si hacen falta los datos:
  ```bash
  supabase db dump --linked --data-only --file datos-$(date +%Y%m%d-%H%M).sql
  ```
- El volcado tiene datos personales (contactos de Mercado Pago, 90 días): se guarda cifrado fuera del repo y se borra
  cuando ya no sirve. **Nunca** se sube como artefacto de Actions ni se commitea.

## 6. Release y smoke test

1. La PR pasa `app`, `e2e`, `Vercel Preview (build)` y la evidencia cloud que corresponda. Se revisa y se mergea.
2. CI corre sobre `main`. Si pasa, **Vercel Production** hace esto:
   - comprueba que el commit sigue siendo el HEAD de `main`, para no pisar un deploy más nuevo;
   - revisa las variables (§2);
   - `vercel build --prod` → `vercel deploy --prebuilt --prod`;
   - smoke test.
3. **Smoke test** (`scripts/ci/smoke-production.mjs`) contra `https://bunker-burger.vercel.app`. Sólo lee; el pedido de
   WhatsApp no guarda nada. Cubre:
   - carta (`/`), sin "No pudimos cargar la carta";
   - `/api/store/products` y `/api/store/status`;
   - WhatsApp: un pedido inválido es rechazado, y un pedido de prueba devuelve el enlace `wa.me` o "local cerrado";
   - login del admin (`/bunker`);
   - `/legal/privacidad`;
   - Mercado Pago, sólo con `--mercado-pago` cuando esté habilitado.

   Para correrlo a mano:
   ```bash
   node scripts/ci/smoke-production.mjs https://bunker-burger.vercel.app
   ```
4. Si el smoke falla, el run queda en rojo y GitHub avisa por mail. Se decide entre rollback (§8) o un arreglo.

## 7. Observabilidad

No hay servicio de alertas. Se mira:
- **Vercel → Logs:** errores del servidor (`[catalog:public]`, checkout, webhook);
- **Vercel → Deployments:** qué commit está en producción (metadato `githubCommitSha`);
- **GitHub Actions:** runs de **Vercel Production** y de CI. Un fallo llega por mail;
- **Supabase → Logs:** API, Postgres y Auth;
- **Mercado Pago**, cuando esté habilitado: estado de los eventos en `payment_webhook_events` y el panel de Mercado Pago
  (`mercado-pago-webhook.md`).

## 8. Rollback

- **App:** en Vercel → Deployments, abrir el deploy de producción anterior → **Instant Rollback** (en Hobby, sólo al
  inmediato anterior). Con la CLI:
  ```bash
  vercel rollback <url-del-deploy-anterior>
  ```
  Después hay que **revertir el commit en `main`** con una PR de revert. Si no, el próximo merge vuelve a publicar el
  código malo.
- **Base:** no se "des-aplica" una migración. Como son compatibles (§4), la app anterior sigue funcionando con el esquema
  nuevo: se vuelve atrás la app y la base se corrige con una migración nueva. Sólo con datos dañados se restaura el
  volcado de §5, y eso es una decisión explícita del dueño.

## 9. Bloqueos de lanzamiento (no son de código)

- **Vercel Hobby no admite uso comercial:** hace falta pasar a Pro antes de abrir al público.
- **Checks obligatorios:** GitHub Free con repo privado de organización devuelve 403 en branch protection y rulesets.
  El merge depende de la revisión.
- **Production en Vercel no pasa el guard** (§2): hay que corregir las variables.
- **Un solo Supabase:** previews sin base, y las migraciones se aplican sobre producción con backup y dry-run.
- **Mercado Pago deshabilitado** hasta tener credenciales (#38). **BB-18:** aprobaciones A1–A9 pendientes.

## 10. Transferencia final a `Lautaro073/bunker`

Va cuando estén todos los gates. La hace el dueño, en GitHub → Settings → Danger Zone → Transfer.

1. GitHub conserva commits, issues, PRs y la redirección del nombre viejo. Verificarlo después de transferir.
2. Revisar que estén los entornos `main` y `preview` con sus secretos y su regla de rama. Si no se conservaron, volver a
   crearlos.
3. `project-readiness.yml` usa el Project de la organización. En una cuenta personal hay que apuntarlo a un Project de
   la cuenta o desactivarlo.
4. Reinstalar o revisar las apps de GitHub (Supabase, etc.) en la cuenta personal. Vercel no cambia: deploya con la CLI
   y los ids del proyecto.
5. Actualizar el remoto local:
   ```bash
   git remote set-url origin https://github.com/Lautaro073/bunker.git
   ```
   Después correr un push y un CI de prueba.
6. **Cuenta personal:** el plan Hobby de Vercel puede desplegar un repo privado de una cuenta personal con su integración
   de Git. Si se pasa a esa integración, hay que volver a revisar las previews (`vercel-preview.md`).
