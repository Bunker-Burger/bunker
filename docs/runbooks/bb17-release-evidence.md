# BB-17 — Evidencia de release y gates de merge

Este runbook separa lo que el repositorio puede garantizar de la configuración externa que un mantenedor debe comprobar. La presencia del workflow no demuestra que GitHub o Vercel estén configurados como gates.

## Checks automáticos del repositorio

Para cada PR, el SHA actual debe tener éxito en:

- `CI / app`: instalación congelada, lint, tipos, Vitest y build de producción;
- `CI / e2e`: build de producción y Playwright en Chromium;
- el deployment Vercel Preview correspondiente exactamente al mismo SHA.

Si Playwright público falla, el job sube un artifact `playwright-evidence-<run>-<attempt>` que contiene `playwright-report/` y `test-results/`. La configuración conserva screenshot y trace de cada fallo final. Los recorridos de Auth protegidos mantienen artifacts desactivados para no persistir datos administrativos ni credenciales en el runner.

## Vercel Preview y branch protection

Un mantenedor debe abrir la configuración de la rama principal y comprobar que los checks `app`, `e2e` y el check real del deployment Vercel sean obligatorios y estén ligados a la rama actualizada antes del merge. También debe deshabilitar el merge cuando la rama esté desactualizada si ésa es la política elegida por el equipo.

La comprobación se registra en la PR con captura o enlace de la regla, nombre exacto de los checks, SHA y URL del Preview. Si el nombre del check de Vercel cambia, se actualiza la regla; no se codifica aquí un nombre supuesto.

## Prueba de artefactos de fallo

Antes de declarar BB-17 listo, seguir `docs/qa/bb17-manual-checklist.md#artefactos-de-fallo`. El run fallido controlado debe contener al menos:

- `playwright-report/index.html`;
- un screenshot PNG del estado fallido;
- `trace.zip` para el mismo caso;
- el contexto de error y el nombre del proyecto Playwright.

El probe temporal se elimina antes de fusionar. El run verde posterior debe usar el mismo SHA que se revisa o uno posterior que sólo retire el probe.

## Evidencia cloud protegida

Los cambios de Auth, RLS, Storage o base siguen `docs/runbooks/cloud-evidence.md`. Los workflows protegidos son evidencia separada del CI sin secretos. Un skip local nunca reemplaza pgTAP/Auth producto; si la infraestructura no existe, el mantenedor registra el bloqueo y decide explícitamente si acepta el riesgo.

## Registro mínimo en la PR

```text
### BB-17 — evidencia de release @ <SHA completo>
- CI / app: <URL> — success
- CI / e2e: <URL> — success
- Vercel Preview del SHA: <URL> — success + smoke
- Artifact probe: <URL del run fallido> — screenshot + trace verificados
- Evidencia cloud requerida: <ninguna | contexts + URLs | bloqueo documentado>
- Checks requeridos revisados por @<mantenedor> el <fecha>
```
