# Vercel Preview por PR y checks obligatorios

## Por qué desde Actions

El proyecto de Vercel `bunker-burger` está en el plan **Hobby**, que no despliega un repo **privado de una organización**
de GitHub con su integración de Git. Por eso las previews salen del workflow `.github/workflows/vercel-preview.yml`
con la CLI de Vercel (`vercel pull` → `vercel build` → `vercel deploy --prebuilt`), como los dos deploys que ya existen
(subidos con la CLI).

Ese workflow **sólo hace previews**. No despliega producción: eso queda para BB-19, con dos proyectos Supabase separados
y la decisión del mantenedor.

## Qué hace en cada PR

- **Check `Vercel Preview`:** corre en cada PR que sale de una rama de este repo. Las PRs desde forks no reciben
  secretos y no tienen preview.
- **Enlace de la preview:** el deploy queda asociado al SHA de la PR en el entorno `preview` de GitHub, con su URL, y la
  URL también aparece en el resumen del run.
- **Falla, sin publicar,** si:
  - falta alguno de los secretos `VERCEL_TOKEN`, `VERCEL_ORG_ID` o `VERCEL_PROJECT_ID` en el entorno `preview`;
  - las variables de **Preview** en Vercel tienen algo secreto o de producción: `SUPABASE_SERVICE_ROLE_KEY`,
    `SUPABASE_SECRET_KEY`, `SUPABASE_TEST_ADMIN_EMAIL`, `SUPABASE_TEST_ADMIN_PASSWORD`, `MERCADO_PAGO_ACCESS_TOKEN`,
    `MERCADO_PAGO_WEBHOOK_SECRET` o `SUPABASE_PROJECT_ENV=production`. La app no lee ninguna de las de Supabase o de
    test; `vercel pull` las dejaría en el runner de cualquier PR.
- **Sin variables de Preview cargadas,** la preview muestra "No pudimos cargar la carta". Nunca muestra el menú demo
  (`allowsDemoCatalog`) ni datos de producción.

## Configuración (la hace el mantenedor)

1. **Token de Vercel para CI.** En Vercel → Account Settings → Tokens, crear uno sólo para este uso, con scope del equipo
   `lautaroj073` y vencimiento. No reutilizar el token de la sesión local de la CLI.
2. **Entorno `preview` en GitHub.** En Settings → Environments, crear el entorno y cargar estos secretos:
   - `VERCEL_TOKEN`: el token del paso 1;
   - `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`: los mismos que ya están en el entorno `main`.

   Los secretos del entorno `main` **no** sirven para las PRs: ese entorno sólo admite la rama `main`, y así tiene que
   seguir.
3. **(Opcional) Variables de Preview en Vercel.** Si se cargan, que apunten al proyecto Supabase de **desarrollo**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_PROJECT_ENV=development`. Nunca claves
   secretas.

**Riesgo aceptado por el dueño:** cualquiera con permiso de push al repo puede modificar el workflow en una PR y usar
`VERCEL_TOKEN`. Por eso conviene un token propio, con scope acotado y vencimiento, que se pueda revocar sin tocar nada
más.

## Checks obligatorios: bloqueados por plan

GitHub devuelve **403** al leer o configurar la protección de `main`, tanto en branch protection como en rulesets:
"Upgrade to GitHub Pro or make this repository public". Con la organización en GitHub Free y el repo privado **no se
pueden exigir checks** antes de mergear. Un workflow no lo puede reemplazar.

Cuando el plan lo permita (GitHub Team) o el repo pase a público, en Settings → Rules → Rulesets → New branch ruleset
para `main`:

- marcar **Require a pull request before merging**;
- marcar **Require status checks to pass** con `app`, `e2e` y `Vercel Preview`;
- marcar **Block force pushes**;
- no habilitar bypass salvo para administradores, si el dueño lo decide.

Hasta entonces el bloqueo queda **registrado por plan**: no hay checks obligatorios y el merge depende de la revisión.
