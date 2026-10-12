# BB-17 — Checklist manual y evidencia externa

Cada ejecución debe registrar fecha, SHA completo, responsable, resultado y enlaces o capturas. Un resultado sin SHA no acredita una PR posterior.

## Fidelidad visual

1. Construir el SHA y abrir `/` en 320, 390, 768 y 1280 px.
2. Comparar menú, drawer, carrito y checkout con las capturas canónicas de `docs/desing/`.
3. Confirmar jerarquía, espaciado, recortes de imagen, estados de foco y ausencia de contenido superpuesto.
4. Adjuntar una captura por viewport y anotar diferencias aceptadas por el dueño.

## Tecnología asistiva

1. En Windows usar NVDA + Chromium; en iOS usar VoiceOver + Safari cuando haya un dispositivo disponible.
2. Recorrer menú, producto agotado, drawer, carrito y checkout sólo con teclado/gestos del lector.
3. Confirmar anuncio de título, precio, controles, selección, stock, errores y actualización del carrito en orden comprensible.
4. Registrar lector, versión, navegador, plataforma y cualquier excepción; axe no reemplaza esta pasada.

## Mercado Pago sandbox

Precondiciones: Preview del SHA, aplicación sandbox, comprador de prueba y webhook sandbox configurado al Preview.

1. Completar un pago aprobado y comprobar que el estado llega por evidencia server-to-server.
2. Generar un pago pendiente y uno rechazado; comprobar que ninguno acredita una orden.
3. Abandonar Checkout Pro antes de volver y comprobar la reconciliación server-to-server.
4. Reenviar la misma notificación y confirmar un solo efecto.
5. Adjuntar IDs sandbox redactados, timestamps, estados observados y logs sin datos personales ni secretos.

## Límites de alcance

1. Revisar menú, checkout y Admin buscando barrios, radios, mapas, zonas, cupos, contador de promociones, pedidos, facturación o KPIs.
2. El resultado esperado es ausencia total de esas capacidades y de textos que las prometan.
3. Registrar las rutas revisadas y una captura de cada superficie principal.

## Vercel Preview y branch protection

1. En la PR del SHA confirmar un deployment Vercel Preview exitoso del mismo commit.
2. Abrir el Preview y ejecutar smoke de menú, drawer, carrito, checkout y fallback offline.
3. En GitHub confirmar como requeridos los checks `app`, `e2e` y el deployment de Vercel antes de permitir merge.
4. Verificar que un check fallido impide fusionar; registrar captura de la regla y enlaces a checks/deployment.

## Artefactos de fallo

1. En una rama de prueba introducir temporalmente una aserción Playwright que falle después de cargar `/`.
2. Ejecutar el job `e2e` y confirmar que falla sin reintentos que oculten el resultado.
3. Descargar el artifact y comprobar `playwright-report/`, screenshot y `trace.zip` dentro de `test-results/`.
4. Eliminar la falla temporal; enlazar ambos runs y registrar el SHA de la PR real que conserva la configuración.

## Evidencia cloud protegida

1. Aplicar el protocolo de `docs/runbooks/cloud-evidence.md` al SHA exacto.
2. Para pgTAP/Auth ejecutar sólo los workflows protegidos que correspondan al alcance y verificar los statuses con `scripts/ci/verify-cloud-statuses.mjs`.
3. Si falta infraestructura o credenciales, registrar el bloqueo y la decisión explícita del mantenedor; nunca reemplazarlo por un status manual o de otro SHA.
4. Adjuntar el comentario de evidencia y las URLs de los runs sin copiar secretos ni datos personales.
