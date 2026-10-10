# Registro de migraciones aplicadas al proyecto cloud

Hay un único proyecto Supabase (`zokkgocmcaqcujltfkjf`), destinado a producción. Aplicar una migración
ahí es **desplegar**, no validar (`docs/runbooks/cloud-evidence.md` §2.1). Cada aplicación se hace
con el workflow confiable **Cloud DB — ejecución revisada (main)** (`operation=apply` +
`confirm_project`), seguida inmediatamente por `operation=pgTAP` sobre el mismo SHA. Las URLs y los
resultados de esos runs se registran en la PR que se usó para dispararlos.

El workflow sólo opera sobre una PR abierta cuyo head es el SHA revisado. Cuando la PR de la
migración ya está mergeada, se abre una PR desde `main` que no cambia SQL (por ejemplo, la que agrega
la entrada a este registro), y sus migraciones son exactamente las de `main`.

| Migración | PR de origen | Decisión del mantenedor | Aplicada desde |
|---|---|---|---|
| `20261010150000_bb12_catalog_admin.sql` (BB-12: `products.sort_order`, `product_images.focal_x/focal_y`, trigger de bebidas sin alcohol) | #41 | Riesgo aceptado: efecto no verificado en destino aislado ([comentario](https://github.com/Bunker-Burger/bunker/pull/41#issuecomment-6100744519)) | PR que agrega esta entrada; los runs de `apply` y pgTAP se registran ahí |

Orden obligatorio: migración aplicada y pgTAP en verde **antes** de desplegar el código que la usa.
Si `apply` o pgTAP fallan, no se despliega y se evalúa una migración inversa revisada.
