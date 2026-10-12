# Manual de operación de Búnker Burger

Para el dueño o la dueña del local. Lo técnico está en `docs/runbooks/release.md`.

## Entrar al panel

- Entrá a `https://bunker-burger.vercel.app/bunker` con tu mail y contraseña de administrador.
- No compartas la contraseña. Si creés que alguien la sabe, pedí cambiarla.

## Lo de todos los días

| Quiero… | Dónde |
|---|---|
| Cambiar precios, descripción, foto o stock de un producto | Panel → **Catálogo** → el producto |
| Publicar u ocultar un producto | Panel → **Catálogo** → estado publicado / borrador |
| Pausar los pedidos un rato, o abrir y cerrar el local | Panel → **Tienda** → estado del local |
| Cambiar horarios o costo de envío | Panel → **Tienda** |
| Activar o pausar una promoción | Panel → **Promociones** |
| Habilitar o deshabilitar efectivo o transferencia | Panel → **Tienda** → medios de pago |

Los cambios se ven en la carta al rato, sin publicar nada.

## Pedidos

- Los pedidos llegan por **WhatsApp** al número del local. La web arma el mensaje con el total, pero **el pedido recién
  está confirmado cuando vos respondés en el chat**.
- La web no emite facturas: si un cliente la pide, se hace como siempre.
- **Mercado Pago todavía no está habilitado.** Cuando lo esté, vas a ver cada pago aprobado en tu cuenta de Mercado
  Pago y el cliente te escribe por WhatsApp. Las devoluciones se hacen desde Mercado Pago, sin prometer plazos
  (`docs/runbooks/mercado-pago-webhook.md`).

## Fotos

Subí sólo fotos propias o que tengas permiso para usar. No uses fotos de Instagram de otros ni imágenes generadas
para el diseño.

## Datos de clientes

- La web no guarda direcciones ni arma listas de clientes. Cuando Mercado Pago esté habilitado, los nombres y teléfonos
  de esos pagos se borran en una limpieza diaria después de 90 días.
- Si un cliente pide ver o borrar sus datos, respondele por el canal que figura en "Privacidad" y avisá a quien mantiene
  la web.
- No uses los teléfonos de los pedidos para publicidad.

## Si algo no anda

| Pasa esto | Qué hacer |
|---|---|
| La carta dice "No pudimos cargar la carta" | Esperá unos minutos y recargá. Si sigue, avisá a quien mantiene la web |
| La web no abre | Probá desde otro celular o red. Si sigue, avisá. Mientras tanto, tomá pedidos por WhatsApp como siempre |
| Un cliente dice que pagó y no lo ves | Revisá Mercado Pago. Si el pago está aprobado, preparalo; si no, no |
| Te cobraron dos veces o el monto no coincide | No prepares nada todavía y avisá: se devuelve desde Mercado Pago |

## Cambios en la web

Quien mantiene la web publica los cambios técnicos solo: cuando se aprueba un cambio, sale a la web automáticamente y se
prueba que la carta, WhatsApp y el login funcionen. Si algo sale mal, se vuelve a la versión anterior en minutos.
