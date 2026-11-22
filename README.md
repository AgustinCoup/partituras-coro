# Partituras del Coro

Web estática para leer las partituras del Drive del coro, escuchar los audios de cada cuerda y tocar una figura de la partitura para escuchar su nota.

No necesita servidor ni base de datos. La web lee la carpeta de Drive directamente con la API de Google Drive. Para eso la carpeta tiene que estar compartida como **"Cualquier persona con el enlace"** (hoy ya lo está).

## 1. Crear la clave de API de Google (gratis, ~5 minutos)

1. Entrá a https://console.cloud.google.com/ con tu cuenta de Google y creá un proyecto (por ejemplo "partituras-coro").
2. Andá a **APIs y servicios → Biblioteca**, buscá **Google Drive API** y tocá **Habilitar**.
3. Andá a **APIs y servicios → Credenciales → Crear credenciales → Clave de API**. Copiá la clave.
4. Tocá la clave para editarla y restringila. La clave queda visible en la página, así que este paso es importante:
   - **Restricciones de aplicaciones → Sitios web (referentes HTTP)**: agregá `https://TU-PROYECTO.vercel.app/*`. Si vas a probar en tu compu, agregá también `http://localhost:3000/*`.
   - **Restricciones de API → Restringir clave → Google Drive API**.
5. Guardá la clave para el paso 2. No hace falta escribirla en el código.

## 2. Desplegar en Vercel

1. En https://vercel.com/new importá este repositorio de GitHub.
2. En **Environment Variables** agregá `GOOGLE_API_KEY` con la clave del paso 1. Opcional: `DRIVE_FOLDER_ID` para usar otra carpeta.
3. Tocá **Deploy**. No hace falta cambiar nada más: `vercel.json` ya tiene la configuración.

En cada despliegue, `build-config.js` genera `public/config.js` con esas variables, así la clave nunca queda guardada en el repositorio. Cada `git push` a `main` vuelve a publicar la web sola.

Cuando Vercel te dé la dirección final (por ejemplo `partituras-coro.vercel.app`), verificá que esté en las restricciones de la clave (paso 1.4).

## 3. Probar en tu compu (opcional)

```bash
GOOGLE_API_KEY=tu_clave npm run dev
```

y abrí http://localhost:3000

## Cambiar de carpeta

Cambiá la variable `DRIVE_FOLDER_ID` en Vercel por el ID de otra carpeta de Drive (la parte final del enlace `drive.google.com/drive/folders/ID`). La carpeta tiene que estar compartida como "Cualquier persona con el enlace".

## Archivos

- `public/index.html`: la página (interfaz, audios, modo lectura, piano).
- `public/staff.js`: lectura de la partitura (pentagramas, claves, armadura, figuras y alteraciones).
- `public/config.js`: clave de API y carpeta (se genera al desplegar).
- `build-config.js`: genera `config.js` a partir de las variables de entorno.
- `public/lib/`: pdf.js, para mostrar los PDF.
- `vercel.json`: configuración de Vercel.

## Notas

- Las partituras se analizan en el navegador de cada persona. La primera vez que se abre una obra tarda unos segundos.
- Si Google devuelve "rechazó la clave", revisá que la Google Drive API esté habilitada y que la dirección de la web esté en las restricciones de la clave.
- Google Drive limita las consultas por clave (decenas de miles por día en el plan gratis), algo que un coro no debería alcanzar.
