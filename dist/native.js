/* Puente con la aplicación Android.
 *
 * En el navegador todo esto queda inerte: cada función comprueba primero que
 * exista el puente de Capacitor. No se usan importaciones de npm porque el
 * proyecto no tiene empaquetador; los plugins se leen del objeto global que
 * Capacitor inyecta en la página.
 *
 * Lo que aporta frente a la versión web: una alarma exacta programada por el
 * sistema operativo, que suena con la aplicación cerrada. Los avisos del
 * navegador no lo garantizan.
 */

const CANAL = "medicamentos";
const TIPO_ACCION = "toma";

function plugins() { return globalThis.Capacitor?.Plugins; }

export function isNative() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function notificaciones() {
  return isNative() ? plugins()?.LocalNotifications : null;
}

/**
 * Android exige un entero de 32 bits como identificador de notificación, pero
 * las tomas se identifican por texto (`medicamento|fecha|hora`). Se deriva un
 * número estable de ese texto para poder cancelar y reprogramar la misma toma.
 */
export function idNumerico(texto) {
  let hash = 0;
  for (let i = 0; i < texto.length; i += 1) {
    hash = (hash * 31 + texto.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483000 || 1;
}

/** Permiso de notificaciones y, si se puede, de alarmas exactas. */
export async function pedirPermisos() {
  const api = notificaciones();
  if (!api) return { concedido: false, exactas: false };

  const permiso = await api.requestPermissions();
  const concedido = permiso?.display === "granted";

  let exactas = false;
  try {
    const estado = await api.checkExactNotificationSetting();
    exactas = estado?.exact_alarm === "granted";
    if (!exactas) {
      // Abre los ajustes del sistema: en Android 13+ la alarma exacta se
      // concede ahí, no con un diálogo dentro de la aplicación.
      await api.changeExactNotificationSetting();
      const nuevo = await api.checkExactNotificationSetting();
      exactas = nuevo?.exact_alarm === "granted";
    }
  } catch { /* versiones de Android que no lo exigen */ }

  return { concedido, exactas };
}

/** Botones de la notificación, equivalentes a los del service worker. */
export async function registrarAcciones(minutosPosponer = 10) {
  const api = notificaciones();
  if (!api?.registerActionTypes) return;
  try {
    await api.registerActionTypes({
      types: [{
        id: TIPO_ACCION,
        actions: [
          { id: "taken", title: "✓ La tomó" },
          { id: "snooze", title: `Posponer ${minutosPosponer} min` },
          { id: "skip", title: "Omitir", destructive: true }
        ]
      }]
    });
  } catch { /* sin soporte */ }
}

/**
 * Reprograma todas las alarmas del día.
 * Se cancelan las pendientes antes de volver a crearlas: así una toma ya
 * registrada deja de sonar.
 */
export async function programarAlarmas(alertas) {
  const api = notificaciones();
  if (!api) return false;

  try {
    const pendientes = await api.getPending();
    if (pendientes?.notifications?.length) {
      await api.cancel({ notifications: pendientes.notifications.map(n => ({ id: n.id })) });
    }

    const ahora = Date.now();
    const lista = alertas
      .filter(alerta => new Date(alerta.dueAt).getTime() > ahora)
      .map(alerta => ({
        id: idNumerico(alerta.doseId),
        title: alerta.kind === "reminder" ? "Recordatorio de Mi Día" : "Hora de un medicamento",
        body: alerta.kind === "reminder" ? alerta.name : `Corresponde ${alerta.amount} de ${alerta.name}`,
        schedule: {
          at: new Date(alerta.dueAt),
          // Sin esto Android retrasa la alarma cuando el teléfono está en reposo.
          allowWhileIdle: true
        },
        channelId: CANAL,
        actionTypeId: alerta.kind === "reminder" ? undefined : TIPO_ACCION,
        extra: alerta,
        smallIcon: "ic_stat_icon",
        ongoing: false,
        autoCancel: true
      }));

    if (lista.length) await api.schedule({ notifications: lista });
    return true;
  } catch (error) {
    console.error("No se pudieron programar las alarmas nativas", error);
    return false;
  }
}

/** Canal de notificación: en Android 8+ define sonido e importancia. */
export async function crearCanal() {
  const api = notificaciones();
  if (!api?.createChannel) return;
  try {
    await api.createChannel({
      id: CANAL,
      name: "Medicamentos y recordatorios",
      description: "Avisos a la hora de cada toma",
      importance: 5,
      visibility: 1,
      vibration: true
    });
  } catch { /* sin soporte */ }
}

/**
 * Entrega las acciones del usuario sobre una notificación.
 * `manejar` recibe { doseId, kind, ... } igual que la bandeja del service
 * worker, para que la lógica de la aplicación sea una sola.
 */
export function escucharAcciones(manejar) {
  const api = notificaciones();
  if (!api?.addListener) return;
  api.addListener("localNotificationActionPerformed", evento => {
    const alerta = evento?.notification?.extra;
    if (!alerta) return;
    const accion = evento.actionId === "tap" ? "open" : evento.actionId;
    manejar({ ...alerta, accion });
  });
}

/** Vibración del sistema, más consistente que la del navegador. */
export async function vibrar() {
  if (!isNative()) return false;
  try {
    await plugins()?.Haptics?.impact({ style: "MEDIUM" });
    return true;
  } catch { return false; }
}
