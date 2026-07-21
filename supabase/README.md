# Configuración de Supabase

1. Crear un proyecto nuevo en Supabase.
2. Abrir `SQL Editor`, pegar `schema.sql` y ejecutarlo una sola vez.
3. En `Authentication > URL Configuration`, añadir:
   - `https://acnbconsultoria.github.io/canfranc-rutas/`
4. Copiar únicamente `Project URL` y la clave `publishable`/`anon` en `supabase-config.js`.
5. No copiar ni publicar nunca `service_role` ni secretos administrativos.

El esquema activa Row Level Security en todas las tablas expuestas. Las actividades nuevas son privadas por defecto. Solo las actividades que el usuario marque como públicas pueden asociarse a una publicación comunitaria.

