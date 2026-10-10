# Evidencia cloud de BB-11 (pgTAP, Auth config y Auth producto)

Una PR hacia `main` sólo pasa el gate de CI con tres statuses en su **SHA de HEAD exacto**:

| Contexto | Workflow confiable (vive en `main`) | `run-name` exigido |
|---|---|---|
| `cloud/pgTAP-reviewed` | `.github/workflows/cloud-db-reviewed.yml` (operation `pgTAP`) | `Cloud DB \| pgTAP \| PR #<n> \| <sha>` |
| `cloud/admin-auth-reviewed` | `.github/workflows/admin-auth-reviewed.yml` | `Admin Auth config \| PR #<n> \| <sha>` |
| `cloud/admin-auth-product-reviewed` | `.github/workflows/admin-auth-product-reviewed.yml` | `Admin Auth producto \| PR #<n> \| <sha>` |

`cloud/admin-auth-reviewed` sólo acredita la configuración del proyecto Supabase (harness de `main`). La aplicación
(Server Actions, proxy, cookies SSR, layout, navegación) se acredita con `cloud/admin-auth-product-reviewed`.

## Cómo verifica el gate

El job `status-provenance` de `ci.yml` ejecuta `node scripts/ci/verify-cloud-statuses.mjs`, sin dependencias ni
secretos y con token de sólo lectura. Ese mismo archivo es el que corre `src/ci/verify-cloud-statuses.test.ts`, como
proceso hijo contra una API de GitHub de fixtures. Para cada contexto:

1. La PR sigue abierta hacia `main` desde este repositorio y su HEAD es el SHA evaluado.
2. Toma el status **más reciente** del contexto en `GET /repos/:repo/statuses/<SHA>`. Debe estar en `success`, con
   creator `github-actions[bot]` (tipo `Bot`) y `target_url` igual a la URL canónica de un run de este repositorio.
   Un status publicado a mano por una persona no acredita.
3. `GET /actions/runs/<id>`:
   - mismo repositorio y repositorio de origen;
   - `event=workflow_dispatch`, `head_branch=main`, `path` exacto del workflow;
   - `status=completed`, `conclusion=success`;
   - `display_title` igual al `run-name` de la tabla para **esta** PR y **este** SHA.

   El workflow fija ese título con sus propios inputs, y su job `authorize` comprueba que coinciden con la PR abierta.
4. `run.head_sha` es código de `main`: `compare/<run.head_sha>...main` debe dar `identical` o `ahead`. **Nunca** se exige
   `run.head_sha == SHA de la PR`: los runs privilegiados ejecutan `main` y acreditan otro commit (por ejemplo, el run
   38007678913 de pgTAP tiene `head_sha` de `main` y publicó su status en el SHA de la PR).

Los runs por comentario (`/verify-db`) y los de antes de agregar el `run-name` no vinculan PR/SHA, así que no acreditan:
hay que repetirlos con `workflow_dispatch` sobre el SHA final.

## Instalación (una sola vez, decisión del mantenedor)

1. Revisar y, si corresponde, mergear el bootstrap #39 (sólo infraestructura). No ejecutar nada de esto desde una
   workflow que exista sólo en la PR #37.
2. Crear en *Settings → Environments* el entorno **`admin-auth-product`** con **required reviewers** (el owner) y con
   sus propios secretos: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_TEST_ADMIN_EMAIL` y `SUPABASE_TEST_ADMIN_PASSWORD` del proyecto development. Si el entorno no existe o
   no exige reviewers, el job `authorize` del workflow falla antes de exponer nada.

## Procedimiento por SHA

1. Leer el diff completo de la PR y anotar el SHA de HEAD (40 caracteres).
2. Desde la rama `main`, con *Run workflow*, disparar con `pr_number` y `reviewed_sha`:
   - `Cloud DB — ejecución revisada (main)`, operation `pgTAP`;
   - `Admin Auth — ejecución revisada (main)`;
   - `Admin Auth producto — ejecución revisada (main)`.
3. El workflow de producto se detiene esperando aprobación del entorno. Aprobar **sólo** después de inspeccionar ese
   SHA: el job hace checkout de ese commit exacto (no de una rama móvil ni de `pull/*/merge`) y le entrega los secretos
   del owner en un runner efímero de GitHub, sin caché ni artifacts.
4. El job de producto corre `pnpm run test:integration:auth` y `pnpm run test:e2e:admin-auth` con
   `SUPABASE_TEST_REQUIRE_CLOUD=1`. Lo exigido:
   - `admin-session.integration.test.ts` con exactamente 2/2 pasados;
   - toda la corrida sin fallidos, pendientes ni todo;
   - Playwright Auth con exactamente 3 esperados y 0 inesperados, saltados o flaky.

   El conteo lo verifica código del propio workflow (de `main`), no de la PR.
5. El job `publish`, que no hace checkout ni ejecuta código de la PR, publica `success` sólo si todo lo anterior
   pasó. Cualquier fallo, skip o aprobación denegada publica `failure`.
6. Para sensibilidad, antes de la corrida final se puede aplicar una mutación temporal y local del login, del gate
   `admin_memberships` o del logout, comprobar que falla el caso correspondiente y repetir con el árbol limpio. No
   publicar la mutación ni sus secretos.

Ningún status manual, de otro SHA, de un run por comentario o de un workflow distinto desbloquea el merge. Si el
SHA de la PR cambia, hay que repetir los tres runs.
