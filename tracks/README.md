# Tracks validados

Cada ruta con track interno tiene una carpeta `<route-id>/` con:

- `route.geojson` — trazado completo (LineString con elevación).
- `slope.geojson` — trazado segmentado y clasificado por pendiente
  (`descenso`, `suave`, `moderada`, `exigente`, `muy-exigente`).
- `profile.json` — perfil punto a punto: `distance_km`, `latitude`, `longitude`,
  `elevation_smoothed_m`, `slope_percent`… (alimenta la reproducción y el HUD del mapa 3D).
- `pois.json` — hitos verificados con coordenadas, km de ruta, estado y fuente (opcional).
- `stats.json` — estadísticas de referencia del track (opcional).

Flujo para incorporar un track:

1. Obtener un GPX/KML de una fuente identificada y fiable (o grabado y revisado sobre el terreno).
2. Procesarlo a los archivos anteriores (véase `la-moleta-circular/` como referencia).
3. En `src/data/routes.js`, cambiar `track: null` por:

```js
track: {
  dir: '/tracks/<route-id>',
  source: 'Procedencia del track y fecha de revisión',
  lengthKm: 17.678
}
```

4. Ejecutar `npm run validate:data`: el validador comprueba que los archivos existen
   y que se declara la procedencia.

Mientras `track` sea `null`, el mapa 3D muestra el relieve real y el punto de inicio,
e indica que el trazado aún no está incorporado. Nunca se dibujan recorridos aproximados.

## Tracks incorporados

- `la-moleta-circular/` — Wikiloc 149846174 («Pico La Moleta 2.572 m. Circular por el
  Carretón–Ibón de Iserías–Valle de Izas»), 17,678 km, 3.155 puntos, procesado desde el
  KML original con elevación suavizada y pendiente por tramos.
