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
| `supabase/migrations/**` (esquema, RLS, grants) | **Migración** (delta SQL revisado + dry-run del SHA; efecto real según §2.1) + pgTAP + Auth config. Estos dos últimos sólo detectan regresiones del esquema **ya aplicado**: **no validan la migración** |
| `supabase/tests/database/**`, `supabase/seed.sql` | pgTAP |
| `src/server/auth/**`, `src/server/catalog/admin-access*.ts`, `src/server/catalog/catalog-service.ts` (`loadAdminCatalog`), `src/server/catalog/index.ts` (`getAdminCatalog`), `src/server/catalog-admin/**` (escrituras admin del catálogo), `src/server/store-admin/**` y `src/server/admin/**` (tienda, promociones y gate compartido), `src/server/supabase/{clients,config,update-session}.ts`, `src/proxy.ts`, `src/app/bunker/**`, `src/app/sw.ts`, `src/app/sw-routes.ts`, `tests/e2e/admin-auth.spec.ts`, `playwright.admin-auth.config.ts` | Auth producto |

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

Cualquier otro cambio (menú, carrito, pagos, adaptadores o repositorio del catálogo, la home, docs) no requiere
evidencia cloud. La home (`src/app/page.tsx`) sólo decide si *muestra* la pestaña Admin; la autorización vive en
`src/app/bunker/**`, `loadAdminCatalog` y el gate, que sí están en la tabla.

## 2. Cómo producir la evidencia (sobre el SHA de HEAD exacto)

Lo hace un **mantenedor** (permiso `maintain` o `admin`) después de leer el diff de ese SHA.

1. Anotar el SHA completo: `gh pr view <n> --json headRefOid -q .headRefOid`.
2. Disparar desde la rama `main` (*Actions → workflow → Run workflow*) con `pr_number=<n>` y `reviewed_sha=<SHA>`:
   - **pgTAP:** "Cloud DB — ejecución revisada (main)", `operation=pgTAP`. Copia **sólo** `supabase/tests/database`
     de ese SHA y corre `supabase test db` contra el esquema **ya aplicado** del proyecto, con herramientas de `main`;
     no ejecuta JS de la PR y **no aplica ni ejecuta migraciones** (ver §2.1). Como el proyecto es único, revisar el
     SQL antes de dispararlo.
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

### 2.1 Migraciones: qué se verifica y qué no

Con una PR que cambia `supabase/migrations/**`, los runs disponibles **no** prueban la migración nueva:

| Run | Qué hace | Qué NO prueba |
|---|---|---|
| pgTAP (`operation=pgTAP`) | Copia sólo `supabase/tests/database/*.sql` del SHA y corre `supabase test db` sobre el esquema ya aplicado | No aplica la migración. Su success sólo dice que el esquema **actual** pasa los tests. Si los tests de la PR esperan el esquema nuevo, fallan, y eso es esperable |
| Auth config | Prueba la configuración Auth actual del proyecto | Nada de la migración |
| Dry-run (`operation=dry-run`) | Copia `supabase/migrations/*.sql` del SHA y corre `supabase db push --dry-run`: lista qué migraciones se aplicarían | No ejecuta su SQL: no detecta errores de sintaxis o semántica ni prueba RLS o grants. No publica status |

Procedimiento antes del merge, en este orden:

1. **Inspección del delta SQL** (mantenedor), sobre el SHA exacto:
   - `git diff --name-status origin/main...<SHA> -- supabase/migrations` muestra **sólo archivos agregados** (`A`).
     Modificar o borrar una migración ya aplicada se bloquea.
   - Cada archivo nuevo tiene un timestamp posterior a la última migración de `main`.
   - Las tablas nuevas tienen RLS habilitada, policies y grants explícitos (BB-03). `anon` no gana acceso a datos
     privados. Ninguna policy usa `user_metadata`.
   - No hay `DROP` ni borrado de datos sin justificación escrita en la PR, ni secretos.
2. **Dry-run del SHA exacto:** desde `main`, "Cloud DB — ejecución revisada (main)" con `operation=dry-run`,
   `pr_number` y `reviewed_sha`. Hay éxito si se cumple todo esto:
   - el run termina `completed/success`;
   - `gh api repos/Bunker-Burger/bunker/actions/runs/<id> --jq '{display_title,event,head_branch,path,conclusion}'`
     da `display_title = "Cloud DB | dry-run | PR #<n> | <SHA>"`, `event = workflow_dispatch`, `head_branch = main` y
     `path = .github/workflows/cloud-db-reviewed.yml`;
   - el log del step "Previsualizar migraciones" lista **exactamente** los archivos nuevos de la PR. Otra migración
     pendiente indica que el proyecto no está al día con `main`, y eso bloquea.

   El dry-run **no** demuestra que la migración funcione.
3. **Efecto real:** sólo es verificable aplicando la migración en un **destino de desarrollo aislado** y corriendo
   ahí pgTAP, que entonces sí prueba el esquema nuevo. **Hoy no existe**: hay un único proyecto, que irá a producción.
   Por eso:
   - se registra **"Efecto de la migración: NO verificado (no hay destino aislado)"**;
   - el mantenedor decide por escrito: **bloquear** hasta tener un destino aislado, o **mergear aceptando el riesgo**,
     nombrando qué queda sin verificar;
   - aplicarla al proyecto único (`operation=apply`, que exige `confirm_project`) es **desplegar** en el entorno que irá
     a producción. Es una decisión consciente del mantenedor, no una validación previa, y nunca ocurre desde una PR ni
     automáticamente. Si se decide, después se corren pgTAP y Auth config y se registran con el SHA, aclarando que el
     efecto se comprobó en el proyecto único **después** de aplicarla.

**Criterios de éxito para una PR con migraciones** (todos):
- delta inspeccionado y registrado;
- dry-run `success` del SHA con la lista esperada;
- efecto **verificado** en un destino aislado (pgTAP `success` después de aplicar), **o** registrado como **NO
  verificado** con la decisión explícita del mantenedor.

Un success de pgTAP o Auth config sin la migración aplicada nunca cuenta como validación de la migración.

## 3. Registro (dónde y cómo queda acreditada)

La evidencia queda en tres lugares, enlazados entre sí:
- **Run de GitHub Actions:** inmutable, con logs; no sube artifacts ni secretos.
- **Status en el commit:** `GET /repos/Bunker-Burger/bunker/statuses/<SHA>`.
- **Comentario en la PR:** escrito por quien produjo la evidencia. Es el registro que revisa el mantenedor.

```text
### Evidencia cloud — PR #<n> @ <SHA de 40 caracteres>
Alcance (job "Alcance de evidencia cloud"): <Migración / pgTAP / Auth config / Auth producto / ninguno>
- Migración — delta SQL: revisado por @<mantenedor> (<archivos agregados>; RLS/grants/DROP revisados)
  — dry-run: <URL del run> success, lista <archivos> — efecto: NO verificado (sin destino aislado)
  | verificado en <destino aislado> con pgTAP <URL> después de aplicar
- pgTAP: <URL del run> — status cloud/pgTAP-reviewed success — responsable @<usuario> — <fecha>
  (con migraciones: "sólo regresión del esquema ya aplicado")
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
  primer run posterior al merge;
- con migraciones, se cumplen los criterios de §2.1: delta inspeccionado, dry-run `success` del SHA con la lista
  esperada y efecto verificado en un destino aislado **o** su decisión escrita sobre el efecto **NO verificado**.

## 6. Qué NO es evidencia cloud

- Los tests del verificador (`src/ci/verify-cloud-statuses.test.ts`) y del clasificador: prueban que rechazan evidencia
  falsa o que clasifican bien, no que la base o el Auth funcionen.
- El job de alcance, `pnpm test` y los E2E públicos: corren sin credenciales. Los tests cloud se saltan o fallan
  cerrados.
- Un status publicado a mano, de otro SHA, de un run por comentario (`/verify-db`) o de otro workflow.
- En una PR con migraciones: pgTAP o Auth config `success` sin la migración aplicada, o un dry-run `success`, como
  prueba de que la migración funciona.
