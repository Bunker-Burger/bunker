# BB-17 — Suite E2E, accesibilidad y seguridad adversarial

## Propósito

BB-17 convierte los criterios de aceptación de BB-07 a BB-16 en evidencia repetible de lanzamiento. El trabajo parte de `origin/main`, que ya contiene BB-16 y una base amplia de pruebas. La suite nueva no repetirá cobertura existente: primero registrará qué criterio protege cada prueba actual y después agregará únicamente los casos que falten.

## Resultado esperado

- Todo criterio de BB-07 a BB-16 queda asociado a una prueba automática concreta o a un checklist manual con motivo verificable.
- Los recorridos críticos bloquean una PR cuando fallan y producen evidencia diagnóstica suficiente.
- Los tests de navegador usan roles, nombres y estados accesibles; los selectores estructurales quedan limitados a mediciones de layout o caché que no tienen equivalente semántico.
- Los límites de seguridad se prueban en la capa más baja que pueda demostrarlos de forma real: Vitest para dominio/HTTP, pgTAP o integración cloud para RLS, y Playwright para el comportamiento observable del navegador.
- La cobertura sensible a credenciales no se presenta como aprobada cuando el entorno requerido no está disponible.

## Arquitectura de cobertura

### 1. Registro de aceptación

Un registro versionado será la fuente de trazabilidad para BB-07 a BB-16. Cada entrada tendrá:

- identificador estable;
- ticket y criterio protegido;
- tipo de evidencia (`unit`, `integration`, `database`, `e2e` o `manual`);
- ruta del archivo de prueba y texto identificable del caso, o instrucciones y justificación manual;
- entorno requerido (`local`, `CI`, `Supabase development`, `Mercado Pago sandbox` o `Vercel Preview`).

Una prueba de Vitest validará el registro: identificadores únicos, rutas existentes, evidencia automática resoluble y justificación no vacía para casos manuales. El registro no intentará interpretar Markdown libre ni ejecutar pruebas desde sus títulos; servirá como contrato de trazabilidad y fallará ante referencias obsoletas.

### 2. Pirámide de pruebas

- **Dominio y HTTP:** cotización, promociones, cambio de precio, validación de carrito, firma y replay del webhook, idempotencia, carrera y retención.
- **Base de datos e integración:** RLS, membresías administrativas, escrituras no autorizadas y políticas de Storage. Cuando requieran el proyecto cloud protegido, su estado se registrará como evidencia cloud, no como un skip local que parezca éxito.
- **Playwright local:** carta, cuatro tipos de producto, personalización, edición, persistencia, agotados, estado cerrado, delivery, WhatsApp, accesibilidad, responsive y PWA/offline.
- **Playwright con entorno protegido:** login real, upload adversarial y recorridos que dependen de una cuenta aprovisionada.
- **Manual:** MP sandbox y comprobaciones visuales o asistivas que no puedan automatizarse con fidelidad. Cada paso indicará precondición, resultado esperado y evidencia a adjuntar.

### 3. E2E y accesibilidad

Los recorridos se mantendrán agrupados por capacidad, reutilizando las specs actuales. Sólo `responsive.spec.ts` se ejecutará en 320, 390, 768 y 1280 px; el resto usará proyectos móvil y escritorio para evitar multiplicar innecesariamente el tiempo de CI.

La cobertura accesible combinará axe WCAG 2 A/AA con pruebas conductuales de teclado, foco, nombres/roles, anuncios de estado, cierre y retorno de overlays, contraste automatizable y targets de 44 px. Las aserciones de estructura CSS sólo se usarán para overflow, dimensiones, posición fija y contenido de Cache Storage.

### 4. Seguridad adversarial

La suite verificará explícitamente:

- ausencia de confianza en precios, totales, moneda, referencia y retorno enviados por el navegador;
- webhook con firma inválida, replay, mismatch y carreras;
- rechazo de anónimo, sesión expirada, usuario sin membresía y acceso cruzado;
- rechazo server-side de uploads falsos, SVG, exceso de tamaño o dimensiones y rutas ajenas;
- ausencia de secretos en HTML/respuestas públicas;
- exclusión de Admin, Auth, mutaciones, checkout sensible y RSC de la caché PWA.

No se usarán credenciales de servicio en Playwright ni se debilitarán RLS o Auth para facilitar pruebas.

## CI y evidencia

El job E2E construirá y probará el artefacto de producción. Playwright conservará trace y screenshot al primer fallo/reintento, y GitHub Actions subirá tanto `playwright-report/` como `test-results/` con nombres únicos. El job de aplicación validará también el registro de aceptación mediante la suite Vitest.

Los recorridos cloud protegidos seguirán separados de PRs no confiables. Su evidencia debe vincularse al SHA revisado usando los gates existentes; un entorno sin credenciales debe producir una clasificación explícita de `manual/cloud requerido`, nunca un falso aprobado.

Vercel Preview queda cubierto por dos señales: el build requerido de la integración de Vercel y los checks obligatorios de GitHub para la misma PR. BB-17 documentará qué checks deben marcarse como requeridos; no asumirá que una configuración externa fue aplicada sólo porque exista YAML en el repositorio.

## Manejo de fallos

- Los datos controlables se interceptarán con fixtures deterministas; no habrá esperas arbitrarias.
- Los tests que dependen de red externa estarán fuera del gate local y tendrán evidencia separada.
- Un skip sólo se permite por una diferencia real de plataforma o entorno y debe aparecer en el registro de aceptación.
- Los reintentos sirven para capturar trace, no para declarar estable un caso intermitente. Toda intermitencia reproducible se corrige o se retira del gate hasta tener causa documentada.

## Fuera de alcance

- Crear nuevas funciones de producto para BB-07 a BB-16.
- Automatizar devoluciones de Mercado Pago o usar producción para QA.
- Añadir WebKit/Firefox sin un criterio de compatibilidad aprobado.
- Convertir Lighthouse en el único verificador de PWA o accesibilidad.
- Cambiar secretos, branch protection o configuración de Vercel sin autorización operativa; se entregará el checklist exacto cuando la configuración externa sea necesaria.

## Criterio de finalización de BB-17

BB-17 estará listo cuando el registro no tenga criterios sin clasificar, las referencias automáticas sean válidas, los huecos críticos tengan pruebas ejecutables, los casos manuales estén justificados y reproducibles, CI adjunte evidencia de fallos, y lint, tipos, unitarias, build y E2E locales pasen desde el worktree.
