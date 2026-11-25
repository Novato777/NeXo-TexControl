/** Estado global del servidor: mientras no está listo, la API responde 503 con un mensaje amable. */
export const appState = { ready: false, message: 'Iniciando…' };
