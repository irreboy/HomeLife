const VERSION = "mi-dia-v15";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const CORE = [
  "./", "./index.html", "./styles.css", "./app.js", "./db.js",
  "./schedule.js", "./stats.js", "./report.js", "./catalog.js", "./recipes.js", "./config.js", "./native.js",
  "./manifest.webmanifest",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./assets/compras-saludables.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Navegación: red primero para recibir actualizaciones, cache como respaldo offline.
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put("./index.html", response.clone());
    return response;
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
  }
}

// Imágenes e iconos: cache primero y revalidación en segundo plano.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await network;
  return fresh || Response.error();
}

/*
 * Código de la aplicación (JS, CSS, manifiesto): red primero.
 * Los archivos no llevan hash en el nombre, así que servirlos desde cache dejaría
 * ejecutando la versión anterior tras cada publicación, e incluso
 * mezclando un index.html nuevo con un app.js viejo. Con red primero siempre se
 * usa la versión publicada cuando hay conexión, y el cache cubre el modo offline.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

const CODE = /\.(?:js|mjs|css|webmanifest)$/i;

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // El acompañante y cualquier API nunca se almacenan en cache.
  if (url.pathname.startsWith("/api/")) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") { event.respondWith(handleNavigation(request)); return; }
  if (CODE.test(url.pathname)) { event.respondWith(networkFirst(request, STATIC_CACHE)); return; }
  event.respondWith(staleWhileRevalidate(request, CORE.includes(`.${url.pathname}`) ? STATIC_CACHE : RUNTIME_CACHE));
});

/* ------------------------------------------------------------------ *
 * Avisos de medicamentos
 *
 * Entrega en tres capas (ninguna es una alarma garantizada del sistema):
 *   1. La página revisa cada 20 s mientras está abierta.
 *   2. Este service worker mantiene temporizadores mientras siga vivo.
 *   3. Al abrir la app se revisan las tomas atrasadas (recuperación).
 *
 * Las acciones del aviso se guardan en "outbox" y la página las aplica
 * al abrirse: el service worker nunca marca una toma por su cuenta.
 * ------------------------------------------------------------------ */

const DB_NAME = "mi-dia-saludable";
const DB_VERSION = 3;
const SNOOZE_MINUTES = 10;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of ["settings", "days", "notes", "outbox"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueAction(action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("outbox", "readwrite");
    tx.objectStore("outbox").put({ id: `${action.doseId}-${action.kind}-${Date.now()}`, ...action, queuedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let timers = [];

function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

async function notifyDose(dose) {
  await self.registration.showNotification(dose.kind === "reminder" ? "Recordatorio de Mi Día" : "Hora de un medicamento", {
    body: dose.body || `Corresponde ${dose.amount} de ${dose.name}`,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: dose.doseId,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: dose,
    actions: [
      { action: "taken", title: "✓ La tomó" },
      { action: "snooze", title: `Posponer ${SNOOZE_MINUTES} min` },
      { action: "skip", title: "Omitir" }
    ]
  });
}

// La página envía las tomas pendientes de hoy; aquí se programan mientras el worker viva.
self.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "schedule-doses") return;
  clearTimers();
  const now = Date.now();
  for (const dose of data.doses || []) {
    const delay = new Date(dose.dueAt).getTime() - now;
    if (delay <= 0 || delay > 86400000) continue;
    timers.push(setTimeout(() => notifyDose(dose), delay));
  }
});

self.addEventListener("notificationclick", event => {
  const dose = event.notification.data || {};
  event.notification.close();

  event.waitUntil((async () => {
    if (event.action === "snooze") {
      timers.push(setTimeout(() => notifyDose(dose), SNOOZE_MINUTES * 60000));
      await queueAction({ doseId: dose.doseId, medId: dose.medId, date: dose.date, time: dose.time, kind: "snooze" });
      return;
    }
    if (event.action === "taken" || event.action === "skip") {
      await queueAction({ doseId: dose.doseId, medId: dose.medId, date: dose.date, time: dose.time, kind: event.action });
    }

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = clients.find(client => client.url.includes(self.registration.scope));
    if (open) { await open.focus(); open.postMessage({ type: "outbox-updated" }); return; }
    if (event.action !== "taken" && event.action !== "skip") await self.clients.openWindow("./");
  })());
});

// Mejora progresiva (solo Chromium con la PWA instalada): despierta al worker
// para volver a programar los avisos del día. Nunca es la única capa.
self.addEventListener("periodicsync", event => {
  if (event.tag !== "mi-dia-reminders") return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "reschedule-request" });
  })());
});
