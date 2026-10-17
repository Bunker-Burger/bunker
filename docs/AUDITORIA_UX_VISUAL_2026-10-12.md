# Auditoría UX, interfaz y contenido — Búnker Burger

**Fecha:** 2026-10-12  
**Alcance:** auditoría únicamente; no se modificó código, datos, configuración ni la sesión del usuario.  
**Estado del Consejo:** **CONDICIONAL**. La base visual es reconocible, pero hay problemas de confianza, claridad comercial y composición responsive que impiden aprobar la experiencia completa.

## Objetivo

Revisar la experiencia pública y administrativa con prioridad móvil, seguida de tablet y escritorio. El foco fue:

- flujo de compra, personalización, carrito, checkout y administración;
- fidelidad respecto de las capturas de `docs/desing/stitch_burger_online_ordering_system/`;
- claridad del copy para una persona común, evitando lenguaje técnico, de prueba o que parezca generado;
- navegación, jerarquía, accesibilidad visible y estados de error.

## Limitación de evidencia

La pestaña incorporada del usuario estaba abierta en `http://localhost:3154/#menu` y con sesión iniciada. Se intentó adjuntar el control del navegador incorporado dos veces, pero el conector falló antes de exponer la pestaña (`failed to write kernel assets`).

Por lo tanto, esta auditoría **no afirma haber operado esa sesión concreta**. La evidencia funcional se recogió contra la misma URL local desde contextos aislados de auditoría y mediante revisiones independientes. Posteriormente se validó el acceso con una sesión local nueva a `/bunker/admin`, sin guardar cambios. Todo hallazgo marcado como **“pendiente de reproducción en la sesión incorporada”** debe comprobarse allí antes de abrir un bug funcional.

## Cobertura realizada

| Superficie | Móvil 390 px | Tablet / escritorio | Resultado |
| --- | --- | --- | --- |
| Carta, promos, categorías y productos | Sí | Sí | Revisada |
| Personalizador, extras y cantidad | Sí | Sí | Revisado |
| Carrito y checkout | Sí | Sí | Revisado sin enviar pedido ni pago |
| Administración autenticada | Sí | Sí | Revisada sin guardar cambios |
| Páginas legales y offline | Sí | — | Revisadas |
| Lectura de microcopy | Sí | Sí | Revisada |

## Lo que funciona bien

- La identidad base —fondos oscuros, ámbar, titulares condensados y CTAs en píldora— conserva buena parte del lenguaje Streetcraft.
- En 390 px no se observó scroll horizontal del documento en las superficies revisadas.
- El detalle de producto mantiene opciones, extras, cantidad y resumen en una secuencia entendible.
- Las acciones agotadas están diferenciadas visual y semánticamente de las acciones disponibles.
- El checkout conserva sus estados de local cerrado y evita enviar/pagar cuando no corresponde.

## Hallazgos priorizados

### P1 — La campaña “Martes de Smash” aparece activa fuera del martes

**Superficie:** carta, promoción y checkout.  
**Evidencia:** el 2026-10-12 (lunes) la carta mostraba “MARTES DE SMASH · 15% OFF” y aplicaba el precio promocional. La revisión independiente del administrador encontró una regla sin días marcados, cuyo comportamiento es aplicarse durante todo el período.

**Impacto:** una persona puede entender que la oferta es válida sólo los martes y recibir el descuento otro día; es una inconsistencia comercial que erosiona confianza.

**Mejora propuesta:** configurar la regla exclusivamente para martes, o cambiar el nombre y el mensaje de campaña. El editor debe advertir de manera explícita cuando el nombre menciona un día de la semana pero la vigencia no está limitada a ese día.

**Prueba de aceptación:** un lunes no se muestra ni aplica la promoción; un martes se muestra el mismo precio en tarjeta, detalle, carrito y checkout.

### P1 — Datos legales visibles aún tienen placeholders y texto no apto para publicación

**Rutas:** `/legal/terminos`, `/legal/privacidad`, `/legal/cancelaciones`.

**Evidencia:** las tres páginas muestran “Texto en revisión: todavía no fue aprobado por el titular ni revisado por un profesional”; cancelaciones además expone “Titular/CUIT/Domicilio: pendiente de carga por el titular” y privacidad muestra un teléfono de ejemplo.

**Impacto:** no es copy de cara a cliente ni información legal/publicable. Hace ver al sitio incompleto y puede impedir el lanzamiento.

**Mejora propuesta:** completar datos reales y publicar sólo la versión aprobada; mientras no exista, ocultar los enlaces de cara a clientes o mostrar una ruta de soporte real en lugar de placeholders.

**Prueba de aceptación:** ninguna ruta legal contiene “pendiente”, datos de ejemplo, ni avisos internos de aprobación.

### Verificación descartada — No se reprodujo una duplicación al confirmar una personalización

Una primera pasada informó que un Smash personalizado se duplicaba. La réplica dirigida, con un perfil nuevo y carrito inicialmente vacío, siguió la ruta `/#menu → ?producto=smash-bunker-doble#menu → #carrito`, eligió Triple + bacon y pulsó una vez “Agregar 1 al carrito $10.300”. El resultado fue **1 ítem**, cantidad **1** y subtotal **$10.300**.

No se registra como bug confirmado. Conviene conservar una prueba E2E de este flujo para prevenir regresiones, pero no priorizar una corrección sin nueva evidencia en la sesión real.

### P2 — Precio promocional y descuento se comunican de forma inconsistente

**Flujo:** tarjeta → detalle/personalizador → carrito → checkout.

**Evidencia:** la tarjeta de Smash muestra $6.630 (antes $7.800), mientras el detalle vuelve a $7.800. Con extras, el carrito refleja $10.300 y recién en checkout aparece el descuento. La regla de “una sola promo, no acumulable” está explicada en Administración, no en la compra.

**Impacto:** el cliente no sabe si el precio mostrado se conservará, si los extras participan del descuento ni por qué cambia el total.

**Mejora propuesta:** explicar junto al precio promocional qué incluye (“aplica al producto base; extras no participan”), mostrar el ahorro durante la personalización y aclarar en checkout qué promoción se aplicó y cuál se descartó.

**Prueba de aceptación:** el desglose mostrado en tarjeta, detalle, carrito y checkout permite anticipar el total sin sorpresas.

### P2 — Delivery puede reemplazar una oferta más conveniente sin explicarlo

**Flujo:** comparar retiro y delivery con una hamburguesa personalizada.

**Evidencia de revisión independiente:** retiro aplicó “Martes de Smash” y totalizó $8.755; delivery aplicó “Envío gratis” y totalizó $10.300. No hay comparación ni elección explícita de la promoción; el cliente pierde el beneficio neto más alto sin entender por qué.

**Impacto:** decisión opaca que afecta el precio final y puede generar abandono o reclamos.

**Mejora propuesta:** mostrar el impacto total de cada alternativa antes de confirmar, o aplicar automáticamente la opción de mayor beneficio e indicarlo con copy claro.

**Prueba de aceptación:** al cambiar entrega se informa qué promoción queda vigente, cuál no se acumula y cómo varía el total.

### P2 — Tablet y escritorio desperdician gran parte del espacio disponible

**Superficie:** carta pública en 768, 1280 y 1440 px.

**Evidencia:** la carta conserva tarjetas estrechas alineadas a la izquierda, con grandes áreas vacías a la derecha. En escritorio, una destacada ocupa alrededor de 325 px y la navegación flotante queda separada del contenido. La referencia define una progresión 4 → 8 → 12 columnas y tarjetas horizontales/adaptadas a pantallas amplias.

**Impacto:** se percibe como una interfaz móvil estirada, baja la densidad útil y no sigue la composición de las capturas.

**Mejora propuesta:** usar grilla de 2 columnas desde tablet y 3–4 desde escritorio, o hacer que una única destacada ocupe un span intencional. Ajustar el contenedor y la relación imagen/contenido por breakpoint.

**Prueba de aceptación:** en 768 y 1280 px no quedan vacíos arbitrarios; cada sección tiene una distribución que aprovecha el ancho y conserva jerarquía.

### P2 — Las imágenes de producto no son consistentes con la identidad gastronómica

**Superficie:** carta, detalle y Administración.

**Evidencia:** Smash usa una ilustración/escena multicolor; Oklahoma y otros productos usan afiches, memes o fotografías con tratamientos distintos. Las capturas canónicas usan fotografía gastronómica oscura, centrada y consistente. En el detalle, la hamburguesa aparece recortada debajo de una imagen que no corresponde al producto.

**Impacto:** baja el deseo de compra y hace que el catálogo se perciba como contenido de prueba o collage, no como una carta de hamburguesería.

**Mejora propuesta:** definir un set de assets gastronómicos autorizado con encuadre y tratamiento únicos (16:9 o cuadrado; fondo oscuro/vineta), reservando los artes gráficos para banners promocionales.

**Prueba de aceptación:** cada producto tiene una imagen reconocible del producto y todas siguen el mismo encuadre/tratamiento.

### P2 — El flotante de carrito compite con el CTA de agregar en móvil

**Superficie:** 390 px con carrito activo.

**Evidencia de revisión independiente:** el flotante “Ver pedido” se superpone parcialmente al CTA “Agregar” de una tarjeta al navegar la carta.

**Impacto:** dos acciones de compra compiten por el mismo espacio y puede haber toques erróneos.

**Mejora propuesta:** reservar espacio inferior dinámico para la grilla mientras exista el flotante, o convertirlo en una bandeja con posición que no cubra CTAs.

**Prueba de aceptación:** ningún botón de producto, del drawer o checkout queda debajo del flotante en 320 y 390 px.

### P2 — Retiro en local no ayuda a tomar la decisión

**Superficie:** checkout.

**Evidencia:** “Retiro en local” comunica costo $0, pero no se encontró dirección, mapa/enlace ni referencia inequívoca del local en carta o checkout.

**Impacto:** una persona nueva no sabe dónde debe retirar antes de avanzar.

**Mejora propuesta:** agregar dirección, enlace a mapa y horario al seleccionar retiro; mantenerlo compacto y visible antes de confirmar.

**Prueba de aceptación:** quien elige retiro puede identificar dónde y cuándo retirar sin salir de la experiencia.

### P2 — La cabecera de Administración móvil es demasiado densa antes de llegar a la tarea principal

**Superficie:** Administración móvil, alta/edición de producto y promoción.

**Evidencia confirmada en la sesión autenticada de contraste:** antes de “Gestión de precios & stock” se apilan resumen de disponibles, promos vigentes, estado del local, selector de modo, búsqueda, dos acciones y cinco filtros. En móvil, ese conjunto posterga la tarea de precio/stock y usa texto secundario muy pequeño.

**Impacto:** se diluye el foco inicial de la operación diaria: cambiar stock y precio.

**Mejora propuesta:** dejar en la cabecera sólo estado y una acción prioritaria; volver búsqueda/filtros secundarios o sticky tras el título. Cualquier ayuda técnica de formularios debe mostrarse bajo demanda y con lenguaje de negocio.

**Prueba de aceptación:** desde que abre Admin, la primera tarea se identifica sin scroll y filtros/búsqueda no compiten con el estado operativo.

### P3 — Banner promocional recargado y poco legible

**Superficie:** inicio de la carta móvil.

**Evidencia:** “Martes de Smash” se superpone a un arte con “NINO / oferta imperdible”, varios colores y repetición del 15%. No enumera claramente qué productos participan.

**Impacto:** se lee como un afiche pegado, no como información de una oferta; reduce comprensión rápida.

**Mejora propuesta:** un único titular, una sola cifra de descuento y una línea concreta de alcance; conservar el arte como contexto sin competir con el mensaje.

**Prueba de aceptación:** se entiende en menos de tres segundos qué beneficio aplica, a qué productos y hasta cuándo.

### Verificación descartada — Mensaje contradictorio de delivery no reproducido

**Superficie:** acordeón “Delivery y WhatsApp”.

En la sesión local autenticada de contraste se mostró “Envío $ 1.200 · +5491100000000” junto con “Efectivo y Transferencia habilitados”; no apareció el mensaje “Sin costo de delivery cargado”. No se registra como bug confirmado sin nueva reproducción.

## Hallazgo informado por el usuario: toast persistente

El usuario reportó que, al agregar un producto, el mensaje ubicado arriba y centrado sobre el nav no desaparece.

En dos contextos nuevos de auditoría, el aviso apareció una vez y ya no estaba presente a los 4–4,8 segundos. No se reproduce como bug confirmado en esas sesiones. Esto **no invalida** el reporte: no fue posible observar la pestaña incorporada ni su estado previo. Puede depender de la secuencia de personalización, restauración de carrito, navegación o de una versión distinta del runtime.

**Acción de auditoría recomendada:** antes de corregir, registrar la reproducción en la pestaña incorporada con video/captura, indicando producto, método de agregado, tiempo transcurrido y si hay otro aviso activo. Si se confirma, el mensaje deberá ser temporal, descartable y no superponerse con header/nav; tampoco debe acumular avisos al añadir productos repetidamente.

## Decisiones de producto que requieren confirmación humana

Estas opciones no deben resolverse sólo desde implementación:

1. ¿La campaña “Martes de Smash” debe quedar limitada a martes o renombrarse como oferta permanente?
2. Cuando delivery y descuento de producto compiten, ¿se aplica siempre la alternativa de mayor beneficio o se deja elegir?
3. ¿Qué fuente/aprobación tendrá el set definitivo de fotografías gastronómicas?
4. ¿Se publican las rutas legales antes de contar con los datos y revisión profesional definitivos?

## Plan de verificación posterior a los cambios

1. Repetir flujo completo en la **pestaña incorporada con la sesión real**: búsqueda → personalización → agregar → carrito → checkout → admin.
2. Capturar móvil 320/390, tablet 768 y escritorio 1280/1440; comparar con las capturas canónicas.
3. Verificar precio y promoción antes y después de cambiar retiro/delivery.
4. Probar agregado directo y desde drawer con carrito vacío; confirmar que añade exactamente una línea (control preventivo; no es bug confirmado).
5. Medir el aviso de agregado: aparece una vez, no cubre la navegación y desaparece de forma previsible.
6. Revisar todo copy visible con una persona del local: sin “fixture”, “motor”, placeholders ni explicaciones internas.
