# Vercel Preview por PR y checks obligatorios

## Por qué desde Actions

El proyecto de Vercel `bunker-burger` está en el plan **Hobby**, que no despliega un repo **privado de una organización**
de GitHub con su integración de Git. Por eso la preview se arma con la CLI de Vercel desde Actions.

No hay deploy de producción en este circuito: eso queda para BB-19 y la decisión del mantenedor.

## Dos mitades: build sin credenciales, deploy autorizado desde main

| | `vercel-preview.yml` (check **Vercel Preview (build)**) | `vercel-preview-deploy.yml` (**Vercel Preview — deploy autorizado**) |
|---|---|---|
| Disparo | Cada `pull_request`, automático | `workflow_dispatch`, lo corre a mano el mantenedor **desde `main`**, con la PR y el SHA completo que revisó |
| Código | El **HEAD exacto** de la PR (`head.sha`, no el merge ref) | Sólo el de `main` (el validador); **nunca** hace checkout ni instala el código de la PR |
| Credenciales | **Ninguna**: sin secretos, sin entorno, permisos de sólo lectura. `vercel-preview-guard build-env` falla si llega alguna antes de instalar nada | `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` del entorno `preview`, **sólo** en los dos últimos pasos |
| Resultado | `vercel build --target preview` con un `project.json` local sin ids reales, empaquetado como artefacto `vercel-preview-<sha>` | `vercel deploy --prebuilt` (preview, sin `--prod`) con metadatos `githubCommitSha` y `githubPrId` |

### Barreras

- **Entorno `preview` restringido a `main`.** Una PR que edite su YAML para usar ese entorno es rechazada por GitHub
  antes de correr un solo paso. Se comprobó el 12/10 re-ejecutando el run 38201919308 de la PR #52: "Branch
  refs/pull/52/merge is not allowed to deploy to preview due to environment protection rules".
- **El deploy también exige `main`** (`if: github.ref == 'refs/heads/main'`), para que la copia del workflow en una
  rama no llegue ni a intentarlo.
- **`vercel-preview-guard dispatch`** sólo autoriza si se cumple todo esto:
  - el SHA tiene 40 caracteres;
  - la PR está abierta y sale de este repo, no de un fork;
  - ese SHA es el **HEAD actual** de la PR (si se pushea algo después de revisar, hay que volver a autorizar);
  - existe un run **exitoso** de `vercel-preview.yml`, con evento `pull_request`, para ese SHA.
- **`vercel-preview-guard prebuilt`** revisa el artefacto: tiene que tener `config.json` y `builds.json` con
  `target: "preview"`, no puede traer ningún `.env*` ni enlaces que apunten fuera del output. Un enlace así subiría
  archivos del runner.
- **La CLI de Vercel** se instala aparte, con versión fija y `--ignore-scripts`. Nunca se usa la de la PR.

## Preview no recibe variables (allowlist vacía)

Hoy hay **un solo** proyecto Supabase cloud, y va a ser producción (BB-19). Una preview **no puede** apuntar ahí: ponerle
la etiqueta `development` no aísla nada. Por eso `vercel-preview-guard preview-env` consulta las variables del
proyecto en Vercel (sólo los nombres) y **falla antes de publicar** si hay **cualquier** variable con target Preview.
No es una lista de nombres prohibidos: la lista de permitidas está vacía.

Sin variables, la preview muestra "No pudimos cargar la carta". Nunca muestra el menú demo (`allowsDemoCatalog`) ni
datos reales.

Recién cuando exista un proyecto Supabase **de desarrollo**, separado y autorizado por el dueño, se puede ampliar
`PREVIEW_ENV_ALLOWLIST`, y sólo para ese proyecto.

## Cómo publicar una preview

1. Revisar la PR en el SHA que muestra el check **Vercel Preview (build)**. El resumen del run lo dice.
2. Ir a Actions → **Vercel Preview — deploy autorizado** → **Run workflow**, con la rama `main`, el número de PR y el
   SHA completo.
3. La URL queda en el entorno `preview` de GitHub, asociada al SHA, y en el resumen del run.

El workflow de deploy sólo se puede ejecutar cuando ya está en `main`. Antes de mergear esta PR no hay forma de probarlo
de punta a punta: eso queda como evidencia pendiente.

## Configuración actual

- **Entorno `preview` de GitHub:** restringido a la rama `main`, con los secretos `VERCEL_TOKEN` (token propio de CI,
  con scope `lautaroj073`), `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`.
- **Vercel, entorno Preview:** sin variables. Production y Development conservan las suyas.

## Límites que no se pueden cubrir con el plan actual

- **Revisores obligatorios en el entorno:** no están disponibles para repos privados en GitHub Free. Por eso la
  autorización es el `workflow_dispatch` manual con SHA explícito: cualquiera con permiso de escritura puede lanzarlo.
- **Checks obligatorios:** GitHub responde **403** en branch protection y en rulesets ("Upgrade to GitHub Pro or make
  this repository public"). No se pueden exigir checks antes de mergear, y un workflow no lo reemplaza. Cuando el plan
  lo permita (GitHub Team) o el repo sea público, crear en Settings → Rules → Rulesets un ruleset para `main` con:
  - Require a pull request before merging;
  - Require status checks: `app`, `e2e` y `Vercel Preview (build)`;
  - Block force pushes.
- **Uso comercial:** Vercel Hobby es para uso no comercial; el sitio del local en producción requiere Pro.
