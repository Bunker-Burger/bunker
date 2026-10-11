# Mercado Pago: webhook, acreditación, devoluciones y retención (BB-15)

> **Estado:** el código sigue la documentación vigente de Mercado Pago (Webhooks › validar origen de la
> notificación), pero **todavía no se probó contra una notificación real**: no hay credenciales ni panel de prueba
> (issue #38). Nada de esto habilita cobros reales; Mercado Pago sigue oculto en producción hasta cerrar #38.

## 1. Cómo se acredita un pago

Un pago se acredita **sólo** con lo que devuelve la API de Mercado Pago (`GET /v1/payments/{id}`), nunca con lo que
dice el navegador ni el cuerpo de la notificación. Hay dos caminos, con la misma regla atómica en la base
(`public.apply_mercado_pago_payment`):

- **Webhook** `POST /api/payments/mercado-pago/webhook`: Mercado Pago avisa que un pago cambió.
  1. Verifica la firma `x-signature` (HMAC-SHA256 del manifest `id:[data.id];request-id:[x-request-id];ts:[ts];`).
  2. Reclama el evento (`public.claim_payment_webhook_event`): una entrega a la vez; uno completado no se repite.
  3. Lee el pago en la API y lo aplica.
- **Regreso del cliente** (`/api/checkout/mercado-pago/status`): busca el pago por referencia y aplica el aprobado.

La función de la base bloquea la fila del intento y:
- no acredita si la moneda no es ARS o el importe difiere del intento **o** de la cotización congelada;
- nunca vuelve atrás un intento aprobado (un `rejected` o `pending` atrasado no cambia nada);
- si llega **otro** pago aprobado para la misma referencia, no lo registra: lo informa (`conflicting_payment`);
- un reembolso o contracargo del pago aprobado deja el intento `refunded`.

Un pago aprobado queda registrado con nombre y teléfono aunque el cliente nunca vuelva ni mande el WhatsApp. No hay
tablero operativo: el registro está en `payment_attempts` (lectura para admins del local por RLS).

## 2. Configuración (cuando haya credenciales)

1. En el panel de la aplicación de Mercado Pago → **Webhooks**:
   - URL de producción: `https://<dominio>/api/payments/mercado-pago/webhook`;
   - evento: **Pagos**;
   - copiar la **clave secreta**.
2. En Vercel (sólo server, nunca `NEXT_PUBLIC_`): `MERCADO_PAGO_WEBHOOK_SECRET`, junto con `MERCADO_PAGO_ACCESS_TOKEN`,
   `APP_URL` (https) y `SUPABASE_SERVICE_ROLE_KEY`. **Sin el secreto, Mercado Pago no se ofrece.**
3. Con `APP_URL` https, cada preferencia manda además `notification_url` a esa misma ruta.
4. Probar desde el panel ("Simular notificación") y con el sandbox (#38): aprobado, pendiente, rechazado, abandonado.
   Una notificación simulada de un pago que no existe queda como `payment_not_found` y no acredita nada.

## 3. Respuestas del webhook

| Situación | HTTP | ¿Mercado Pago reintenta? |
|---|---|---|
| Procesado, duplicado, tema que no es pago, IPN legado | 200 | No |
| Pago que no se puede acreditar (importe, moneda, referencia, otro pago aprobado, inexistente) | 200 | No: reintentar no cambia nada; queda registrado en el evento |
| Firma inválida | 401 | Sí, y vuelve a fallar |
| Pedido mal formado | 400 | Sí, y vuelve a fallar |
| Mercado Pago o la base no respondieron | 500 | Sí (cada 15 min y luego más espaciado) |
| Falta configuración (token, secreto, service role) | 503 | Sí |

Los logs (`scope: "mercado-pago-webhook"`) llevan ids y resultado; nunca contacto ni secretos.

## 4. Revisar eventos no acreditados

```sql
select event_id, provider_payment_id, last_error_code, delivery_count, received_at
from public.payment_webhook_events
where processing_status = 'failed'
order by received_at desc;
```

| `last_error_code` | Qué significa | Qué hacer |
|---|---|---|
| `amount_mismatch` / `currency_mismatch` | El pago no coincide con la cotización | No preparar. Contactar al cliente y devolver (§5) |
| `conflicting_payment` | Segundo pago aprobado para el mismo pedido | Preparar una vez. Devolver el pago duplicado (§5) |
| `unknown_reference` | Pago ajeno a este checkout | Revisar en el panel; no es un pedido de la carta |
| `payment_not_found` | Mercado Pago no conoce el pago (p. ej. simulación) | Nada |
| `provider_unavailable` / `storage_unavailable` | Falla transitoria | Se reintenta sola; si persiste, revisar token o base |

## 5. Devolución manual total (antes de preparar)

No hay reembolso automático y **no se promete plazo**: los tiempos de acreditación de la devolución los define
Mercado Pago y el medio de pago.

1. **Sólo antes de empezar a preparar.** Si ya se preparó, se resuelve con el cliente por WhatsApp.
2. Encontrar el pago: en `payment_attempts`, `external_reference` y `provider_payment_id`. El contacto está en
   `customer_name` / `customer_phone`.
3. En el panel de Mercado Pago → Actividad → el pago → **Devolver** → devolución **total**.
4. Avisar al cliente por WhatsApp que se inició la devolución, con la referencia del pago, sin dar plazos.
5. Mercado Pago notifica el reembolso; el webhook deja el intento `refunded`. Si no llega, el estado del pago en el
   panel es la fuente de verdad.

## 6. Retención (90 días)

- `private.purge_expired_payment_data()` borra cotizaciones, intentos (con nombre y teléfono) y eventos de webhook de
  más de 90 días.
- Corre todos los días a las 06:15 UTC (03:15 en Argentina) con Supabase Cron (`pg_cron`), job
  `bb15-purge-expired-payment-data`.
- Verificar que existe: `select jobname, schedule, command from cron.job;`. Últimas corridas:
  `select status, start_time from cron.job_run_details order by start_time desc limit 5;`.
