# Canfranc Rutas

Aplicación web para explorar rutas del Valle de Canfranc mediante fichas detalladas y mapas 3D interactivos.

## Contenido

- 20 rutas con trazado geográfico asociado.
- Mapas 3D con relieve, perfil y clasificación de pendientes.
- Información de dificultad, duración, riesgos, material y logística.
- Navegación compatible con los botones Atrás y Adelante del navegador.

## Publicación

La aplicación se publica directamente desde la rama `main` mediante GitHub Pages.

## PWA y navegación sin cobertura

- Instalable en Android, iPhone y ordenadores compatibles.
- El botón `GPS · Offline` permite guardar la aplicación y los 20 trazados en el dispositivo.
- La navegación usa GPS de alta precisión, calcula la distancia al camino y avisa por vibración tras tres posiciones consecutivas fuera del trazado.
- El mapa 3D muestra la posición real mediante un punto azul y un círculo que representa la precisión estimada del GPS, diferenciados del simulador de recorrido naranja.
- Durante la navegación solicita mantener la pantalla encendida. El sistema puede rechazarlo por ahorro de batería o falta de compatibilidad.
- Antes de una salida hay que preparar el contenido con conexión y comprobarlo en modo avión.
- Los mapas base y el relieve 3D actuales proceden de servicios externos y no forman parte todavía del paquete offline. Los trazados, perfiles y estadísticas sí quedan guardados.

La información de las rutas es orientativa y no sustituye cartografía oficial, partes meteorológicos, experiencia, material adecuado ni criterio sobre el terreno.
