# Búnker Burger — Backlog ejecutable para agentes

Este documento traduce el plan maestro a tareas autosuficientes. Cada tarea corresponde a un Issue del GitHub Project **Búnker Burger** y está pensada para que una IA distinta pueda implementarla sin necesitar el historial del chat.

## Reglas comunes para todas las tareas

- Stack fijado: Next.js 16.4, React 19.3, TypeScript estricto, Tailwind CSS 4.3, shadcn/ui, Supabase y Serwist.
- Diseño canónico: `docs/desing/stitch_burger_online_ordering_system/b_nker_burguer_streetcraft/DESIGN.md` y las capturas `screen.png` hermanas.
- Marca oficial: **Búnker Burger**. Operación: Aguilares, Tucumán, Argentina.
- Dinero: `bigint` en centavos; mostrar ARS sin decimales con `Intl.NumberFormat`.
- Nunca confiar precios, promociones, stock ni referencias enviadas por el navegador.
- No crear tablas ni flujos de pedidos, cocina, reparto, zonas, clientes o facturas.
- No agregar bebidas alcohólicas ni contenido de alérgenos.
- Supabase se usa exclusivamente en la nube: un proyecto de desarrollo y otro de producción. No se usa Docker ni stack local.
- Durante el desarrollo, el repositorio canónico es `Bunker-Burger/bunker`; al cerrar el proyecto se transferirá completo a `Lautaro073/bunker`, conservando historial, Issues y PRs.
- Cada agente debe trabajar en una rama propia, respetar cambios ajenos, escribir pruebas primero cuando corresponda y abrir PR contra `main`.
- Antes del PR: `npm run lint`, `npm run typecheck`, `npm test` y las pruebas específicas de la tarea. GitHub Actions repite los gates en cada PR.
- Una tarea no puede darse por terminada si solo deja mocks, TODOs o una interfaz visual sin integrar.

## Orden recomendado

`BB-01 → BB-02 → BB-03 → BB-04` habilita el resto. Luego pueden ejecutarse en paralelo `BB-05/06/07/09/10`. Mercado Pago depende de checkout y datos. PWA, QA y lanzamiento cierran el proyecto.

---

## BB-01 — Estabilizar el scaffold, versiones y CI

**Prioridad:** P0  
**Área:** Plataforma  
**Tamaño:** M  
**Dependencias:** ninguna

### Objetivo

Dejar una base reproducible que compile y permita a todos los demás agentes trabajar sin divergencias de tooling.

### Alcance

- Revisar `package.json`, lockfile, TypeScript estricto, ESLint, Vitest y Playwright.
- Resolver incompatibilidades reales entre TypeScript y `typescript-eslint` usando la versión estable más nueva compatible; documentar cualquier excepción a “latest”.
- Configurar Tailwind CSS 4.3 y shadcn/ui (`components.json`, utilidades y componentes base).
- Mantener `.env.example` sin secretos.
- GitHub Actions en la organización: instalación reproducible, lint, typecheck, unitarias, build, Playwright y verificación cloud de base cuando exista el secreto de desarrollo.
- Añadir scripts de desarrollo y documentación mínima.

### Criterios de aceptación

- Una clonación limpia con Node 22 ejecuta `npm ci` reproduciblemente.
- Lint, typecheck, tests y build pasan.
- El workflow de GitHub Actions arranca en PR y `main` sin `startup_failure`.
- El lockfile está versionado y no hay rangos flotantes en dependencias directas.
- Ninguna clave secreta usa prefijo `NEXT_PUBLIC_`.

---

## BB-02 — Implementar tokens visuales, shell responsive y componentes shadcn

**Prioridad:** P0  
**Área:** Frontend  
**Tamaño:** M  
**Dependencias:** BB-01

### Objetivo

Normalizar las pantallas Stitch en un solo sistema visual reutilizable antes de construir funcionalidades.

### Alcance

- Oswald para títulos/precios y Space Grotesk para cuerpo/controles con `next/font`.
- Tokens carbón, ámbar y rojo; verde solo para estado positivo.
- Shell mobile-first con composiciones tablet/escritorio y ancho máximo coherente.
- Componentes shadcn adaptados: Button, Card, Dialog/Drawer, Tabs, Input, Textarea, Select, Switch, Badge y Toast.
- Barra inferior única con safe areas, foco visible y targets mínimos de 44 px.
- Estados de carga, vacío, error, deshabilitado y agotado.

### Criterios de aceptación

- Story/demo o página aislada muestra todos los primitives y estados.
- No hay colores, tipografías o radios duplicados de forma arbitraria.
- Contraste AA y navegación por teclado comprobados.
- La shell no queda tapada por teclado virtual ni barra fija.

---

## BB-03 — Crear esquema Supabase, RLS, Storage y pruebas SQL

**Prioridad:** P0  
**Área:** Datos  
**Tamaño:** XL  
**Dependencias:** BB-01

### Objetivo

Implementar la fuente de verdad segura para catálogo, administración, promociones y soporte de Mercado Pago.

### Alcance

- Tablas: `stores`, `admin_memberships`, `categories`, `products`, `product_images`, `option_groups`, `options`, `product_option_groups`, `promotion_rules`, `promotion_items`, `promotion_schedule`, `store_payment_methods`, `payment_quotes`, `payment_attempts`, `payment_webhook_events`.
- `bigint` para centavos, constraints, índices, timestamps y cascadas deliberadas.
- RLS y grants explícitos en toda tabla expuesta.
- `anon` solo puede leer catálogo publicado y configuración pública imprescindible.
- Autorización admin por `admin_memberships` + `auth.uid()`, nunca `user_metadata`.
- Bucket público de catálogo; escrituras solo admin; JPEG/PNG/WebP/AVIF, sin SVG.
- Función de validación de defaults y bloqueo de publicación inválida.
- Retención/purga de datos mínimos de pagos a 90 días.
- Seed controlado en el proyecto cloud de desarrollo y pruebas pgTAP de matriz anon/admin/no autorizado ejecutadas con `supabase test db --linked`.

### Criterios de aceptación

- `supabase db push --dry-run` permite revisar las migraciones antes de aplicarlas al proyecto enlazado.
- `supabase test db --linked` pasa contra el proyecto cloud de desarrollo.
- No se utiliza `supabase start`, Docker ni `db reset --linked`.
- Un usuario autenticado no administrador no gana permisos extra.
- Datos privados de pagos nunca son legibles por `anon`.
- No existen tablas de pedidos, clientes, cocina, reparto, zonas o facturas.

---

## BB-04 — Construir capa de acceso a datos y catálogo semilla

**Prioridad:** P0  
**Área:** Backend  
**Tamaño:** L  
**Dependencias:** BB-03

### Objetivo

Aislar Supabase detrás de repositorios tipados y ofrecer datos semilla coherentes en el proyecto cloud de desarrollo.

### Alcance

- Clientes Supabase browser/server según SSR actual.
- Tipos generados desde la base y adaptadores de dominio.
- Repositorios para tienda, categorías, productos, opciones y promociones.
- Catálogo semilla con los cuatro tipos y únicamente bebidas sin alcohol.
- Lecturas públicas cacheables; lecturas administrativas autenticadas y sin cache sensible.
- Separación explícita de credenciales cloud de desarrollo y producción; los tests unitarios usan repositorios inyectados sin simular una conexión productiva.

### Criterios de aceptación

- La UI no importa directamente tablas o cliente Supabase.
- Tests de adaptación cubren `bigint`, nulls, orden y productos agotados.
- Errores operativos se traducen a resultados controlados, no se silencian.
- Tipos generados se actualizan mediante un script documentado.

---

## BB-05 — Implementar motor de opciones, defaults y publicación

**Prioridad:** P0  
**Área:** Dominio  
**Tamaño:** L  
**Dependencias:** BB-04

### Objetivo

Garantizar que “Agregar” siempre produzca una configuración válida y que cada tipo solo vea opciones aplicables.

### Alcance

- Cardinalidad mínima/máxima, obligatoriedad, disponibilidad y orden.
- Defaults por relación producto-grupo.
- Selector aplicable por producto y tipo, no tabs globales visibles simultáneamente.
- Precio unitario derivado desde producto y opciones.
- Validación compartida cliente/servidor, con servidor autoritativo.
- Bloqueo de publicación cuando faltan defaults requeridos o no están disponibles.

### Criterios de aceptación

- Agregado directo válido para hamburguesa, sándwich, papas y bebida.
- Tests cubren single/multi select, opcionales, límites y option deshabilitada.
- Un default borrado/deshabilitado impide publicar.
- Bebidas no muestran opciones exclusivas de hamburguesas u otras categorías.

---

## BB-06 — Implementar carrito persistente y revalidación

**Prioridad:** P0  
**Área:** Frontend  
**Tamaño:** L  
**Dependencias:** BB-04, BB-05

### Objetivo

Crear un carrito local robusto que sobreviva recargas y vuelva a validar toda información mutable.

### Alcance

- Identidad de línea por producto + opciones normalizadas + notas normalizadas.
- Agregar/combinar, editar opciones/notas/cantidad y eliminar/vaciar.
- Persistencia versionada en dispositivo y sincronización entre pestañas.
- Recuperación segura de JSON corrupto/esquema viejo.
- Revalidar precio, promociones, stock, disponibilidad y defaults al volver.
- Resolver cambios mostrando aviso y actualización, nunca usando precio local como verdad.

### Criterios de aceptación

- Carrito persiste hasta vaciado explícito.
- Tests cubren corrupto, desactualizado, dos pestañas, agotado y cambio de precio.
- No se pierden notas al editar cantidad.
- El checkout queda deshabilitado si no hay líneas válidas.

---

## BB-07 — Construir carta pública y drawer de producto

**Prioridad:** P0  
**Área:** Frontend  
**Tamaño:** XL  
**Dependencias:** BB-02, BB-04, BB-05, BB-06

### Objetivo

Reproducir la carta aprobada de Stitch como experiencia real, accesible y responsive en `/`.

### Alcance

- Secciones destacadas, hamburguesas, sándwiches, papas y bebidas.
- Búsqueda/filtros y orden configurado.
- Tarjeta abre `/?producto=<slug>`; botón Agregar usa defaults sin abrir drawer.
- Drawer accesible para personalizar; Atrás cierra; recarga conserva; slug inválido limpia URL y avisa.
- Agotados visibles, etiquetados e imposibles de agregar.
- Navegación inferior Menú/Carrito/Checkout; Admin se suma solo con sesión admin.
- Layouts específicos para 320, 390, 768 y 1280 px.

### Criterios de aceptación

- Fidelidad visual comparada con las capturas canónicas.
- URL compartible abre el producto correcto.
- Cierre restaura scroll y foco del disparador.
- Lector de pantalla anuncia título, precio, controles y estado de stock.

---

## BB-08 — Implementar estado del local, horarios y tarifa de delivery

**Prioridad:** P0  
**Área:** Backend  
**Tamaño:** M  
**Dependencias:** BB-03, BB-04

### Objetivo

Decidir de forma autoritativa si se aceptan pedidos y cuánto cuesta el delivery.

### Alcance

- Horarios semanales con `America/Argentina/Tucuman` y tramos que crucen medianoche.
- Override manual: abierto, pausado, cerrado o automático.
- Próximo horario cuando esté configurado.
- Tarifa fija obligatoria antes de habilitar pedidos.
- Endpoint/servicio público con estado mínimo y cálculo server-side.

### Criterios de aceptación

- Cerrado permite navegar/conservar carrito pero bloquea pago y envío.
- Delivery fee se aplica exactamente una vez.
- Tests con DST/fechas límite y cruce de medianoche.
- No existen barrios, radios, mapas ni zonas.

---

## BB-09 — Implementar promociones no acumulables

**Prioridad:** P1  
**Área:** Dominio  
**Tamaño:** L  
**Dependencias:** BB-03, BB-04

### Objetivo

Aplicar una única promoción determinística desde datos reales.

### Alcance

- Reglas porcentuales/fijas o combos soportados por el esquema aprobado.
- Calendario, prioridad y pausa manual.
- Selección única por mayor prioridad y desempate estable.
- Precio tachado calculado desde precios reales.
- Cotización autoritativa de servidor reutilizable por WhatsApp y MP.

### Criterios de aceptación

- Dos promociones elegibles nunca se acumulan.
- Tests cubren calendario, prioridad, pausa y manipulación de entrada.
- No hay cupos, contadores ni límites automáticos por unidades.
- UI explica la promoción aplicada sin texto de precio libre.

---

## BB-10 — Implementar checkout por WhatsApp: efectivo y transferencia

**Prioridad:** P0  
**Área:** Checkout  
**Tamaño:** L  
**Dependencias:** BB-06, BB-08, BB-09

### Objetivo

Finalizar pedidos sin persistirlos: mostrar total server-side y derivar la operación al chat del dueño.

### Alcance

- Retiro/delivery con tarifa fija.
- Efectivo: importe exacto y recordatorio en mensaje.
- Transferencia: no mostrar alias ni datos bancarios; pedirlos y enviar comprobante por WhatsApp.
- No solicitar nombre, teléfono o dirección antes de WhatsApp.
- Mensaje incluye líneas, opciones, notas, cantidades, modalidad, promoción y total.
- Teléfono configurable desde tienda; URL `wa.me` correctamente codificada.

### Criterios de aceptación

- Total se recalcula en servidor antes de generar mensaje.
- Local cerrado o carrito inválido no puede generar confirmación.
- Texto editable de WhatsApp nunca se trata como prueba de pago.
- Tests verifican copy, encoding y ARS sin decimales.

---

## BB-11 — Implementar autenticación y protección administrativa

**Prioridad:** P0  
**Área:** Seguridad  
**Tamaño:** L  
**Dependencias:** BB-03, BB-04

### Objetivo

Permitir acceso únicamente a administradores aprovisionados manualmente.

### Alcance

- `/bunker`: email + contraseña, sin registro público.
- `/bunker/admin`: validación server-side de sesión y `admin_memberships`.
- Renovación de cookies con el mecanismo actual recomendado por Supabase/Next.
- Cierre de sesión, purga de caché administrativa y redirecciones seguras.
- Navegación normal más tab Admin durante sesión válida.

### Criterios de aceptación

- Anon y usuario autenticado no miembro son rechazados.
- No se autoriza con `user_metadata` ni comprobaciones solo cliente.
- No hay open redirects ni páginas admin cacheadas offline.
- Tests cubren sesión expirada y acceso cruzado.

---

## BB-12 — Crear administración de catálogo e imágenes

**Prioridad:** P1  
**Área:** Admin  
**Tamaño:** XL  
**Dependencias:** BB-02, BB-05, BB-11

### Objetivo

Permitir al dueño gestionar categorías y los cuatro tipos de producto sin métricas ficticias.

### Alcance

- CRUD y orden de categorías/productos.
- Tabs de Hamburguesas, Sándwiches, Papas y Bebidas.
- Precio, stock, destacado, publicado, descripción, foto y punto focal.
- Asignación de grupos/opciones/defaults aplicables.
- Validación de bebidas sin alcohol.
- Subida con MIME real, tamaño y dimensiones; JPEG/PNG/WebP/AVIF; reemplazo/borrado seguro.

### Criterios de aceptación

- No se puede publicar configuración inválida.
- Upload falso/excesivo/SVG se rechaza server-side.
- Escrituras requieren admin real y dejan mensajes de éxito/error.
- No aparecen pedidos, facturación ni KPIs inventados.

---

## BB-13 — Crear administración de tienda, horarios, pagos y promociones

**Prioridad:** P1  
**Área:** Admin  
**Tamaño:** XL  
**Dependencias:** BB-08, BB-09, BB-11

### Objetivo

Centralizar configuración operativa sin convertir el producto en un sistema de gestión de pedidos.

### Alcance

- Estado/override, horarios y próximo turno.
- Tarifa fija de delivery y teléfono WhatsApp.
- Métodos de pago habilitados.
- Configuración pública visible; jamás mostrar secretos de MP/Supabase.
- CRUD/pausa/orden/calendario de promociones.
- Navegación Admin integrada con Menú/Carrito/Checkout.

### Criterios de aceptación

- Secretos nunca llegan a HTML, logs o respuestas de Admin.
- Habilitar pedidos exige tarifa válida.
- Promociones se previsualizan con precios derivados.
- La misma carta pública sigue accesible en sesión admin.

---

## BB-14 — Integrar Mercado Pago Checkout Pro server-side

**Prioridad:** P1  
**Área:** Pagos  
**Tamaño:** XL  
**Dependencias:** BB-08, BB-09, BB-10

### Objetivo

Agregar MP como opción completamente opcional y segura, activada solo con configuración completa.

### Alcance

- Detectar conjunto completo de variables; ocultar MP si falta una.
- Solicitar únicamente nombre y teléfono para MP; dirección después por WhatsApp.
- Crear quote congelada y preferencia solo en servidor, recalculando catálogo/promoción/delivery.
- Idempotency key, rate limit y referencias opacas.
- Retorno: verificando, aprobado, pendiente, rechazado.
- Disponible para retiro y delivery.

### Criterios de aceptación

- Navegador no envía precios confiables.
- Sin keys no se carga SDK ni aparece la opción.
- Sandbox cubre aprobado, pendiente, rechazado y retorno abandonado.
- El retorno nunca acredita por parámetros del navegador.

---

## BB-15 — Implementar webhook MP, idempotencia y retención

**Prioridad:** P1  
**Área:** Pagos  
**Tamaño:** XL  
**Dependencias:** BB-03, BB-14

### Objetivo

Acreditar pagos únicamente mediante evidencia autoritativa y conservar el mínimo necesario.

### Alcance

- Validar autenticidad del webhook según documentación vigente.
- Deduplicar eventos e implementar procesamiento idempotente.
- Consultar pago a MP y verificar moneda, total y referencia contra snapshot.
- Guardar intento, estado y contacto mínimo por 90 días.
- Después de aprobado, generar WhatsApp con resumen y referencia.
- Documentar flujo de devolución manual total antes de preparación; sin automatizar refund ni prometer plazo.

### Criterios de aceptación

- Webhook repetido no duplica efectos.
- Mismatch de total/moneda/referencia no acredita.
- Un pago sin WhatsApp queda registrado, sin crear tablero operativo.
- Pruebas cubren replay, firma inválida, carrera y purga de 90 días.

---

## BB-16 — Completar PWA, instalación y estrategia de caché

**Prioridad:** P1  
**Área:** PWA  
**Tamaño:** L  
**Dependencias:** BB-02, BB-07, BB-11

### Objetivo

Hacer la carta instalable y útil con conectividad irregular sin cachear datos sensibles.

### Alcance

- Manifest, iconos provisionales, theme color y metadata.
- Aviso discreto solo después de interacción; instrucciones específicas de iOS.
- Serwist: NetworkOnly para Admin/auth/mutaciones/checkout sensible/RSC; NetworkFirst navegación pública/catálogo; SWR imágenes; CacheFirst assets con hash.
- Fallback offline público claro.
- Versionado/actualización segura y purga Admin al cerrar sesión.

### Criterios de aceptación

- Lighthouse/Playwright reconoce PWA instalable.
- No se sirve Admin ni datos de checkout desde cache.
- Actualización no deja shell y assets incompatibles.
- Offline permite ver lo ya cacheado, pero nunca enviar/pagar.

---

## BB-17 — Crear suite E2E, accesibilidad y seguridad adversarial

**Prioridad:** P0  
**Área:** QA  
**Tamaño:** XL  
**Dependencias:** BB-07 a BB-16

### Objetivo

Convertir la matriz de aceptación del plan en pruebas repetibles y evidencia de lanzamiento.

### Alcance

- Playwright en 320, 390, 768 y 1280 px.
- Flujos de los cuatro tipos, personalización, edición y carrito persistente.
- Cerrado, agotado, cambio de precio, delivery, promociones y WhatsApp.
- MP sandbox y webhook repetido.
- Auth/RLS/upload adversarial.
- Teclado, foco, lector de pantalla, contraste y targets 44 px.
- PWA instalable, offline y Admin ausente de caché.

### Criterios de aceptación

- GitHub Actions y el build de Vercel Preview bloquean regresiones críticas antes de fusionar.
- Selectores accesibles, sin depender de estructura CSS frágil.
- Se adjuntan screenshots/traces en fallos.
- Cada caso del plan maestro queda mapeado a test o checklist manual justificado.

---

## BB-18 — Preparar contenido legal, activos y privacidad para producción

**Prioridad:** P0  
**Área:** Lanzamiento  
**Tamaño:** M  
**Dependencias:** BB-07, BB-10, BB-15

### Objetivo

Cerrar los riesgos no técnicos que impiden publicar un trabajo real.

### Alcance

- Sustituir logo/fotos provisionales por archivos originales/autorizados y optimizados.
- Incorporar términos, privacidad y cancelación revisados para Argentina.
- Validar con contador la decisión de no emitir comprobantes desde el sistema.
- Registrar explícitamente que no se muestra información de alérgenos y obtener revisión legal.
- Política de datos: contacto MP mínimo por 90 días, sin marketing ni direcciones permanentes.

### Criterios de aceptación

- Existe aprobación documentada del dueño sobre activos y textos.
- No quedan fotos de Stitch/Instagram no autorizadas en producción.
- Los textos no prometen plazos de devolución ni capacidades inexistentes.
- Privacidad describe exactamente datos, finalidad, plazo y canal de contacto.

---

## BB-19 — Configurar Vercel, Supabase producción y release

**Prioridad:** P0  
**Área:** Lanzamiento  
**Tamaño:** L  
**Dependencias:** BB-01, BB-03, BB-17, BB-18

### Objetivo

Publicar con entornos separados, previews seguras y un proceso de rollback documentado.

### Alcance

- Vincular el repositorio privado temporal `Bunker-Burger/bunker` a Vercel.
- Previews por PR sin secretos/recursos de producción peligrosos.
- Dos proyectos Supabase cloud separados: desarrollo y producción; migraciones reproducibles promovidas primero a desarrollo.
- Variables por entorno, dominios/callbacks/webhook MP y rotación documentada.
- Checklist de backup, migración, smoke test, observabilidad y rollback.
- Crear manual de operación corto para el dueño.
- Al completar todos los gates, transferir el repositorio íntegro nuevamente a `Lautaro073/bunker` y actualizar remotos/integraciones.

### Criterios de aceptación

- Preview y producción compilan desde `npm ci`.
- Ningún secreto está versionado o expuesto al browser.
- Smoke test cubre carta, WhatsApp, login admin y MP cuando esté habilitado.
- Se puede revertir aplicación y migración compatible sin perder datos.
- La transferencia final conserva commits, Issues, PRs y redirecciones, y el remoto local vuelve a apuntar a `Lautaro073/bunker`.

---

## Plantilla de entrega para cada IA

Al cerrar una tarea, el agente debe incluir en el PR:

1. Resumen del comportamiento implementado.
2. Archivos principales y migraciones afectadas.
3. Pruebas nuevas y comandos ejecutados.
4. Capturas para cambios visuales.
5. Riesgos, decisiones y trabajo deliberadamente fuera de alcance.
6. Issue enlazado con `Closes #N`.
