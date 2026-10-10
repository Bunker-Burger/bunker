# Protocolo de evidencia cloud por alcance

El CI de las PRs (`app` y `e2e`) no tiene secretos y no toca la nube. La evidencia cloud (pgTAP sobre Supabase y
pruebas de Auth con credenciales reales) **no es un gate automático**: es una condición de merge que el mantenedor
verifica, exigida sólo a las PRs cuyo alcance la necesita. Este documento define qué alcance la exige, cómo se
produce, cómo se acredita, dónde queda registrada y qué pasa si no se puede producir.

## Estado de la infraestructura

- Hay **un único proyecto Supabase** (`zokkgocmcaqcujltfkjf`). Los workflows lo llaman "development", pero es también
  el que irá a producción: pgTAP y los harness de Auth corren contra ese proyecto.
- En `main` hay tres workflows confiables, que sólo se disparan a mano (`workflow_dispatch`) y nunca ejecutan secretos
  desde un workflow `pull_request`:
  - `cloud-db-reviewed.yml` (pgTAP);
  - `admin-auth-reviewed.yml` (Auth config);
  - `admin-auth-product-reviewed.yml` (Auth producto).
- Los dos primeros usan el Environment `main` y sus secretos. Si faltan, el run falla; no se asume que existan.
- **El entorno protegido `admin-auth-product` no existe.** El workflow de Auth producto falla en `authorize` antes de
  exponer secretos, así que **hoy la evidencia de Auth producto no se puede producir**: se registra como bloqueo (ver §4).

## 1. Alcance: qué PR necesita qué evidencia

La fuente de verdad es `scripts/ci/cloud-evidence-scope.mjs`. El job **"Alcance de evidencia cloud (informativo)"**
de `ci.yml` lo ejecuta en cada PR y publica en el *summary* del run (y como *notice*) qué corresponde al HEAD de esa
PR. Es informativo: no ejecuta nada en la nube y no falla por alcance, sólo si no puede leer la lista de archivos.

| Si la PR cambia… | Evidencia **antes del merge**, sobre el HEAD exacto |
|---|---|
| `supabase/migrations/**` (esquema, RLS, grants) | pgTAP + Auth config |
| `supabase/tests/database/**`, `supabase/seed.sql` | pgTAP |
| `src/server/auth/**`, `src/server/catalog/admin-access*.ts`, `src/server/supabase/{clients,config,update-session}.ts`, `src/proxy.ts`, `src/app/bunker/**`, `src/app/sw.ts`, `src/app/sw-routes.ts`, `tests/e2e/admin-auth.spec.ts`, `playwright.admin-auth.config.ts` | Auth producto |

| Si la PR cambia infraestructura confiable de `main`… | Qué se exige |
|---|---|
| `.github/workflows/cloud-db-reviewed.yml` | Revisión del mantenedor; validar con el primer run de pgTAP posterior al merge |
| `.github/workflows/admin-auth-reviewed.yml`, `scripts/check-admin-auth-cloud.mjs` | Ídem, con el primer run de Auth config |
| `.github/workflows/admin-auth-product-reviewed.yml`, `scripts/ci/preflight-supabase-dev.mjs` | Ídem, con el primer run de Auth producto |
| `.github/workflows/ci.yml`, `scripts/ci/verify-cloud-statuses.mjs`, `scripts/ci/cloud-evidence-scope.mjs` | Sólo revisión del mantenedor |

Una PR no puede ejecutar su propia versión de un workflow `workflow_dispatch`: siempre corre la de `main`, y los tres
workflows exigen una PR abierta. Por eso un cambio de infraestructura se valida en el **primer run posterior al merge**,
sobre la siguiente PR que necesite esa evidencia. Ese run se enlaza también en un comentario de la PR de
infraestructura.

Cualquier otro cambio (menú, carrito, pagos, catálogo público, docs) no requiere evidencia cloud.

## 2. Cómo producir la evidencia (sobre el SHA de HEAD exacto)

Lo hace un **mantenedor** (permiso `maintain` o `admin`) después de leer el diff de ese SHA.

1. Anotar el SHA completo: `gh pr view <n> --json headRefOid -q .headRefOid`.
2. Disparar desde la rama `main` (*Actions → workflow → Run workflow*) con `pr_number=<n>` y `reviewed_sha=<SHA>`:
   - **pgTAP:** "Cloud DB — ejecución revisada (main)", `operation=pgTAP`. Corre los tests de
     `supabase/tests/database` de ese SHA contra el proyecto Supabase con herramientas de `main`; no ejecuta JS de la
     PR. Como el proyecto es único, revisar el SQL antes de dispararlo.
   - **Auth config:** "Admin Auth — ejecución revisada (main)". Corre el harness de `main` (contraseña inválida
     rechazada, owner activo de `bunker-burger`, logout local 204); no ejecuta código de la PR.
   - **Auth producto:** "Admin Auth producto — ejecución revisada (main)". Ejecuta código de la PR con secretos, por eso
     sólo es válido con el entorno `admin-auth-product` protegido (required reviewers, sin bypass, sólo la rama `main`)
     y aprobando el job después de inspeccionar el SHA. **No** se reemplaza corriendo `test:integration:auth` o
     `test:e2e:admin-auth` con credenciales del owner en otra máquina o runner sin ese aislamiento.
3. Cada workflow publica, si pasa, el status correspondiente en el SHA: `cloud/pgTAP-reviewed`,
   `cloud/admin-auth-reviewed` o `cloud/admin-auth-product-reviewed`.
4. Comprobar la procedencia con el verificador, sólo para los contextos requeridos:

   ```text
   GH_TOKEN=<token de lectura> GITHUB_REPOSITORY=Bunker-Burger/bunker PR_NUMBER=<n> REVIEWED_SHA=<SHA> \
   CONTEXTS=cloud/pgTAP-reviewed,cloud/admin-auth-reviewed node scripts/ci/verify-cloud-statuses.mjs
   ```

   Sale con 0 sólo si cada status es el más reciente del contexto en ese SHA, creado por `github-actions[bot]`, y
   apunta a un run `workflow_dispatch` de `main`, del workflow exacto, `completed/success`, con `run-name`
   `<título> | PR #<n> | <SHA>` y `head_sha` alcanzable desde `main` (detalle en `admin-auth-reviewed.md`).

## 3. Registro (dónde y cómo queda acreditada)

La evidencia queda en tres lugares, enlazados entre sí:
- **Run de GitHub Actions:** inmutable, con logs; no sube artifacts ni secretos.
- **Status en el commit:** `GET /repos/Bunker-Burger/bunker/statuses/<SHA>`.
- **Comentario en la PR:** escrito por quien produjo la evidencia. Es el registro que revisa el mantenedor.

```text
### Evidencia cloud — PR #<n> @ <SHA de 40 caracteres>
Alcance (job "Alcance de evidencia cloud"): <pgTAP / Auth config / Auth producto / ninguno>
- pgTAP: <URL del run> — status cloud/pgTAP-reviewed success — responsable @<usuario> — <fecha>
- Auth config: <URL del run> — status cloud/admin-auth-reviewed success — responsable @<usuario> — <fecha>
- Auth producto: <URL del run> — 2/2 + 3/3 — status cloud/admin-auth-product-reviewed success — @<usuario> — <fecha>
  o: BLOQUEADO — <causa concreta, p. ej. "no existe el entorno admin-auth-product"> — <URL del run fallido si lo hubo>
Verificador: CONTEXTS=<…> verify-cloud-statuses.mjs → exit 0 (o la salida de error)
```

Si el HEAD cambia, el registro anterior deja de valer: hay que repetir los runs y publicar un comentario nuevo con el
SHA nuevo.

## 4. Si la evidencia no se puede producir

Cuando falta infraestructura segura (hoy, el entorno `admin-auth-product`), credenciales o permisos:

1. Quien prepara la PR registra el **bloqueo** en el comentario de evidencia: qué evidencia falta, la causa concreta y
   el run fallido si existe. No se publican statuses a mano ni se usa un status de otro SHA.
2. El **mantenedor** decide de forma explícita, en un comentario propio en la PR:
   - **no mergear** hasta tener la infraestructura; o
   - **mergear aceptando el riesgo**, nombrando qué queda sin verificar (por ejemplo, "login/logout admin contra
     Supabase real") y cuándo se validará.

   Sin esa decisión escrita, una PR con evidencia requerida y no producida no se mergea.

## 5. Regla de merge

El mantenedor mergea una PR con alcance cloud sólo si:
- el último comentario de evidencia es del **HEAD actual** (`headRefOid` igual al SHA del comentario);
- cada evidencia requerida tiene un run `success` verificado con `verify-cloud-statuses.mjs`, **o** un bloqueo
  registrado con su decisión explícita de aceptar el riesgo;
- en cambios de infraestructura confiable, revisó el diff y dejó constancia de que el workflow se validará en el
  primer run posterior al merge.

## 6. Qué NO es evidencia cloud

- Los tests del verificador (`src/ci/verify-cloud-statuses.test.ts`) y del clasificador: prueban que rechazan evidencia
  falsa o que clasifican bien, no que la base o el Auth funcionen.
- El job de alcance, `pnpm test` y los E2E públicos: corren sin credenciales. Los tests cloud se saltan o fallan
  cerrados.
- Un status publicado a mano, de otro SHA, de un run por comentario (`/verify-db`) o de otro workflow.
