// Genera public/config.js en cada despliegue a partir de variables de entorno de Vercel,
// así la clave de API no queda guardada en el repositorio.
const fs = require('fs');
const path = require('path');
const apiKey = process.env.GOOGLE_API_KEY || '';
const folderId = process.env.DRIVE_FOLDER_ID || '1mglAu1inUXv1etNxQA_QSt99U7gOtBga';
if (!apiKey) console.warn('⚠ Falta la variable de entorno GOOGLE_API_KEY: la web no podrá leer Drive.');
const out = `// Archivo generado por build-config.js — no editar.
window.CORO_CONFIG = ${JSON.stringify({ apiKey, folderId }, null, 2)};
`;
fs.writeFileSync(path.join(__dirname, 'public', 'config.js'), out);
console.log('public/config.js generado' + (apiKey ? ' (con clave)' : ' (sin clave)'));
