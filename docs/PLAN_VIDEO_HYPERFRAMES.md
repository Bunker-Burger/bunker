# Plan de Video Promocional — Búnker Burger (HyperFrames × Impeccable Design)

- **Proyecto:** `bunker-burger` (Aguilares, Tucumán)
- **Formatos:** 
  - Vertical 9:16 (1080×1920) — Instagram Reels, TikTok, Estados de WhatsApp.
  - Horizontal 16:9 (1920×1080) — Carta Web, Pantallas del local, Sizzle reel.
- **Duración final:** 40.00 s (ritmo dinámico, 1:1 sincronizado con la interacción).
- **Framework de render:** HyperFrames (composición HTML/CSS/GSAP determinista y acelerada por hardware).

---

## 1. Directivas de Diseño Impecable (Erradicación de Clichés de IA)

Siguiendo la especificación de **Impeccable Design** y la identidad **Streetcraft** del Búnker, se prohíben taxativamente los siguientes antipatrones generados por IA:

1. **PROHIBIDO el glassmorfismo decorativo:** Cero `backdrop-filter: blur()`. Se utilizan superficies sólidas de carbón mate industrial (`#090909`, `#121212`, `#1c1b1b`).
2. **PROHIBIDO el sobre-redondeo y las ghost cards:** Cero `border-radius: 32px` y sombras difusas exageradas. Radios arquitectónicos sobrios (4px a 12px) y bordes definidos con acento ámbar (`#f59e0b`).
3. **PROHIBIDO el scaffolding de emojis:** Cero íconos `🔥`, `🍔`, `🥓`, `⚡`, `🛵` en cajitas redondeadas. La jerarquía la define la tipografía: **Oswald 700** para titulares de impacto y **Space Grotesk** para especificaciones funcionales.
4. **PROHIBIDO el contenido simulado o tarjetas sin producto:** No se usan tarjetas de texto que expliquen una hamburguesa con estrellas ficticias (`★★★★★`). La estrella es el producto real: grabación en vivo a 60/30 fps de la interfaz real de la aplicación Next.js.
5. **PROHIBIDO el mockup genérico flotante:** Nada de teléfonos flotando en la nada con Dynamic Islands falsas. El teléfono está integrado con un marco industrial limpio o disposición editorial en pantalla dividida (*split-screen*).

---

## 2. Storyboard y Sincronización Cuadro a Cuadro (40.00 s)

| Escena | Rango de Tiempo | Narrativa / Titular (Oswald 700 + Space Grotesk) | Acción Grabada en Pantalla (1:1 Sincronizada) | Audio & SFX Canónicos |
| :--- | :--- | :--- | :--- | :--- |
| **1. El Gancho** | `0.0s – 5.0s` (5.0s) | **PEDÍ TU SMASH EN 30 SEGUNDOS**<br>*Basta de esperar que te respondan el WhatsApp o leer fotos borrosas.* | Frame 0.0s ya renderizado y limpio. Portada oficial de Búnker Burger y burger estrella "Smash Búnker Doble" en primer plano. | `impact-bass-1.mp3` a los 0.15s al caer el dispositivo móvil. Acordes cálidos Rhodes Dm9 de entrada. |
| **2. La Carta en Vivo** | `5.0s – 11.0s` (6.0s) | **FOTOS REALES Y PRECIOS AL INSTANTE**<br>*Toda la carta en tu celu: burgers smash, papas y bebidas con stock real.* | Scroll continuo y suave por la carta, recorriendo smash burgers, papas y bebidas con precios transparentes. | `whoosh-short.mp3` a los 5.00s al iniciar el scroll. Entra la batería boom-bap (92 BPM con swing de 16vos). |
| **3. El Personalizador** | `11.0s – 19.5s` (8.5s) | **DOBLE CARNE, CHEDDAR Y BACON CROCANTE**<br>*Elegí los medallones smash, sumá tus adicionales y ves el total al toque.* | A los 11.2s click en "Smash Búnker Doble" -> abre el drawer -> a los 13.5s se elige "Triple Medallón", a los 15.5s "Extra Bacon", el precio sube en vivo y a los 18.0s se toca "Agregar al pedido". Cierre a los 19.5s. | `click.mp3` a los 11.2s, `whoosh-short.mp3` al subir el drawer, `click-soft.mp3` a los 13.5s y 15.5s, `pop.mp3` a los 18.0s. Push de cámara sutil (scale 1.025). |
| **4. El Carrito & Toast** | `19.5s – 27.5s` (8.0s) | **VES EXACTAMENTE LO QUE PAGÁS**<br>*Revisás tu pedido al toque: desglose claro sin letra chica ni recargos sorpresa.* | A los 19.8s aparece el Store Toast confirmando el agregado. Se abre el drawer de Carrito mostrando burger triple + bacon con subtotal exacto de $10.300. | `notification.mp3` a los 19.8s con el toast. `whoosh-short.mp3` a los 21.2s al entrar al drawer de pedido. |
| **5. Checkout & Entrega** | `27.5s – 34.0s` (6.5s) | **ENVÍO A TU CASA O RETIRO EN LOCAL**<br>*Elegís la entrega y pagás cómodo con Mercado Pago, transferencia o efectivo.* | A los 27.8s click en Checkout -> selecciona Retiro en local ($0, San Lorenzo 877 Aguilares) -> datos de contacto -> formas de pago (Transferencia/Efectivo) con descuento Martes de Smash. | `whoosh-short.mp3` a los 27.5s. Redoble progresivo de redoblante y filtro crescendo hacia el remate. |
| **6. Cierre / Outro Póster** | `34.0s – 40.0s` (6.0s) | **LA MEJOR SMASH DE AGUILARES**<br>*Hacete el favor esta noche: entrá a la carta online y pedí directo a la cocina.*<br>**[TOCÁ EL LINK Y PEDÍ AHORA ➔]** | Transición a póster completo con isotipo oficial Búnker Burger, botón de acción con pulso cinemático y ubicación "Aguilares • Tucumán". | `impact-bass-2.mp3` a los 34.00s (slam de cierre). `sparkle.mp3` a los 34.65s con el pulso del CTA. Fade out suave en 39.2s - 40.0s. |

---

## 3. Especificaciones Técnicas y Tokens de Marca

- **Paleta Streetcraft:**
  - Fondo Base: `#090909` (carbón profundo).
  - Superficie Componentes: `#121212` / `#161616`.
  - Acento Ámbar Plancha: `#f59e0b` (fuego y cheddar).
  - Texto Principal: `#ffffff` (máximo contraste WCAG AAA).
  - Texto Secundario: `#d4d4d4` (legibilidad garantizada sin tonos lavados).
  - Bordes Estructurales: `1px solid #242424` a `2px solid #f59e0b`.
- **Tipografía:**
  - Titulares / Display: *Oswald* (pesos 600 y 700, mayúsculas, tracking -0.01em a +0.02em, `text-wrap: balance`).
  - Etiquetas y Bajadas: *Space Grotesk* (pesos 500 y 600).
- **Motor de Render:** HyperFrames CLI con captura `drawElement`, aceleración NVIDIA GPU y validación automatizada (`npx hyperframes check`).
