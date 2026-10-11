# BB-18: textos legales, activos y privacidad para producción

Estado: **pendiente de aprobación**. Este documento registra lo que hace el código, lo que falta decidir y quién
lo decide. Ninguna fila de aprobación se marca sin una aprobación escrita del responsable (mensaje, mail o comentario
en el issue #18, con fecha). El código no puede aprobar nada.

## 1. Qué quedó implementado

| Tema | Dónde | Comportamiento |
|---|---|---|
| Términos | `/legal/terminos` | Qué hace la web, precios y total, confirmación por WhatsApp, entrega sin plazos, medios de pago, sin comprobantes fiscales, alérgenos |
| Privacidad | `/legal/privacidad` | Datos, finalidad, destinatarios, plazo (90 días) y canal de contacto (WhatsApp del local, leído de la base) |
| Cancelaciones | `/legal/cancelaciones` | Devolución total desde Mercado Pago, **sin plazo prometido** (igual que el runbook `mercado-pago-webhook.md` §5) |
| Aviso de revisión | `src/content/legal.ts` (`LEGAL_REVIEW`) | Mientras `approved` sea `false`, las tres páginas muestran "Texto en revisión" |
| Titular | `src/content/legal.ts` (`LEGAL_OWNER`) | Razón social, CUIT y domicilio se muestran como "pendiente de carga por el titular" hasta que el dueño los dé |
| Alérgenos | Pie de la carta y términos | "La carta no informa alérgenos. Si tenés alguna alergia o intolerancia, consultá al local por WhatsApp antes de pedir." |
| Pie legal | Carta (`/`) | Enlaces a los tres textos |
| Checkout MP | Formulario de nombre y teléfono | "Se borran a los 90 días" y enlace a Privacidad |
| Menú demo | `allowsDemoCatalog` | El menú de ejemplo sólo aparece sin Supabase y fuera de Vercel (local y CI). En un despliegue, si la carta no se puede leer, se muestra "No pudimos cargar la carta", nunca productos inventados |
| Fotos de Stitch | `src/data/catalog.ts`, `next.config.ts` | El menú demo ya no tiene fotos; se quitaron `lh3.googleusercontent.com` (mock-ups de Stitch) y `images.unsplash.com` de los orígenes de imagen permitidos |

Los tests (`src/app/legal/legal-pages.test.tsx`) comprueban que:
- el plazo que dice Privacidad es el que aplica `private.purge_expired_payment_data`;
- ningún texto promete plazos (salvo la retención de 90 días);
- privacidad nombra datos, finalidad, destinatarios, plazo y contacto.

## 2. Aprobaciones pendientes

| # | Qué | Responsable | Estado |
|---|---|---|---|
| A1 | Textos de términos, privacidad y cancelaciones | Dueño | Pendiente |
| A2 | Revisión legal de los tres textos para Argentina (preguntas en §4) | Abogado/a | Pendiente |
| A3 | Decisión de no emitir comprobantes desde el sistema (§3) | Contador/a | Pendiente |
| A4 | Aviso de que no se informan alérgenos | Abogado/a | Pendiente |
| A5 | Logo e íconos definitivos (§5) | Dueño | Pendiente |
| A6 | Fotos de productos cargadas en el admin: originales o autorizadas (§5) | Dueño | Pendiente |
| A7 | Datos del titular: razón social, CUIT, domicilio | Dueño | Pendiente |
| A8 | Lo que los textos dicen del local: cómo cancela, que no usa el número para publicidad, cuánto conserva los chats de WhatsApp | Dueño | Pendiente |

Al aprobar: cargar `LEGAL_OWNER`, poner `LEGAL_REVIEW.approved = true` y actualizar `LEGAL_TEXTS_UPDATED_AT` en
`src/content/legal.ts`, en un PR que enlace la aprobación.

## 3. Comprobantes (para el contador)

La web no emite facturas ni comprobantes fiscales. El mensaje de WhatsApp dice "este mensaje no es comprobante de
pago" y los términos indican que la factura se pide al local por WhatsApp. Pregunta: ¿alcanza con que el local
facture por fuera del sistema (controlador fiscal, facturador de ARCA) cada venta, incluidas las de Mercado Pago?

## 4. Preguntas para la revisión legal

1. **Botón de arrepentimiento** (Res. SCI 424/2020) y revocación (art. 34, Ley 24.240; art. 1110 y 1116 CCyC): si
   aplica a comida preparada para consumo inmediato o entra en la excepción de bienes que se deterioran con rapidez.
   Hoy la web no tiene ese botón.
2. **Identificación del proveedor** en ventas a distancia (Res. 104/2005): qué datos deben verse y dónde.
3. **Alérgenos**: si alcanza con el aviso "la carta no informa alérgenos" o hay obligación de informarlos en la
   jurisdicción del local.
4. **Transferencia internacional**: Supabase y Vercel pueden alojar datos fuera de Argentina; si hace falta
   consentimiento o cláusulas específicas (art. 12, Ley 25.326).
5. **Registro de bases de datos** ante la AAIP: si corresponde inscribir la base de contactos de Mercado Pago.
6. **Enlace a Defensa del Consumidor** u otros avisos obligatorios de la provincia o el municipio del local.

## 5. Activos

| Activo | Origen | Estado |
|---|---|---|
| Marca en el encabezado ("BB" + "BÚNKER BURGER") | Texto con CSS, sin imagen | Sustituir por el logo cuando exista (A5) |
| `public/icons/*.png` | Generados por `scripts/generate-pwa-icons.mjs` (dibujo geométrico propio, provisional) | Sin derechos de terceros; reemplazar por el logo (A5) |
| Fotos del menú demo | Mock-ups de Stitch (`lh3.googleusercontent.com/aida-public`) | **Quitadas** |
| Diseños de `docs/desing/stitch_*` | Referencia de diseño | No se sirven en la web (fuera de `public/`) |
| Fotos de productos | Las sube el dueño desde el admin al bucket `catalog` | Revisar una por una (A6) |

Las fotos cargadas en el admin no se pueden revisar desde el repo. Para listarlas, el mantenedor puede correr esta
consulta de sólo lectura en el SQL editor del proyecto (no modifica nada):

```sql
select p.name, pi.storage_path, pi.alt_text, pi.created_at
from public.product_images pi
join public.products p on p.id = pi.product_id
order by p.name;
```

Toda foto que venga de Instagram, de Stitch o de terceros sin autorización escrita se reemplaza antes del lanzamiento.

## 6. Política de datos

- Mercado Pago: nombre, teléfono, detalle y estado del pago; se borran a los 90 días con la cotización y los eventos
  del webhook (`private.purge_expired_payment_data`).
- Sin marketing, sin cuentas de clientes, sin direcciones guardadas: la dirección sólo viaja en el chat de WhatsApp.
- En el navegador: carrito y la marca de "invitación a instalar descartada". Sin cookies de seguimiento ni analítica.

**Requisito para que "se borran a los 90 días" sea cierto en producción:** la purga diaria la programa con `pg_cron`
la migración de BB-15 (`20261011180000_bb15_mercado_pago_webhook.sql`), que todavía no está aplicada en el proyecto
cloud. Hasta que se aplique y se verifique el job, no hay borrado automático. Mercado Pago sigue sin habilitar (#38),
así que hoy no se guardan esos datos.

Si un flujo empieza a guardar un dato nuevo (campo, tabla, cookie, analítica), la página de privacidad cambia en el
mismo PR.
