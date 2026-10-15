const DB_NAME = "mi-dia-saludable";
const DB_VERSION = 3;
// Lo que entra en la copia de seguridad.
const STORES = ["settings", "days", "notes"];
// "outbox" guarda las acciones hechas desde un aviso con la app cerrada.
const ALL_STORES = [...STORES, "outbox"];

// Una sola conexión reutilizada. Antes se abría una por operación y ninguna se
// cerraba: eso acumulaba conexiones y dejaba la base imposible de borrar o migrar.
let connection = null;

function openDB() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of ALL_STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Si otra pestaña pide una versión nueva, hay que soltar la conexión.
      db.onversionchange = () => { db.close(); connection = null; };
      db.onclose = () => { connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}

/** Cierra la conexión (para borrar o migrar la base sin quedar bloqueado). */
export async function closeDB() {
  if (!connection) return;
  try { (await connection).close(); } catch { /* ya cerrada */ }
  connection = null;
}

export async function getRecord(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putRecord(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllRecords(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function replaceAll(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    for (const store of STORES) {
      tx.objectStore(store).clear();
      for (const item of data[store] || []) tx.objectStore(store).put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportDatabase() {
  return { format: "mi-dia-backup", version: 2, exportedAt: new Date().toISOString(), settings: await getAllRecords("settings"), days: await getAllRecords("days"), notes: await getAllRecords("notes") };
}

export async function deleteRecord(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
