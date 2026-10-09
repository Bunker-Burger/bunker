# BB-11 — Autenticación y protección administrativa

**Fecha:** 2026-10-09  
**Issue:** [#11](https://github.com/Bunker-Burger/bunker/issues/11)  
**Estado:** diseño listo para revisión

## Objetivo

Incorporar un acceso administrativo privado en `/bunker` y proteger `/bunker/admin` con una sesión Supabase validada en servidor y una membresía activa en `admin_memberships` para la tienda `bunker-burger`.

En el entorno actual habrá una sola cuenta aprovisionada manualmente. Esa cuenta tendrá rol `owner`. La aplicación seguirá rechazando defensivamente cualquier usuario autenticado que no tenga una membresía activa para la tienda, porque la existencia de una cuenta en `auth.users` por sí sola nunca autoriza administración.

## Alcance

- Inicio de sesión por email y contraseña, sin registro público, recuperación de contraseña ni proveedores externos.
- Renovación de cookies con el mecanismo SSR vigente de Supabase para Next.js 16.
- Autorización server-side mediante `auth.getUser()` y `admin_memberships`.
- Landing administrativa mínima, cierre de sesión local y retorno seguro al login.
- Tab `Admin` en la navegación pública únicamente durante una sesión administrativa válida.
- Exclusión explícita de las rutas de autenticación y administración del caché offline.
- Pruebas unitarias, de integración de los límites de autenticación y E2E del recorrido principal.
- Aprovisionamiento de la membresía `owner` para la única cuenta ya creada en el proyecto cloud de desarrollo y documentación del procedimiento equivalente para producción.

No incluye CRUD de catálogo o promociones, gestión de cuentas, invitaciones, recuperación de contraseña, pedidos, clientes, cocina, reparto, zonas ni facturas. Esas capacidades pertenecen a tareas posteriores.

## Decisiones de diseño

### 1. Autenticación con Server Actions y cookies SSR

El formulario de `/bunker` envía email y contraseña a una Server Action. La acción valida el `FormData`, crea el cliente Supabase de sesión por request y llama a `signInWithPassword`.

Después de autenticar, la misma operación comprueba una membresía activa para `bunker-burger`. Si no existe, cierra inmediatamente la sesión con alcance local y devuelve el mismo error genérico usado para credenciales inválidas. Esto evita revelar si una dirección pertenece a una cuenta real.

No se almacenan credenciales ni decisiones de autorización en el cliente. Tampoco se consulta `user_metadata`.

### 2. Renovación de sesión en `proxy.ts`

Un `proxy.ts` de Next.js 16 crea un cliente Supabase por request, ejecuta `auth.getClaims()` para refrescar tokens cuando corresponda y copia todas las cookies renovadas tanto al request como al response. El proxy preserva los headers de control de caché producidos durante esa renovación.

El proxy mantiene fresca la sesión, pero no decide permisos. La autorización real permanece en la capa server-side de acceso administrativo. El matcher cubre las rutas dinámicas de la aplicación y excluye assets estáticos, imágenes optimizadas, favicon y el service worker.

### 3. Autorización en la capa de acceso existente

La protección reutiliza `src/server/catalog/admin-access.ts`, que obtiene al usuario con `auth.getUser()` y consulta `admin_memberships` junto con la tienda. Se agregará un helper estrecho para exigir acceso a `bunker-burger` y devolver únicamente los datos necesarios: identificador del usuario, rol y tienda.

El layout de `/bunker/admin` ejecuta este control en servidor en cada entrada y se marca dinámico/no-store. Una sesión ausente, expirada o revocada, una membresía inactiva o una membresía de otra tienda redirigen a `/bunker` antes de renderizar datos administrativos.

La portada pública usa el mismo control server-side para decidir el booleano `showAdminNav`. Ocultar el tab es solo una mejora de interfaz; nunca reemplaza la protección de `/bunker/admin`. Los datos públicos de catálogo conservan su caché existente, mientras la comprobación específica del usuario se ejecuta sin caché compartida.

### 4. Redirecciones cerradas y cierre de sesión

Todos los destinos son constantes internas:

- Login exitoso: `/bunker/admin`.
- Acceso administrativo rechazado o sesión vencida: `/bunker`.
- Logout exitoso: `/bunker`.

No se aceptan parámetros `next`, `returnTo` ni URLs aportadas por el usuario. El logout se procesa en servidor mediante una petición POST, llama a `signOut({ scope: "local" })`, invalida las rutas/layouts afectados y responde con redirección interna y headers `no-store`.

### 5. Superficie administrativa inicial

La primera pantalla de `/bunker/admin` será deliberadamente mínima: identidad visual de Búnker Burger, indicación del rol `owner`, enlace al menú público y acción de cierre de sesión. No anticipará las interfaces CRUD de BB-12 o BB-13.

### 6. Política offline

El service worker registra reglas `NetworkOnly` antes de la estrategia general para:

- `/bunker`
- `/bunker/admin` y cualquier subruta
- endpoints de autenticación o logout que se incorporen para este flujo

Estas respuestas no entran en precache ni runtime cache. Si no hay red, la aplicación no muestra una copia previa del login ni de contenido administrativo.

## Flujo de datos

1. El visitante abre `/bunker`; el servidor renderiza el formulario sin contenido administrativo.
2. La Server Action valida el payload e intenta `signInWithPassword`.
3. Supabase escribe la sesión mediante el adaptador de cookies del cliente SSR.
4. El servidor llama a `auth.getUser()` y consulta una membresía activa para `bunker-burger`.
5. Si la membresía es `owner`, se redirige a `/bunker/admin`; de lo contrario, se elimina la sesión local y se responde con error genérico.
6. En cada request posterior, `proxy.ts` mantiene las cookies vigentes y el layout admin vuelve a comprobar usuario y membresía.
7. El logout elimina la sesión local, invalida las vistas dependientes de autenticación y redirige a `/bunker`.

## Errores y estados

- Credenciales inválidas o usuario válido sin membresía: `Email o contraseña incorrectos`.
- Falla temporal de red o Supabase: `No pudimos iniciar sesión. Intentá nuevamente.`
- Sesión ausente, expirada o revocada: redirección a `/bunker` sin exponer contenido administrativo.
- Membresía inactiva o de otra tienda: mismo rechazo que una sesión no autorizada.
- Logout con sesión ya ausente: operación idempotente y redirección a `/bunker`.

Los mensajes no incluyen detalles internos ni permiten enumerar cuentas. Los logs, si son necesarios, omiten contraseña, access token, refresh token y cookies.

## Aprovisionamiento cloud

BB-11 no requiere cambios de esquema ni una migración SQL. La relación de la cuenta con la tienda es dato operacional dependiente del entorno.

En desarrollo se verificará que exista exactamente un usuario de Auth y exactamente una tienda con slug `bunker-burger`; después se insertará o actualizará una única membresía activa con rol `owner`. La operación se hará directamente contra el proyecto cloud de desarrollo y se verificará por lectura posterior. No se guardará el UUID del usuario en el repositorio.

La documentación operativa describirá el mismo procedimiento para producción: crear manualmente el usuario, resolver su UUID y el UUID de la tienda en ese entorno, y crear la membresía `owner`. El rol `admin` permanece disponible en el enum existente, pero no se asigna a otra cuenta para este alcance.

## Estrategia de pruebas

El desarrollo seguirá TDD. Cada comportamiento nuevo comenzará con una prueba roja que atraviese el límite productivo correspondiente.

### Unitarias y de integración

- Login exitoso de la cuenta con membresía `owner`.
- Credenciales inválidas y cuenta autenticada sin membresía con el mismo mensaje público.
- Sesión ausente, expirada y revocada.
- Membresía inactiva y acceso cruzado a otra tienda.
- Prohibición de autorizar mediante `user_metadata` o estado solo cliente.
- Redirecciones limitadas a los destinos internos constantes.
- Logout local, idempotente e invalidación de las vistas dependientes.
- Propagación de cookies y headers desde `proxy.ts`.
- Tab `Admin` visible solo para una membresía válida.
- Rutas `/bunker`, `/bunker/admin` y logout resueltas por `NetworkOnly` antes del caché general.

Las pruebas del dominio inyectarán clientes o puertos pequeños donde corresponda; no reemplazarán la decisión de autorización con mocks que la den por cierta.

### E2E

Playwright comprobará el login válido, el rechazo de credenciales inválidas, la protección por acceso directo y el logout contra el entorno cloud de desarrollo cuando estén disponibles las credenciales de prueba configuradas. Las credenciales se leen exclusivamente de variables de entorno y nunca se incorporan al repo, artefactos o screenshots.

## Verificación y entrega

Antes de abrir la PR se ejecutarán:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- las pruebas Playwright relevantes
- las pruebas de integración Supabase disponibles para el proyecto enlazado
- Supabase Security Advisor
- Supabase Performance Advisor

También se verificará manualmente que solo exista la cuenta administrativa prevista, que tenga una única membresía activa `owner` para `bunker-burger`, y que no se hayan creado usuarios o roles adicionales. La PR quedará lista para revisión y no se fusionará.

## Riesgos y mitigaciones

- **Sesión válida con permisos retirados:** la membresía se consulta en servidor en cada acceso administrativo; no se confía en claims persistidos para autorización.
- **Contenido privado servido desde caché:** las vistas admin son no-store y el service worker las trata como `NetworkOnly`.
- **Enumeración de cuentas:** credenciales inválidas y falta de membresía comparten el mismo mensaje.
- **Open redirect:** ningún destino proviene del request o del formulario.
- **Diferencias entre entornos:** el aprovisionamiento usa identificadores resueltos en cada proyecto y no UUIDs hardcodeados.
- **Dependencia de Supabase:** una indisponibilidad temporal produce un estado genérico recuperable y nunca concede acceso por defecto.
