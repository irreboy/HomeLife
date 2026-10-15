/* Configuración del entorno.
 *
 * En la web la aplicación y el endpoint del chat comparten origen, así que basta
 * una ruta relativa. Dentro de la aplicación Android los archivos se sirven
 * desde `https://localhost`, por lo que `/api/chat` apuntaría al propio teléfono:
 * ahí hay que nombrar el Worker publicado.
 */

/** Dominio del Worker. Se completa al desplegar con `wrangler deploy`. */
export const WORKER_ORIGIN = "";

/** True dentro de la aplicación Android empaquetada con Capacitor. */
export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

/** URL del acompañante según dónde se esté ejecutando. */
export function chatEndpoint() {
  if (!isNativeApp()) return "/api/chat";
  if (!WORKER_ORIGIN) return null;
  return `${WORKER_ORIGIN.replace(/\/$/, "")}/api/chat`;
}
