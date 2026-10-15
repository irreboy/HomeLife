import { getRecord, putRecord, getAllRecords, deleteRecord, replaceAll, exportDatabase, estimateStorage, closeDB } from "./db.js";
import {
  DOSE_PRESETS, localDateKey, dateFromKey, addDays, formatTime, doseDueAt, doseId,
  medTimes, medicationIsDue, snapshotMedication, dayDoses, stockForecast
} from "./schedule.js";
import {
  completion, adherence, perfectDayStreak, adherenceByMedication, intakeHistogram,
  bloodPressureSeries, bloodPressureSummary, bloodPressureByTimeOfDay, hydrationSeries
} from "./stats.js";
import { bpChartSVG, buildReportHTML, openReport, bloodPressureCSV, intakesCSV, downloadFile } from "./report.js";
import {
  GROCERIES, CARBS, SHOP_UNITS, AISLES, FOOD_TASKS, CATEGORY_SYMBOL, CATEGORY_HINT,
  categoryOf, isInGuideline, aisleOf, unitLabel
} from "./catalog.js";
import { RECIPES, scaleRecipe, formatQty, pantryMatch, searchRecipes, usesCarbohydrate } from "./recipes.js";
import { chatEndpoint, isNativeApp } from "./config.js";
import * as nativo from "./native.js";

/* ------------------------------ Configuración ------------------------------ */

const DEFAULT_SETTINGS = {
  id: "main",
  personName: "Mamá",
  waterGoal: 2500,
  shoppingList: {},
  pantry: {},
  staples: [],
  reminders: [],
  mealPlan: {},
  favoriteRecipes: [],
  defaultServings: 4,
  notificationsEnabled: false,
  notifiedReminders: {},
  textScale: 1,
  highContrast: false,
  theme: "auto",
  soundEnabled: true,
  hapticsEnabled: true,
  lastBackupAt: null,
  // Marca de configuración inicial; null = falta completar la bienvenida.
  onboardedAt: null,
  // Sin medicamentos: la pauta la carga la familia en el primer uso.
  // El código fuente no contiene datos de salud de nadie.
  medications: []
};

/** Recordatorios que no son medicamentos; la usuaria puede editarlos o quitarlos. */
const SUGGESTED_REMINDERS = [
  { title: "Medir la presión", icon: "♡", time: "08:45", repeat: "daily" },
  { title: "Caminar 30 minutos", icon: "👟", time: "17:00", repeat: "daily" },
  { title: "Preparar la compra de la semana", icon: "🛒", time: "10:00", repeat: "weekly", weekdays: [6] }
];

const REMINDER_ICONS = ["🔔", "♡", "👟", "🛒", "🩺", "💧", "🍽️", "💤", "📞", "💊", "🧴", "☀️"];
const NOTE_KINDS = [
  { id: "general", label: "Nota", icon: "📝" },
  { id: "pregunta", label: "Pregunta para el médico", icon: "❓" },
  { id: "sintoma", label: "Síntoma o molestia", icon: "🩺" },
  { id: "indicacion", label: "Indicación recibida", icon: "📋" }
];
const MEALS = ["Desayuno", "Almuerzo", "Cena"];
const WEEKDAYS = [["1", "L"], ["2", "M"], ["3", "M"], ["4", "J"], ["5", "V"], ["6", "S"], ["0", "D"]];

const BACKUP_REMINDER_DAYS = 14;
const SNOOZE_MINUTES = 10;
const TICK_MS = 20000;

const state = {
  onboarding: false,
  settings: null,
  day: null,
  days: [],
  notes: [],
  viewDate: localDateKey(),
  page: "today",
  modal: null,
  historyOpen: null,
  shopCategory: "Verduras",
  shopView: "list",
  collapsedAisles: {},
  recipeQuery: "",
  recipeFilter: "todas",
  noteQuery: "",
  noteFilter: "todas",
  statsWindow: 30,
  deferredInstall: null,
  chatBusy: false,
  chatMessages: []
};

const WELCOME_MESSAGE = { role: "assistant", content: "Hola. Soy tu compañera de Mi Día. Puedo ayudarte a organizar la rutina, usar la aplicación o pensar comidas con la pauta familiar." };

let toastTimer;
let tickTimer;
let audioContext;

/* -------------------------------- Utilidades ------------------------------- */

function isToday(key = state.viewDate) { return key === localDateKey(); }
function formatDate(key, options = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("es-CL", options).format(dateFromKey(key));
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches"; }
function uid() { return crypto.randomUUID(); }

function haptic(pattern = 30) {
  if (!state.settings?.hapticsEnabled) return;
  try { navigator.vibrate?.(pattern); } catch { /* sin soporte */ }
}

/** Campana sintetizada: no requiere archivos de audio ni conexión. */
function chime() {
  if (!state.settings?.soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    const now = audioContext.currentTime;
    for (const [index, frequency] of [880, 1174.7].entries()) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, now + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.5);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + index * 0.18);
      oscillator.stop(now + index * 0.18 + 0.5);
    }
  } catch { /* el aviso visual sigue funcionando */ }
}

/**
 * Confirmación dentro de la aplicación.
 * No se usa confirm() del navegador: bloquea la página, no se puede traducir ni
 * agrandar con el ajuste de texto, y en la app Android sale como diálogo del sistema.
 */
let pendingConfirm = null;

function askConfirm({ title, body, confirmLabel = "Confirmar", danger = false }, onConfirm) {
  pendingConfirm = onConfirm;
  state.modal = { type: "confirm", title, body, confirmLabel, danger };
  render();
  setTimeout(() => document.querySelector("[data-confirm-yes]")?.focus(), 0);
}

function showToast(message, { alert = false } = {}) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("alert", alert);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), alert ? 6000 : 2600);
}

function applyPreferences() {
  const root = document.documentElement;
  root.style.setProperty("--text-scale", String(state.settings?.textScale || 1));
  root.dataset.contrast = state.settings?.highContrast ? "high" : "normal";
  const theme = state.settings?.theme || "auto";
  if (theme === "auto") delete root.dataset.theme; else root.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1a18" : "#0f766e");
}

/* ------------------------------- Persistencia ------------------------------ */

function newDay(date) {
  const medications = state.settings ? state.settings.medications.filter(m => medicationIsDue(m, date)).map(snapshotMedication) : [];
  return {
    id: date, date, tasks: {}, taskTimes: {},
    medicationIntakes: {}, doseSkips: {}, reminderDone: {},
    waterMl: 0, waterHistory: [], hydrationEntries: [],
    waterGoalSnapshot: state.settings?.waterGoal || 2500,
    medicationSnapshot: medications, carbohydrate: null,
    bloodPressure: [], notes: "", createdAt: new Date().toISOString()
  };
}

async function saveDay(day = state.day) {
  await putRecord("days", day);
  const index = state.days.findIndex(d => d.id === day.id);
  const copy = structuredClone(day);
  if (index >= 0) state.days[index] = copy; else state.days.push(copy);
}

async function saveSettings() { await putRecord("settings", state.settings); }
async function saveChat() {
  await putRecord("settings", { id: "chat", messages: state.chatMessages.slice(-20), updatedAt: new Date().toISOString() });
}

async function loadDay(dateKey) {
  const existing = await getRecord("days", dateKey);
  state.viewDate = dateKey;
  state.day = existing || newDay(dateKey);
  normalizeDay(state.day);
  // Solo hoy refresca su instantánea con la pauta vigente; un día pasado
  // conserva la pauta que tenía cuando se vivió.
  if (isToday(dateKey)) {
    const snapshot = state.settings.medications.filter(m => medicationIsDue(m, dateKey)).map(snapshotMedication);
    const changed = JSON.stringify(snapshot) !== JSON.stringify(state.day.medicationSnapshot)
      || state.day.waterGoalSnapshot !== state.settings.waterGoal;
    state.day.medicationSnapshot = snapshot;
    state.day.waterGoalSnapshot = state.settings.waterGoal;
    if (changed) await saveDay();
  }
  if (!existing) await saveDay();
}

function normalizeDay(day) {
  day.tasks ||= {};
  day.taskTimes ||= {};
  day.medicationIntakes ||= {};
  day.doseSkips ||= {};
  day.reminderDone ||= {};
  day.waterHistory ||= [];
  day.hydrationEntries ||= [];
  day.bloodPressure ||= [];
  day.medicationSnapshot ||= [];
  if (typeof day.notes !== "string") day.notes = "";
  if (typeof day.waterMl !== "number") day.waterMl = 0;

  for (const med of day.medicationSnapshot) {
    if (!Array.isArray(med.times) || !med.times.length) med.times = med.reminderTime ? [med.reminderTime] : ["08:00"];
  }
  // Migración: tomas indexadas por medicamento -> indexadas por toma del día.
  for (const [key, value] of Object.entries(day.medicationIntakes)) {
    if (key.includes("|")) continue;
    const med = day.medicationSnapshot.find(m => m.id === key);
    day.medicationIntakes[doseId(key, day.date, med ? medTimes(med)[0] : "08:00")] = value;
    delete day.medicationIntakes[key];
  }
  // Migración: casillas "med-*" del modelo antiguo.
  for (const key of Object.keys(day.tasks)) {
    if (!key.startsWith("med-")) continue;
    const medId = key.slice(4);
    const med = day.medicationSnapshot.find(m => m.id === medId);
    const time = med ? medTimes(med)[0] : "08:00";
    const id = doseId(medId, day.date, time);
    if (day.tasks[key] && !day.medicationIntakes[id]) {
      day.medicationIntakes[id] = { actualAmount: med?.doseValue ?? 1, unit: med?.doseUnit || "unidad", time: day.taskTimes[key] || time, note: "", recordedAt: day.createdAt || new Date().toISOString(), migrated: true };
    }
    delete day.tasks[key];
    delete day.taskTimes[key];
  }
}

function migrateSettings(settings) {
  let changed = false;
  const defaults = {
    shoppingList: {}, pantry: {}, staples: [], reminders: [], mealPlan: {}, favoriteRecipes: [],
    defaultServings: 4, notifiedReminders: {}, notificationsEnabled: false,
    textScale: 1, highContrast: false, theme: "auto", soundEnabled: true, hapticsEnabled: true, lastBackupAt: null
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (settings[key] === undefined || (settings[key] === null && value !== null)) {
      settings[key] = structuredClone(value);
      changed = true;
    }
  }
  for (const med of settings.medications || []) {
    const parsed = String(med.amount || "").match(/([\d.,]+)\s*(.*)/);
    if (!med.doseValue) { med.doseValue = parsed ? Number(parsed[1].replace(",", ".")) : 1; changed = true; }
    if (!med.doseUnit) { med.doseUnit = parsed?.[2] || "unidad"; changed = true; }
    if (!Array.isArray(med.times) || !med.times.length) {
      med.times = [med.reminderTime || (med.time === "Desayuno" ? "08:00" : "21:00")];
      changed = true;
    }
    delete med.reminderTime;
  }
  // Los avisos ya notificados se conservan 3 días: evita que el registro crezca sin límite.
  const cutoff = addDays(localDateKey(), -3);
  for (const key of Object.keys(settings.notifiedReminders || {})) {
    const stamp = key.replace(/^snooze:/, "").split("|")[1] || "";
    if (stamp && stamp < cutoff) { delete settings.notifiedReminders[key]; changed = true; }
  }
  // Los planes de comida pasados no se conservan más de un mes.
  const planCutoff = addDays(localDateKey(), -31);
  for (const key of Object.keys(settings.mealPlan || {})) {
    if (key < planCutoff) { delete settings.mealPlan[key]; changed = true; }
  }
  return changed;
}

/* ------------------------------ Recordatorios ------------------------------ */

/** Recordatorios que corresponden a una fecha, con su estado del día. */
function dayReminders(day = state.day) {
  const date = day.date;
  const weekday = String(dateFromKey(date).getDay());
  return (state.settings.reminders || [])
    .filter(reminder => {
      if (reminder.active === false) return false;
      if (reminder.repeat === "once") return reminder.date === date;
      if (reminder.repeat === "weekly") return (reminder.weekdays || []).map(String).includes(weekday);
      return true;
    })
    .map(reminder => ({
      ...reminder,
      done: !!day.reminderDone?.[reminder.id],
      doneAt: day.reminderDone?.[reminder.id] || null,
      due: !day.reminderDone?.[reminder.id] && doseDueAt(date, reminder.time) <= new Date()
    }))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/* --------------------------------- Despensa -------------------------------- */

function pantryHas(name) { return !!state.settings.pantry?.[name]?.available; }

async function setPantry(name, available) {
  state.settings.pantry ||= {};
  if (available === null) delete state.settings.pantry[name];
  else state.settings.pantry[name] = { available, updatedAt: new Date().toISOString() };
  await saveSettings();
}

/** Agrega a la compra respetando lo que ya está en la lista. */
async function addToShoppingList(name, { quantity = 1, unit, fromRecipe = null, custom = false } = {}) {
  state.settings.shoppingList ||= {};
  const existing = state.settings.shoppingList[name];
  const item = existing || { quantity: 0, unit: unit || "unidad", purchased: false, custom: custom || !isInGuideline(name) };
  item.quantity = Number((Number(item.quantity || 0) + Number(quantity)).toFixed(2));
  item.unit = unit || item.unit || "unidad";
  item.purchased = false;
  if (fromRecipe) item.fromRecipe = fromRecipe;
  state.settings.shoppingList[name] = item;
  await saveSettings();
  return item;
}

function shoppingEntries() {
  return Object.entries(state.settings.shoppingList || {}).filter(([, item]) => Number(item.quantity) > 0);
}

/** Agrupa la compra por pasillo para recorrer el supermercado en orden. */
function shoppingByAisle() {
  const groups = new Map(AISLES.map(aisle => [aisle, []]));
  for (const [name, item] of shoppingEntries()) {
    const aisle = item.custom && !isInGuideline(name) ? "Otros" : aisleOf(name);
    groups.get(aisle).push([name, item]);
  }
  return [...groups.entries()]
    .map(([aisle, items]) => [aisle, items.sort((a, b) => a[0].localeCompare(b[0], "es"))])
    .filter(([, items]) => items.length);
}

/* ---------------------------------- Avisos --------------------------------- */

function pendingDoses(day = state.day) {
  return dayDoses(day).filter(dose => dose.status === "pending" || dose.status === "overdue");
}

/** Avisos futuros de hoy: tomas de medicamentos y recordatorios generales. */
function upcomingAlerts(day, from = Date.now()) {
  const alerts = [];
  for (const dose of dayDoses(day)) {
    if (dose.intake || dose.skipped) continue;
    const at = doseDueAt(dose.date, dose.time).getTime();
    if (at <= from) continue;
    alerts.push({
      kind: "dose", doseId: dose.doseId, medId: dose.medId, date: dose.date, time: dose.time,
      dueAt: new Date(at).toISOString(), name: dose.name,
      amount: dose.amount || `${dose.doseValue} ${unitLabel(dose.doseValue, dose.doseUnit)}`
    });
  }
  for (const reminder of dayReminders(day)) {
    if (reminder.done) continue;
    const at = doseDueAt(day.date, reminder.time).getTime();
    if (at <= from) continue;
    alerts.push({
      kind: "reminder", doseId: `rem:${reminder.id}|${day.date}|${reminder.time}`,
      reminderId: reminder.id, date: day.date, time: reminder.time,
      dueAt: new Date(at).toISOString(), name: reminder.title, body: reminder.title
    });
  }
  return alerts;
}

/**
 * Capa 2: programación de los avisos futuros.
 *
 * En la aplicación Android las programa el sistema operativo como alarmas
 * exactas, que suenan con la aplicación cerrada. En el navegador se delega en
 * el service worker, que solo mantiene temporizadores mientras sigue vivo.
 */
async function scheduleServiceWorkerDoses() {
  if (!state.settings?.notificationsEnabled) return;
  const today = localDateKey();
  let day = isToday() ? state.day : await getRecord("days", today);
  if (!day) return;
  if (day !== state.day) normalizeDay(day);
  const alerts = upcomingAlerts(day);

  if (nativo.isNative()) {
    await nativo.programarAlarmas(alerts);
    return;
  }

  const registration = await navigator.serviceWorker?.getRegistration?.();
  if (!registration?.active) return;
  registration.active.postMessage({ type: "schedule-doses", doses: alerts });

  if (registration.periodicSync) {
    try { await registration.periodicSync.register("mi-dia-reminders", { minInterval: 12 * 3600 * 1000 }); } catch { /* no disponible */ }
  }
}

async function fireAlert(key, title, body) {
  state.settings.notifiedReminders[key] = new Date().toISOString();
  showToast(body, { alert: true });
  chime();
  haptic([200, 100, 200]);
  const registration = await navigator.serviceWorker?.getRegistration?.();
  if (registration && Notification.permission === "granted") {
    registration.showNotification(title, {
      body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
      tag: key, renotify: true, vibrate: [200, 100, 200]
    }).catch(() => {});
  }
}

/** Capa 1: revisión mientras la aplicación está abierta. */
async function checkReminders() {
  if (!state.settings?.notificationsEnabled || !isToday()) return;
  const now = new Date();
  let changed = false;

  for (const dose of dayDoses(state.day)) {
    if (dose.intake || dose.skipped) continue;
    if (doseDueAt(dose.date, dose.time) > now) continue;
    const snoozed = state.settings.notifiedReminders[`snooze:${dose.doseId}`];
    if (snoozed && new Date(snoozed) > now) continue;
    if (state.settings.notifiedReminders[dose.doseId]) continue;
    const amount = dose.amount || `${dose.doseValue} ${unitLabel(dose.doseValue, dose.doseUnit)}`;
    await fireAlert(dose.doseId, "Hora de un medicamento", `Corresponde ${amount} de ${dose.name}`);
    changed = true;
  }

  for (const reminder of dayReminders(state.day)) {
    if (reminder.done || !reminder.due) continue;
    const key = `rem:${reminder.id}|${state.day.date}|${reminder.time}`;
    if (state.settings.notifiedReminders[key]) continue;
    await fireAlert(key, "Recordatorio de Mi Día", reminder.title);
    changed = true;
  }

  if (changed) await saveSettings();
  await updateBadge();
}

/** Contador en el icono: tomas y recordatorios que siguen pendientes. */
async function updateBadge() {
  if (!navigator.setAppBadge) return;
  try {
    const today = localDateKey();
    let day = isToday() ? state.day : await getRecord("days", today);
    if (day && day !== state.day) normalizeDay(day);
    const count = day ? pendingDoses(day).length + dayReminders(day).filter(r => !r.done).length : 0;
    if (count) await navigator.setAppBadge(count); else await navigator.clearAppBadge();
  } catch { /* sin soporte */ }
}

/**
 * Capa 3: al abrir la app se aplican las acciones hechas desde un aviso
 * mientras estaba cerrada. El service worker nunca marca una toma por su cuenta.
 */
async function drainOutbox() {
  const actions = await getAllRecords("outbox");
  if (!actions.length) return false;
  const touched = new Map();

  for (const action of actions.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)))) {
    try {
      if (action.kind === "snooze") {
        state.settings.notifiedReminders[`snooze:${action.doseId}`] = new Date(Date.now() + SNOOZE_MINUTES * 60000).toISOString();
        continue;
      }
      if (action.kind !== "taken" && action.kind !== "skip") continue;

      const day = touched.get(action.date) || (action.date === state.viewDate ? state.day : await getRecord("days", action.date));
      if (!day) continue;
      normalizeDay(day);

      if (String(action.doseId).startsWith("rem:")) {
        if (action.kind === "taken") day.reminderDone[action.reminderId] = action.time;
      } else {
        const med = day.medicationSnapshot.find(m => m.id === action.medId);
        if (action.kind === "taken") {
          day.medicationIntakes[action.doseId] ||= {
            actualAmount: med?.doseValue ?? 1, unit: med?.doseUnit || "unidad",
            time: action.time, note: "", recordedAt: action.queuedAt, fromNotification: true
          };
        } else {
          day.doseSkips[action.doseId] = { skippedAt: action.queuedAt, fromNotification: true };
        }
      }
      touched.set(action.date, day);
    } finally {
      await deleteRecord("outbox", action.id);
    }
  }

  for (const day of touched.values()) {
    await saveDay(day);
    if (day.date === state.viewDate) state.day = day;
  }
  await saveSettings();
  return true;
}

function reportOverdue() {
  if (!isToday()) return;
  const overdue = dayDoses(state.day).filter(dose => dose.status === "overdue");
  if (!overdue.length) return;
  const names = [...new Set(overdue.map(dose => dose.name))];
  showToast(`${overdue.length} ${overdue.length === 1 ? "toma pendiente" : "tomas pendientes"}: ${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""}`, { alert: true });
}

/* --------------------------------- Estructura ------------------------------ */

const NAV = [
  ["today", "⌂", "Hoy"],
  ["shop", "🛒", "Súper"],
  ["recipes", "🍳", "Recetas"],
  ["notes", "📝", "Notas"],
  ["health", "♡", "Salud"],
  ["assistant", "✦", "Compañera"]
];

function shell(content) {
  return `<div class="app-shell">
    <header class="topbar">
      <div class="identity"><span class="mini-mark">M</span><span><strong>Mi Día</strong><small>Nos cuidamos en familia</small></span></div>
      <div class="topbar-actions">
        <span class="privacy-pill">Privado · ${escapeHTML(state.settings.personName)}</span>
        <button class="icon-button ghost" data-page="settings" aria-label="Ajustes" aria-current="${state.page === "settings" ? "page" : "false"}">⚙</button>
      </div>
    </header>
    ${content}
  </div>
  <nav class="bottom-nav" aria-label="Navegación principal">${NAV.map(([id, icon, label]) =>
    `<button class="nav-btn ${state.page === id ? "active" : ""}" data-page="${id}" aria-current="${state.page === id ? "page" : "false"}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav>
  ${modalHTML()}`;
}

function dateBar() {
  const today = localDateKey();
  return `<div class="date-bar">
    <button class="icon-button" data-shift-day="-1" aria-label="Día anterior">‹</button>
    <div class="date-bar-label"><strong>${isToday() ? "Hoy" : escapeHTML(formatDate(state.viewDate, { weekday: "long", day: "numeric", month: "long" }))}</strong>${isToday() ? "" : `<small>Estás editando un día pasado</small>`}</div>
    <button class="icon-button" data-shift-day="1" aria-label="Día siguiente" ${state.viewDate >= today ? "disabled" : ""}>›</button>
    ${isToday() ? "" : `<button class="btn soft small" data-go-today>Volver a hoy</button>`}
  </div>`;
}

function nextThing() {
  const doses = dayDoses(state.day);
  const overdue = doses.find(dose => dose.status === "overdue");
  if (overdue) return { icon: "⏰", title: `Toma atrasada: ${overdue.name}`, detail: `Correspondía a las ${overdue.time}` };
  const dueReminder = dayReminders(state.day).find(reminder => reminder.due);
  if (dueReminder) return { icon: dueReminder.icon || "🔔", title: dueReminder.title, detail: `Correspondía a las ${dueReminder.time}` };
  const pending = doses.find(dose => dose.status === "pending");
  if (pending) return { icon: "💊", title: pending.name, detail: `${pending.time} · ${pending.amount || `${pending.doseValue} ${unitLabel(pending.doseValue, pending.doseUnit)}`}` };
  const goal = state.day.waterGoalSnapshot || state.settings.waterGoal;
  if (state.day.waterMl < goal) return { icon: "💧", title: "Continuar con el agua", detail: `Faltan ${goal - state.day.waterMl} ml para la meta` };
  return { icon: "✓", title: "Todo lo principal está listo", detail: "Puedes agregar una nota si lo necesitas" };
}

function doseHTML(dose) {
  const label = dose.status === "taken" ? "Registrado" : dose.status === "skipped" ? "Omitida" : dose.status === "overdue" ? "Atrasada" : escapeHTML(dose.moment || "Programada");
  const intake = dose.intake;
  return `<article class="medication-dose ${dose.status}">
    <div class="dose-time"><strong>${escapeHTML(dose.time)}</strong><span>${label}</span></div>
    <div class="dose-info"><strong>${escapeHTML(dose.name)}</strong><span>${escapeHTML([dose.dosage, dose.amount, dose.instructions].filter(Boolean).join(" · "))}</span>
    ${intake ? `<small>✓ Tomó ${intake.actualAmount} ${escapeHTML(unitLabel(intake.actualAmount, intake.unit))} a las ${escapeHTML(intake.time)}${intake.note ? ` · ${escapeHTML(intake.note)}` : ""}${intake.fromNotification ? " · desde el aviso" : ""}</small>` : dose.skipped ? `<small>Marcada como omitida</small>` : ""}</div>
    <div class="dose-actions">
      <button class="btn ${intake ? "secondary" : ""} small" data-take-dose="${escapeHTML(dose.doseId)}">${intake ? "Editar" : "Registrar"}</button>
      ${!intake ? `<button class="text-button" data-skip-dose="${escapeHTML(dose.doseId)}">${dose.skipped ? "Reactivar" : "Omitir"}</button>` : ""}
    </div>
  </article>`;
}

function taskHTML(task) {
  const checked = !!state.day.tasks[task.id];
  return `<label class="task ${checked ? "done" : ""}"><input type="checkbox" data-task="${task.id}" ${checked ? "checked" : ""}><span><strong>${escapeHTML(task.name)}</strong><small>${escapeHTML(task.detail)}${checked && state.day.taskTimes[task.id] ? ` · ${escapeHTML(state.day.taskTimes[task.id])}` : ""}</small></span></label>`;
}

function stockWarnings() {
  const warnings = (state.settings.medications || [])
    .filter(med => med.active !== false)
    .map(med => ({ med, forecast: stockForecast(med) }))
    .filter(row => row.forecast && row.forecast.days <= 7);
  if (!warnings.length) return "";
  return `<div class="stock-warning">📦 <strong>Conviene reponer</strong><ul>${warnings.map(({ med, forecast }) =>
    `<li>${escapeHTML(med.name)}: ${forecast.remaining === 1 ? "queda" : "quedan"} ${forecast.remaining} ${escapeHTML(unitLabel(forecast.remaining, med.doseUnit))} · alrededor de ${forecast.days} ${forecast.days === 1 ? "día" : "días"}</li>`).join("")}</ul></div>`;
}

function backupBanner() {
  const last = state.settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  if (days !== null && days < BACKUP_REMINDER_DAYS) return "";
  return `<div class="backup-banner"><span aria-hidden="true">🗄️</span><div><strong>${last ? `Última copia hace ${days} días` : "Aún no hay copia de seguridad"}</strong><small>El navegador puede borrar los datos del teléfono. Guarda un respaldo en el correo o la nube.</small></div><button class="btn small" data-export>Exportar</button></div>`;
}

function todayPage() {
  const c = completion(state.day, state.settings.waterGoal);
  const next = nextThing();
  const doses = dayDoses(state.day);
  const reminders = dayReminders(state.day);
  const goal = state.day.waterGoalSnapshot || state.settings.waterGoal;
  const otherLiquids = (state.day.hydrationEntries || []).filter(e => e.type !== "Agua");
  const otherTotal = otherLiquids.reduce((sum, e) => sum + Number(e.ml || 0), 0);
  const groups = [["Mañana", doses.filter(d => d.time < "12:00")], ["Tarde", doses.filter(d => d.time >= "12:00" && d.time < "18:00")], ["Noche", doses.filter(d => d.time >= "18:00")]].filter(([, list]) => list.length);
  const pending = doses.filter(d => d.status === "pending" || d.status === "overdue").length;
  const lastBP = state.day.bloodPressure.at(-1);
  const plan = (state.settings.mealPlan?.[state.viewDate] || []);

  return `<main class="page active">${dateBar()}
  <section class="hero">
    <div class="hero-main">
      <div><p class="eyebrow">${greeting()}</p><h1>${escapeHTML(state.settings.personName)}</h1><p class="hero-date">${escapeHTML(formatDate(state.viewDate))}</p></div>
      <div class="progress-orbit" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.percent}" style="--progress:${c.percent * 3.6}deg"><strong>${c.percent}%</strong><span>del día</span></div>
    </div>
    <p class="hero-summary">${c.done} de ${c.total} momentos completados</p>
    <div class="now-card"><span class="now-icon" aria-hidden="true">${next.icon}</span><span><strong>${escapeHTML(next.title)}</strong><span>${escapeHTML(next.detail)}</span></span></div>
  </section>

  <div class="quick-actions">
    <button class="quick-action" data-water="250"><span aria-hidden="true">💧</span><span>+250 ml</span></button>
    <button class="quick-action" data-open-bp><span aria-hidden="true">♡</span><span>Presión</span></button>
    <button class="quick-action" data-new-note><span aria-hidden="true">📝</span><span>Nota</span></button>
    <button class="quick-action" data-page="recipes"><span aria-hidden="true">🍳</span><span>Qué cocinar</span></button>
  </div>

  ${backupBanner()}

  <div class="grid two">
  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">💊</span><h2>Tomas del día</h2></div><span class="badge ${pending ? "warn" : ""}">${doses.length} ${doses.length === 1 ? "toma" : "tomas"}${pending ? ` · ${pending} por registrar` : ""}</span></div>
    ${stockWarnings()}
    ${doses.length ? groups.map(([label, list]) => `<p class="section-label">${label}</p><div class="dose-list">${list.map(doseHTML).join("")}</div>`).join("") : `<div class="empty">No hay medicamentos programados para este día.</div>`}
    <div class="reminder-note">🔔 ${nativo.isNative()
      ? "Los avisos suenan como alarma del teléfono, aunque Mi Día esté cerrada."
      : "Los avisos llegan mientras Mi Día está abierta y, con la aplicación instalada, también un rato después de cerrarla. No reemplazan una alarma del teléfono: revisa esta pantalla cada día."}</div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🔔</span><h2>Recordatorios</h2></div><button class="btn soft small" data-add-reminder>Agregar</button></div>
    ${reminders.length ? `<div class="reminder-list">${reminders.map(reminder => `
      <div class="reminder-item ${reminder.done ? "done" : reminder.due ? "due" : ""}">
        <span class="r-icon" aria-hidden="true">${escapeHTML(reminder.icon || "🔔")}</span>
        <div><strong>${escapeHTML(reminder.title)}</strong><small>${escapeHTML(reminder.time)}${reminder.done ? ` · hecho a las ${escapeHTML(reminder.doneAt)}` : reminder.due ? " · pendiente" : ""}</small></div>
        <button class="btn ${reminder.done ? "secondary" : ""} small" data-toggle-reminder="${escapeHTML(reminder.id)}">${reminder.done ? "Deshacer" : "Listo"}</button>
      </div>`).join("")}</div>`
      : `<div class="empty">Sin recordatorios para este día.<br>Sirven para citas, caminar, medir la presión o lo que necesiten.</div>`}
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">💧</span><h2>Hidratación</h2></div><span class="badge ${state.day.waterMl >= goal ? "" : "warn"}">${state.day.waterMl >= goal ? "Meta cumplida" : "En progreso"}</span></div>
    <p class="liquid-label">Agua</p>
    <div class="water-number">${state.day.waterMl.toLocaleString("es-CL")} <span>/ ${goal.toLocaleString("es-CL")} ml</span></div>
    <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${Math.min(100, state.day.waterMl / goal * 100)}%"></div></div>
    <div class="water-actions"><button class="btn" data-water="250">+250 ml</button><button class="btn" data-water="500">+500 ml</button><button class="btn" data-water="1000">+1 litro</button><button class="btn secondary" data-other-liquid>Otro líquido</button><button class="btn secondary" data-undo-water ${state.day.waterHistory.length ? "" : "disabled"}>Deshacer</button></div>
    <div class="other-liquids"><strong>Otros líquidos: ${otherTotal.toLocaleString("es-CL")} ml</strong><span>No se suman a la meta de agua.</span>${otherLiquids.length ? `<ul>${otherLiquids.slice(-4).map(e => `<li>${escapeHTML(e.type)} · ${e.ml} ml · ${escapeHTML(e.time)}</li>`).join("")}</ul>` : ""}</div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">♡</span><h2>Presión de hoy</h2></div><button class="btn soft small" data-open-bp>Registrar</button></div>
    ${lastBP ? `<div class="water-number">${lastBP.systolic} <span>/ ${lastBP.diastolic} mmHg</span></div><p class="muted-note">Última a las ${escapeHTML(lastBP.time)} · ${lastBP.pulse} bpm · ${escapeHTML(lastBP.source || "Manual")}. ${state.day.bloodPressure.length} ${state.day.bloodPressure.length === 1 ? "medición" : "mediciones"} este día.</p><div class="actions"><button class="btn secondary small" data-page="health">Ver tendencia</button></div>` : `<div class="empty">Todavía no hay mediciones hoy.</div>`}
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🥗</span><h2>Alimentación</h2></div><span class="badge quiet">Pauta diaria</span></div>
    ${MEALS.map(meal => `<p class="section-label">${meal}</p><div class="task-list">${FOOD_TASKS.filter(t => t[2] === meal).map(([id, name, detail]) => taskHTML({ id, name, detail })).join("")}</div>`).join("")}
    <p class="section-label">Una vez al día</p>
    <div class="task-list">${FOOD_TASKS.filter(t => !MEALS.includes(t[2])).map(([id, name, detail]) => taskHTML({ id, name, detail })).join("")}</div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🌾</span><h2>Carbohidrato</h2></div><span class="badge quiet">Solo una vez</span></div>
    ${state.day.carbohydrate
      ? `<div class="carb-used"><strong>✓ Porción diaria utilizada</strong><span>${escapeHTML(state.day.carbohydrate.food)} · ${escapeHTML(state.day.carbohydrate.meal)} · ${escapeHTML(state.day.carbohydrate.time)}</span></div><div class="actions"><button class="btn secondary small" data-remove-carb>Cambiar registro</button></div>`
      : `<div class="select-row"><label class="field"><span class="field-label">Comida</span><select id="carb-meal">${MEALS.map(m => `<option>${m}</option>`).join("")}</select></label><label class="field"><span class="field-label">Alimento</span><select id="carb-food">${CARBS.map(c => `<option>${c}</option>`).join("")}</select></label></div><button class="btn" data-save-carb>Registrar porción</button>`}
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🍽️</span><h2>Qué cocinamos</h2></div><button class="btn soft small" data-page="recipes">Elegir</button></div>
    ${plan.length ? `<div class="meal-plan">${plan.map(entry => { const recipe = RECIPES.find(r => r.id === entry.recipeId); return `
      <div class="meal-slot"><span class="when">${escapeHTML(entry.meal)}</span><div><strong>${escapeHTML(recipe?.name || "Receta")}</strong><small>${entry.servings} ${entry.servings === 1 ? "porción" : "porciones"}</small></div><button class="icon-button" data-remove-plan="${escapeHTML(entry.id)}" aria-label="Quitar del plan">×</button></div>`; }).join("")}</div>`
      : `<div class="empty">Sin comidas planificadas para este día.</div>`}
  </section>

  <section class="card span-2">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">📔</span><h2>Nota del día</h2></div><button class="btn soft small" data-new-note>Nota aparte</button></div>
    <label class="field"><span class="sr-only">Observaciones del día</span><textarea id="daily-notes" placeholder="Ej.: caminó 30 minutos o se sintió cansada después de almuerzo.">${escapeHTML(state.day.notes)}</textarea></label>
    <button class="btn soft small" data-save-notes>Guardar nota del día</button>
  </section>
  </div></main>`;
}

/* ---------------------------------- Compras -------------------------------- */

function shoppingRowHTML(name, item) {
  const safe = encodeURIComponent(name);
  return `<div class="shopping-row ${item.purchased ? "purchased" : ""}">
    <button class="shop-check" data-shop-check="${safe}" aria-label="${item.purchased ? "Marcar pendiente" : "Marcar comprado"}: ${escapeHTML(name)}">${item.purchased ? "✓" : ""}</button>
    <span><strong>${escapeHTML(name)}</strong><small>${item.custom && !isInGuideline(name) ? "Producto agregado por la familia" : item.fromRecipe ? `Para ${escapeHTML(item.fromRecipe)}` : escapeHTML(categoryOf(name) || "")}</small></span>
    <div class="measure-control">
      <input type="number" min="0.01" step="0.01" value="${item.quantity}" data-grocery-amount="${safe}" aria-label="Cantidad de ${escapeHTML(name)}">
      <select data-grocery-unit="${safe}" aria-label="Unidad de ${escapeHTML(name)}">${SHOP_UNITS.map(unit => `<option ${unit === (item.unit || "unidad") ? "selected" : ""}>${unit}</option>`).join("")}</select>
      <button class="icon-button" data-remove-grocery="${safe}" aria-label="Quitar ${escapeHTML(name)}">×</button>
    </div>
  </div>`;
}

function shoppingPage() {
  const entries = shoppingEntries();
  const pending = entries.filter(([, item]) => !item.purchased).length;
  const purchased = entries.length - pending;
  const percent = entries.length ? Math.round((purchased / entries.length) * 100) : 0;
  const categoryItems = GROCERIES[state.shopCategory] || [];
  const staples = (state.settings.staples || []).filter(name => !state.settings.shoppingList?.[name]?.quantity);

  const listBody = !entries.length
    ? `<section class="empty-shopping"><strong>La lista está vacía</strong><span>Elige alimentos del catálogo o agrega un producto propio.</span><div class="actions"><button class="btn" data-add-custom>Agregar producto</button></div></section>`
    : `<section class="card">
        <div class="card-head"><div><p class="eyebrow">Lista para comprar</p><h2>Nuestra compra</h2></div><button class="btn ink small" data-share-shopping>Compartir</button></div>
        <div class="list-progress"><div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${percent}%"></div></div><b>${purchased}/${entries.length}</b></div>
        ${shoppingByAisle().map(([aisle, items]) => {
          const collapsed = state.collapsedAisles[aisle];
          const aislePending = items.filter(([, item]) => !item.purchased).length;
          return `<div class="aisle-group">
            <button class="aisle-head" data-toggle-aisle="${encodeURIComponent(aisle)}" aria-expanded="${!collapsed}">
              <span>${escapeHTML(aisle)} <small>${aislePending ? `${aislePending} por llevar` : "todo en el carro"}</small></span><span aria-hidden="true">${collapsed ? "▾" : "▴"}</span>
            </button>
            ${collapsed ? "" : `<div class="aisle-items">${items.map(([name, item]) => shoppingRowHTML(name, item)).join("")}</div>`}
          </div>`;
        }).join("")}
        <div class="actions">
          <button class="btn secondary small" data-add-custom>Agregar producto</button>
          ${purchased ? `<button class="btn secondary small" data-clear-purchased>Quitar los comprados</button>` : ""}
          ${entries.length ? `<button class="btn secondary small" data-pantry-from-list>Guardar comprados en la despensa</button>` : ""}
        </div>
      </section>`;

  return `<main class="page active shopping-page">
  <section class="shop-hero">
    <div class="shop-copy">
      <p class="eyebrow">Compra familiar</p>
      <h1>Al súper con la pauta clara</h1>
      <p>Esta lista contiene los alimentos indicados. Todos compramos con el mismo criterio.</p>
      <div class="shop-stats"><strong>${pending}</strong><span>productos<br>pendientes</span></div>
    </div>
    <picture><source srcset="./assets/compras-saludables.webp" type="image/webp"><img src="./assets/compras-saludables.jpg" width="1024" height="683" loading="lazy" decoding="async" alt="Canasta con verduras, frutas, pescado, huevos, legumbres y semillas permitidas por la pauta"></picture>
  </section>

  <div class="segmented" role="tablist" aria-label="Vista de compras">
    <button role="tab" aria-selected="${state.shopView === "list"}" class="${state.shopView === "list" ? "active" : ""}" data-shop-view="list">Lista</button>
    <button role="tab" aria-selected="${state.shopView === "pantry"}" class="${state.shopView === "pantry" ? "active" : ""}" data-shop-view="pantry">En casa</button>
  </div>

  ${state.shopView === "pantry" ? pantrySection() : `
  ${listBody}
  ${staples.length ? `<section class="card" style="margin-top:14px"><div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🔁</span><h2>Lo de siempre</h2></div></div><p class="muted-note" style="margin-top:0">Productos que compran habitualmente. Un toque los vuelve a poner en la lista.</p><div class="chip-row" style="margin-top:12px">${staples.map(name => `<button class="chip" data-add-grocery="${encodeURIComponent(name)}">+ ${escapeHTML(name)}</button>`).join("")}</div></section>` : ""}

  <section class="market-section">
    <div class="market-heading"><div><p class="eyebrow">Catálogo de la pauta</p><h2>¿Qué necesitamos?</h2></div><span class="safe-seal">Solo recomendado</span></div>
    <div class="category-strip" role="tablist" aria-label="Categorías de alimentos">${Object.keys(GROCERIES).map(cat => `<button role="tab" aria-selected="${cat === state.shopCategory}" class="category-chip ${cat === state.shopCategory ? "active" : ""}" data-shop-category="${escapeHTML(cat)}">${escapeHTML(cat)}</button>`).join("")}</div>
    <div class="grocery-grid">${categoryItems.map(name => {
      const item = state.settings.shoppingList?.[name];
      const inPantry = pantryHas(name);
      return `<article class="grocery-item">
        <span class="food-symbol" aria-hidden="true">${CATEGORY_SYMBOL[state.shopCategory] || "+"}</span>
        <div><strong>${escapeHTML(name)}</strong><small>${inPantry ? "✓ Hay en casa" : escapeHTML(CATEGORY_HINT[state.shopCategory] || "")}</small></div>
        <button class="add-grocery ${item?.quantity ? "added" : ""}" data-add-grocery="${encodeURIComponent(name)}" aria-label="Agregar ${escapeHTML(name)} a la compra">${item?.quantity ? `+ ${item.quantity}` : "+"}</button>
      </article>`;
    }).join("")}</div>
  </section>

  <section class="avoid-band">
    <div><span aria-hidden="true">×</span><strong>Fuera de esta lista</strong></div>
    <p>Azúcar, miel, jugos, pan y arroz blancos, pastas, frituras, comida rápida, postres, dulces, alcohol y bebidas light.</p>
  </section>`}
  </main>`;
}

/** Despensa: qué hay en casa. Alimenta al recetario y evita comprar de más. */
function pantrySection() {
  const pantry = state.settings.pantry || {};
  const available = Object.entries(pantry).filter(([, v]) => v.available).map(([name]) => name);
  const out = Object.entries(pantry).filter(([, v]) => !v.available).map(([name]) => name);

  return `<section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🥫</span><h2>Qué hay en casa</h2></div><span class="badge">${available.length} disponibles</span></div>
    <p class="muted-note" style="margin-top:0">Marca lo que tienes. El recetario usa esta información para decirte qué puedes cocinar ahora y qué falta comprar.</p>
    ${out.length ? `<p class="section-label">Se acabó</p><div class="chip-row">${out.map(name => `<button class="chip" data-add-grocery="${encodeURIComponent(name)}">+ Comprar ${escapeHTML(name)}</button>`).join("")}</div>` : ""}
    ${Object.entries(GROCERIES).map(([category, items]) => `
      <p class="section-label">${escapeHTML(category)}</p>
      <div class="pantry-grid">${items.map(name => {
        const stateOf = pantry[name];
        return `<div class="pantry-item">
          <span><strong>${escapeHTML(name)}</strong><small>${stateOf ? (stateOf.available ? "Hay en casa" : "Se acabó") : "Sin marcar"}</small></span>
          <span class="pantry-state">
            <button class="${stateOf?.available ? "on" : ""}" data-pantry="${encodeURIComponent(name)}" data-pantry-value="yes" aria-label="${escapeHTML(name)}: hay en casa" title="Hay en casa">✓</button>
            <button class="${stateOf && !stateOf.available ? "on out" : ""}" data-pantry="${encodeURIComponent(name)}" data-pantry-value="no" aria-label="${escapeHTML(name)}: se acabó" title="Se acabó">∅</button>
          </span>
        </div>`;
      }).join("")}</div>`).join("")}
  </section>`;
}

/* ---------------------------------- Recetas -------------------------------- */

const RECIPE_FILTERS = [["todas", "Todas"], ["puedo", "Puedo cocinar ahora"], ["favoritas", "Favoritas"], ["Desayuno", "Desayuno"], ["Almuerzo", "Almuerzo"], ["Cena", "Cena"]];

function visibleRecipes() {
  const pantry = state.settings.pantry || {};
  let list = searchRecipes(RECIPES, state.recipeQuery);
  const filter = state.recipeFilter;
  if (filter === "favoritas") list = list.filter(recipe => (state.settings.favoriteRecipes || []).includes(recipe.id));
  else if (filter === "puedo") list = list.filter(recipe => pantryMatch(recipe, pantry).complete);
  else if (filter !== "todas") list = list.filter(recipe => recipe.meals.includes(filter));
  return list;
}

function recipesPage() {
  const pantry = state.settings.pantry || {};
  const favorites = state.settings.favoriteRecipes || [];
  const list = visibleRecipes();
  const marked = Object.values(pantry).length;

  return `<main class="page active">
  <div class="page-heading"><p class="eyebrow">Cocinar con la pauta</p><h1>Recetas</h1><p>Preparaciones que usan solo alimentos de la pauta. Las porciones diarias de carbohidrato y grasa siguen mandando.</p></div>

  <div class="search-field"><label class="sr-only" for="recipe-search">Buscar receta o ingrediente</label><input id="recipe-search" type="search" placeholder="Buscar: pollo, rápida, sin carbohidrato…" value="${escapeHTML(state.recipeQuery)}" data-recipe-search></div>
  <div class="chip-row" style="margin-bottom:16px">${RECIPE_FILTERS.map(([id, label]) => `<button class="chip ${state.recipeFilter === id ? "active" : ""}" data-recipe-filter="${id}">${label}</button>`).join("")}</div>

  ${!marked ? `<div class="notice">Marca en <strong>Súper → En casa</strong> lo que tienes y aquí verás qué puedes cocinar ahora mismo y qué falta comprar.</div>` : ""}

  ${list.length ? `<div class="recipe-grid" style="margin-top:16px">${list.map(recipe => {
    const match = pantryMatch(recipe, pantry);
    const fav = favorites.includes(recipe.id);
    return `<article class="recipe-card">
      <div class="recipe-top">
        <span class="tag">${recipe.minutes} min</span>
        <button class="fav-btn ${fav ? "on" : ""}" data-fav-recipe="${recipe.id}" aria-label="${fav ? "Quitar de favoritas" : "Marcar como favorita"}: ${escapeHTML(recipe.name)}" aria-pressed="${fav}">${fav ? "★" : "☆"}</button>
      </div>
      <h3>${escapeHTML(recipe.name)}</h3>
      <p>${escapeHTML(recipe.meals.join(" · "))}${recipe.note ? ` — ${escapeHTML(recipe.note)}` : ""}</p>
      <div class="chip-row">${recipe.tags.map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div>
      ${marked ? `<p class="recipe-match ${match.complete ? "" : "partial"}">${match.complete ? "✓ Tienes todo en casa" : `Faltan ${match.missing.length}: ${escapeHTML(match.missing.slice(0, 2).join(", "))}${match.missing.length > 2 ? "…" : ""}`}</p>` : ""}
      <button class="btn secondary small" data-recipe="${recipe.id}">Ver preparación</button>
    </article>`;
  }).join("")}</div>`
  : `<section class="empty-shopping"><strong>Ninguna receta coincide</strong><span>Prueba con otra palabra o quita los filtros.</span></section>`}
  </main>`;
}

/* ----------------------------------- Notas --------------------------------- */

function noteKind(id) { return NOTE_KINDS.find(kind => kind.id === id) || NOTE_KINDS[0]; }

function visibleNotes() {
  const term = state.noteQuery.trim().toLowerCase();
  return state.notes
    .filter(note => state.noteFilter === "todas" || note.kind === state.noteFilter)
    .filter(note => !term || `${note.title} ${note.body}`.toLowerCase().includes(term))
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function notesPage() {
  const list = visibleNotes();
  const questions = state.notes.filter(note => note.kind === "pregunta").length;

  return `<main class="page active">
  <div class="page-heading"><p class="eyebrow">Para no olvidar</p><h1>Notas</h1><p>Preguntas para el médico, síntomas, indicaciones y recordatorios sueltos. Las preguntas se incluyen en el informe de la consulta.</p></div>

  <div class="actions" style="margin:0 0 16px"><button class="btn" data-new-note>Escribir nota</button>${questions ? `<span class="badge">${questions} ${questions === 1 ? "pregunta" : "preguntas"} para el médico</span>` : ""}</div>

  <div class="search-field"><label class="sr-only" for="note-search">Buscar en las notas</label><input id="note-search" type="search" placeholder="Buscar en las notas…" value="${escapeHTML(state.noteQuery)}" data-note-search></div>
  <div class="chip-row" style="margin-bottom:16px">
    <button class="chip ${state.noteFilter === "todas" ? "active" : ""}" data-note-filter="todas">Todas</button>
    ${NOTE_KINDS.map(kind => `<button class="chip ${state.noteFilter === kind.id ? "active" : ""}" data-note-filter="${kind.id}">${kind.icon} ${escapeHTML(kind.label)}</button>`).join("")}
  </div>

  ${list.length ? `<div class="note-grid">${list.map(note => `
    <article class="note-card kind-${escapeHTML(note.kind)} ${note.pinned ? "pinned" : ""}">
      <div class="note-head">
        <h3>${escapeHTML(note.title || noteKind(note.kind).label)}</h3>
        <button class="fav-btn ${note.pinned ? "on" : ""}" data-pin-note="${escapeHTML(note.id)}" aria-label="${note.pinned ? "Quitar de fijadas" : "Fijar nota"}" aria-pressed="${!!note.pinned}">${note.pinned ? "★" : "☆"}</button>
      </div>
      <p class="note-body">${escapeHTML(note.body.length > 260 ? `${note.body.slice(0, 260)}…` : note.body)}</p>
      <div class="note-foot">
        <span>${noteKind(note.kind).icon} ${escapeHTML(noteKind(note.kind).label)} · ${escapeHTML(formatDate(String(note.updatedAt).slice(0, 10), { day: "numeric", month: "short" }))}</span>
        <button class="text-button" data-edit-note="${escapeHTML(note.id)}" style="margin:0">Abrir</button>
      </div>
    </article>`).join("")}</div>`
    : `<section class="empty-shopping"><strong>${state.noteQuery || state.noteFilter !== "todas" ? "Ninguna nota coincide" : "Todavía no hay notas"}</strong><span>${state.noteQuery || state.noteFilter !== "todas" ? "Prueba con otra palabra o quita los filtros." : "Anota una duda para la próxima consulta o algo que quieras recordar."}</span></section>`}
  </main>`;
}

/* ----------------------------------- Salud --------------------------------- */

function windowPicker() {
  return `<div class="window-picker" role="tablist" aria-label="Período">${[7, 30, 90].map(days =>
    `<button role="tab" aria-selected="${state.statsWindow === days}" class="chip ${state.statsWindow === days ? "active" : ""}" data-stats-window="${days}">${days} días</button>`).join("")}</div>`;
}

function healthPage() {
  const windowDays = state.statsWindow;
  const meds = adherence(state.days, windowDays);
  const streak = perfectDayStreak(state.days);
  const perMed = adherenceByMedication(state.days, windowDays);
  const histogram = intakeHistogram(state.days, windowDays);
  const maxCount = Math.max(1, ...histogram.map(bucket => bucket.count));
  const water = hydrationSeries(state.days, Math.min(windowDays, 14));
  const points = bloodPressureSeries(state.days, windowDays);
  const summary = bloodPressureSummary(points);
  const byTime = bloodPressureByTimeOfDay(points);
  const readings = state.day.bloodPressure;
  const last = readings.at(-1);

  const month = dateFromKey(state.viewDate), year = month.getFullYear(), mon = month.getMonth();
  const first = new Date(year, mon, 1, 12), count = new Date(year, mon + 1, 0, 12).getDate();
  const cells = Array.from({ length: (first.getDay() + 6) % 7 }, () => "<span></span>");
  for (let d = 1; d <= count; d += 1) {
    const key = localDateKey(new Date(year, mon, d, 12));
    const found = state.days.find(x => x.date === key);
    const pct = found ? completion(found, state.settings.waterGoal).percent : null;
    cells.push(`<button class="${pct === 100 ? "complete" : pct !== null ? "partial" : ""} ${key === state.viewDate ? "selected" : ""}" data-pick-day="${key}" ${key > localDateKey() ? "disabled" : ""} title="${pct === null ? "Sin información" : `${pct}% completado`}">${d}</button>`);
  }
  const days = [...state.days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

  return `<main class="page active signs-page">
  <div class="page-heading"><p class="eyebrow">Seguimiento</p><h1>Salud de ${escapeHTML(state.settings.personName)}</h1><p>Lo registrado y sus promedios. Mi Día no clasifica ni interpreta las cifras: eso corresponde a su médico.</p></div>

  ${last ? `<section class="vitals-ticket">
    <div><span>Última presión</span><strong>${last.systolic}<small> / ${last.diastolic}</small></strong><em>mmHg</em></div>
    <div><span>Pulso</span><strong>${last.pulse}</strong><em>bpm</em></div>
    <time>${escapeHTML(last.time)}<br>${escapeHTML(last.source || "Manual")}</time>
  </section>` : ""}

  ${windowPicker()}

  <div class="grid two">
  <section class="card span-2">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">📈</span><h2>Tendencia de presión</h2></div><span class="badge quiet">${points.length} ${points.length === 1 ? "lectura" : "lecturas"}</span></div>
    <div class="chart">${bpChartSVG(points, { windowDays })}</div>
    ${summary ? `<div class="metric-row">
      <div class="metric"><strong>${summary.systolic} / ${summary.diastolic}</strong><span>promedio</span><small>mmHg</small></div>
      <div class="metric"><strong>${summary.pulse ?? "—"}</strong><span>pulso promedio</span><small>bpm</small></div>
      <div class="metric"><strong>${summary.systolicMin}–${summary.systolicMax}</strong><span>rango sistólica</span><small>mmHg</small></div>
      <div class="metric"><strong>${summary.diastolicMin}–${summary.diastolicMax}</strong><span>rango diastólica</span><small>mmHg</small></div>
    </div>
    <table class="data-table"><caption class="sr-only">Promedios por tramo del día</caption><thead><tr><th scope="col">Tramo</th><th scope="col">Lecturas</th><th scope="col">Presión</th><th scope="col">Pulso</th></tr></thead><tbody>${byTime.map(bucket => `<tr><td>${bucket.label}<small> ${bucket.hint}</small></td><td>${bucket.count}</td><td>${bucket.systolic ? `${bucket.systolic} / ${bucket.diastolic}` : "—"}</td><td>${bucket.pulse ?? "—"}</td></tr>`).join("")}</tbody></table>
    <p class="muted-note">Promedios de lo registrado. Llévalos a la consulta; la interpretación corresponde a su médico.</p>` : `<div class="empty">Aún no hay lecturas en el período.</div>`}
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">♡</span><h2>Mediciones del ${isToday() ? "día" : escapeHTML(formatDate(state.viewDate, { day: "numeric", month: "long" }))}</h2></div><button class="btn soft small" data-open-bp>Agregar</button></div>
    ${readings.length ? `<div class="bp-readings">${readings.map(r => `<div class="reading"><time>${escapeHTML(r.time)}</time><div><strong>${r.systolic} / ${r.diastolic}</strong><br><span>${r.pulse} bpm · ${escapeHTML(r.source || "Manual")}</span></div><button class="icon-button" data-delete-bp="${escapeHTML(r.id)}" aria-label="Eliminar medición">×</button></div>`).join("")}</div>` : `<div class="empty">Todavía no hay mediciones en este día.</div>`}
  </section>

  <section class="card report-card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🖨️</span><h2>Informe para la consulta</h2></div></div>
    <p>Reúne lecturas, promedios, tomas, preguntas anotadas y observaciones del período en un documento que puedes imprimir o guardar como PDF.</p>
    <div class="actions"><button class="btn" data-open-report>Ver informe de ${windowDays} días</button><button class="btn secondary" data-export-bp-csv>Presión en CSV</button><button class="btn secondary" data-export-intakes-csv>Tomas en CSV</button></div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">💊</span><h2>Tomas registradas</h2></div><span class="badge quiet">${windowDays} días</span></div>
    <div class="metric-row">
      <div class="metric"><strong>${meds.percent === null ? "—" : `${meds.percent}%`}</strong><span>registradas</span><small>${meds.taken} de ${meds.scheduled}</small></div>
      <div class="metric"><strong>${meds.missed}</strong><span>sin registro</span><small>tomas</small></div>
      <div class="metric"><strong>${meds.skipped}</strong><span>omitidas</span><small>a propósito</small></div>
      <div class="metric"><strong>${streak}</strong><span>${streak === 1 ? "día seguido" : "días seguidos"}</span><small>con todo registrado</small></div>
    </div>
    ${meds.scheduled ? `<div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${meds.percent}%"></div></div>` : `<div class="empty">Sin tomas programadas en el período.</div>`}
    <p class="muted-note">Un registro faltante no significa que la dosis no se tomó: puede que no se haya anotado.</p>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">⏱</span><h2>A qué hora se registran</h2></div></div>
    <div class="histogram">${histogram.map(bucket => `<div class="histogram-bar"><div class="bar" style="--height:${Math.round(bucket.count / maxCount * 100)}%" aria-hidden="true"></div><strong>${bucket.count}</strong><span>${bucket.label}</span><small>${bucket.hint}</small></div>`).join("")}</div>
  </section>

  ${perMed.length ? `<section class="card span-2"><div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">📋</span><h2>Por medicamento</h2></div><span class="badge quiet">Menor cumplimiento primero</span></div><div class="per-med">${perMed.map(row => `<div class="per-med-row"><div><strong>${escapeHTML(row.name)}</strong><small>${row.taken} de ${row.scheduled} tomas</small></div><div class="per-med-bar" aria-hidden="true"><span style="width:${row.percent ?? 0}%"></span></div><b>${row.percent === null ? "—" : `${row.percent}%`}</b></div>`).join("")}</div></section>` : ""}

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">💧</span><h2>Agua por día</h2></div><span class="badge quiet">${water.length} días</span></div>
    <div class="water-bars">${water.map(item => `<div class="water-bar" title="${escapeHTML(formatDate(item.date, { day: "numeric", month: "short" }))}: ${item.waterMl} ml"><div class="bar ${item.waterMl >= item.goal ? "reached" : ""}" style="--height:${Math.min(100, Math.round(item.waterMl / item.goal * 100))}%" aria-hidden="true"></div><small>${escapeHTML(formatDate(item.date, { day: "numeric" }))}</small></div>`).join("")}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>${escapeHTML(new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(month))}</h2><span class="badge quiet">✓ completo</span></div>
    <div class="month-grid"><span class="head">L</span><span class="head">M</span><span class="head">M</span><span class="head">J</span><span class="head">V</span><span class="head">S</span><span class="head">D</span>${cells.join("")}</div>
    <p class="muted-note">Toca un día para abrirlo y completar lo que falte.</p>
  </section>

  <section class="device-card span-2">
    <div class="watch-face"><span aria-hidden="true">♡</span><b>D3</b></div>
    <div class="device-copy"><span class="connection-status">○ Pendiente de vincular</span><h2>Huawei Watch D3</h2><p>Cuando llegue el reloj, conectaremos las lecturas autorizadas de presión y pulso desde Huawei Health.</p><button class="btn secondary small" data-device-info>Ver plan de conexión</button></div>
  </section>
  </div>

  <div class="history-list">${days.length ? days.map(day => {
    const c = completion(day, state.settings.waterGoal);
    const open = state.historyOpen === day.id;
    const doses = dayDoses(day);
    return `<div class="history-day">
      <button class="history-summary" data-history="${day.id}" aria-expanded="${open}">
        <div class="history-top"><strong>${escapeHTML(formatDate(day.date))}</strong><span class="badge ${c.percent < 100 ? "warn" : ""}">${c.percent}%</span></div>
        <p>💧 ${day.waterMl.toLocaleString("es-CL")} ml · ♡ ${day.bloodPressure.length} mediciones · 💊 ${doses.filter(d => d.intake).length}/${doses.length} tomas</p>
      </button>
      ${open ? `<div class="history-detail">
        <p><strong>Presión:</strong> ${day.bloodPressure.length ? day.bloodPressure.map(r => `${r.systolic}/${r.diastolic} (${escapeHTML(r.time)})`).join(" · ") : "Sin registros"}</p>
        <p><strong>Tomas:</strong> ${doses.length ? doses.map(d => `${escapeHTML(d.name)} ${d.time} ${d.intake ? "✓" : d.skipped ? "omitida" : "—"}`).join(" · ") : "Sin medicamentos"}</p>
        <p><strong>Nota:</strong> ${escapeHTML(day.notes || "Sin observaciones")}</p>
        <button class="btn secondary small" data-pick-day="${day.id}">Abrir este día</button>
      </div>` : ""}
    </div>`;
  }).join("") : `<section class="card empty">Aún no hay días guardados.</section>`}</div>
  </main>`;
}

/* -------------------------------- Compañera -------------------------------- */

function assistantPage() {
  return `<main class="page active assistant-page">
  <div class="page-heading"><p class="eyebrow">Acompañamiento familiar</p><h1>Compañera Mi Día</h1><p>Ayuda para organizarse, usar la agenda y cocinar con la pauta. No entrega diagnósticos ni cambia tratamientos.</p></div>
  <section class="assistant-shell">
    <div class="assistant-boundary"><strong>Puede ayudarte con</strong><span>Rutina · aplicación · compras · recetas · preguntas para el médico</span></div>
    <div class="chat-thread" id="chat-thread" aria-live="polite">${state.chatMessages.map(message => `<div class="chat-message ${message.role}"><span aria-hidden="true">${message.role === "assistant" ? "✦" : "Tú"}</span><p>${escapeHTML(message.content)}</p></div>`).join("")}${state.chatBusy ? `<div class="chat-message assistant waiting"><span aria-hidden="true">✦</span><p>Estoy pensando…</p></div>` : ""}</div>
    <form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-input">Mensaje para Compañera Mi Día</label><textarea id="chat-input" name="message" maxlength="1200" rows="2" required placeholder="Ej.: ¿Qué podemos cocinar con pollo, brócoli y zapallo italiano?" ${state.chatBusy ? "disabled" : ""}></textarea><button class="btn ink" type="submit" ${state.chatBusy ? "disabled" : ""}>Enviar</button></form>
    <div class="chat-footer"><p class="chat-notice">No escribas información que no sea necesaria. En una urgencia llama al SAMU 131.</p>${state.chatMessages.length > 1 ? `<button class="text-button" data-clear-chat>Borrar conversación</button>` : ""}</div>
  </section></main>`;
}

/* ---------------------------------- Ajustes -------------------------------- */

function settingsPage() {
  const scales = [[1, "Normal"], [1.15, "Grande"], [1.3, "Muy grande"], [1.5, "Máxima"]];
  const themes = [["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]];
  const reminders = state.settings.reminders || [];

  return `<main class="page active">
  <div class="page-heading"><h1>Ajustes</h1><p>La pauta puede cambiar sin borrar los días anteriores.</p></div>
  <div class="settings-grid">

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">⚙</span><h2>Datos generales</h2></div></div>
    <label class="field"><span class="field-label">Nombre mostrado</span><input id="person-name" type="text" value="${escapeHTML(state.settings.personName)}"></label>
    <label class="field"><span class="field-label">Meta diaria de agua</span><select id="water-goal">${[2000, 2250, 2500, 2750, 3000].map(v => `<option value="${v}" ${v === state.settings.waterGoal ? "selected" : ""}>${v.toLocaleString("es-CL")} ml</option>`).join("")}</select></label>
    <label class="field"><span class="field-label">Porciones habituales al cocinar</span><input id="default-servings" type="number" min="1" max="12" value="${state.settings.defaultServings || 4}"></label>
    <div class="actions"><button class="btn" data-save-general>Guardar cambios</button></div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🔔</span><h2>Avisos</h2></div></div>
    <div class="actions" style="margin-top:0"><button class="btn ${state.settings.notificationsEnabled ? "secondary" : ""}" data-enable-reminders>${state.settings.notificationsEnabled ? "Avisos activados" : "Activar avisos"}</button><button class="btn secondary" data-test-notification>Probar aviso</button></div>
    <label class="task"><input type="checkbox" data-toggle-pref="soundEnabled" ${state.settings.soundEnabled ? "checked" : ""}><span><strong>Sonido de campana</strong><small>Suena al llegar la hora de un medicamento o recordatorio.</small></span></label>
    <label class="task"><input type="checkbox" data-toggle-pref="hapticsEnabled" ${state.settings.hapticsEnabled ? "checked" : ""}><span><strong>Vibración</strong><small>Confirma cada registro con una vibración corta.</small></span></label>
    <p class="reminder-note">${nativo.isNative()
      ? "Los avisos los programa el sistema como alarmas exactas, así que suenan aunque Mi Día esté cerrada. Si Android pide permiso de «alarmas y recordatorios», hay que concederlo."
      : "Los avisos llegan mientras Mi Día está abierta y, con la aplicación instalada, durante un rato después de cerrarla. El navegador no garantiza una alarma a la hora exacta con la aplicación cerrada: para eso está la aplicación Android."}</p>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">👁</span><h2>Lectura y accesibilidad</h2></div></div>
    <div class="field"><span class="field-label">Tamaño del texto</span><div class="scale-picker">${scales.map(([value, label]) => `<button class="chip ${Number(state.settings.textScale) === value ? "active" : ""}" data-text-scale="${value}">${label}</button>`).join("")}</div></div>
    <div class="field"><span class="field-label">Tema</span><div class="scale-picker">${themes.map(([value, label]) => `<button class="chip ${(state.settings.theme || "auto") === value ? "active" : ""}" data-theme-choice="${value}">${label}</button>`).join("")}</div></div>
    <label class="task"><input type="checkbox" data-toggle-pref="highContrast" ${state.settings.highContrast ? "checked" : ""}><span><strong>Más contraste</strong><small>Bordes y textos más marcados, útil con poca luz o vista cansada.</small></span></label>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">📦</span><h2>Copia de seguridad</h2></div></div>
    <p class="muted-note" style="margin-top:0">Guarda una copia JSON fuera del navegador. Incluye días, notas y configuración.</p>
    <p class="backup-state">${state.settings.lastBackupAt ? `Última copia: ${escapeHTML(new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date(state.settings.lastBackupAt)))}` : "Aún no se ha exportado ninguna copia."}</p>
    <div class="actions"><button class="btn" data-export>Exportar datos</button><button class="btn secondary" data-import>Importar datos</button><input class="sr-only" id="import-file" type="file" accept="application/json"></div>
    <p class="storage-state" id="storage-state"></p>
  </section>

  <section class="card span-2">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🔔</span><h2>Recordatorios</h2></div><button class="btn soft small" data-add-reminder>Agregar</button></div>
    ${reminders.length ? reminders.map(reminder => `<div class="med-editor ${reminder.active === false ? "inactive" : ""}"><div class="med-summary"><div><strong>${escapeHTML(reminder.icon || "🔔")} ${escapeHTML(reminder.title)}</strong><p>${escapeHTML(reminder.time)} · ${reminder.repeat === "once" ? `una vez el ${escapeHTML(reminder.date || "")}` : reminder.repeat === "weekly" ? `cada ${(reminder.weekdays || []).map(d => WEEKDAYS.find(w => w[0] === String(d))?.[1]).join(", ")}` : "todos los días"}${reminder.active === false ? " · pausado" : ""}</p></div><button class="btn secondary small" data-edit-reminder="${escapeHTML(reminder.id)}">Editar</button></div></div>`).join("")
      : `<div class="empty">Sin recordatorios.<br>Sirven para citas médicas, caminar, medir la presión o lo que necesiten.</div>
         <div class="actions"><button class="btn secondary small" data-suggest-reminders>Agregar los sugeridos</button></div>`}
  </section>

  <section class="card span-2">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">💊</span><h2>Medicamentos</h2></div><button class="btn soft small" data-add-med>Agregar</button></div>
    ${state.settings.medications.length ? state.settings.medications.map(med => {
      const forecast = stockForecast(med);
      return `<div class="med-editor ${med.active === false ? "inactive" : ""}"><div class="med-summary"><div><strong>${escapeHTML(med.name)}</strong><p>${escapeHTML([med.dosage, med.amount, medTimes(med).join(", "), med.period === "daily" ? "Diario" : `Cada ${med.everyDays} días`].filter(Boolean).join(" · "))}</p>${forecast ? `<small class="stock-note ${forecast.days <= 7 ? "low" : ""}">Existencias: ${forecast.remaining} ${escapeHTML(unitLabel(forecast.remaining, med.doseUnit))} · alcanza ~${forecast.days} ${forecast.days === 1 ? "día" : "días"}</small>` : ""}${med.active === false ? `<small class="stock-note">Tratamiento pausado</small>` : ""}</div><button class="btn secondary small" data-edit-med="${escapeHTML(med.id)}">Editar</button></div></div>`;
    }).join("") : `<div class="empty">Sin medicamentos en la pauta.</div>`}
  </section>

  <section class="card span-2">
    <div class="card-head"><div class="card-title"><span class="icon" aria-hidden="true">🥬</span><h2>Resumen de la pauta</h2></div></div>
    <div class="grid two">
      <div><h3>Permitido según pauta</h3><ul class="info-list"><li>Verduras sin restricción indicada.</li><li>Proteína en cada comida.</li><li>Fruta: una porción al día.</li><li>Grasa saludable: una vez al día.</li><li>Carbohidrato complejo: máximo 100 g cocidos, una vez al día.</li><li>Agua: entre 2 y 2,5 litros según meta configurada.</li></ul></div>
      <div><h3>Evitar o limitar</h3><ul class="info-list"><li>Azúcar, miel, jugos y postres.</li><li>Pan y arroz blancos, pastas.</li><li>Frituras y comida rápida.</li><li>Alcohol y bebidas light.</li><li>Café, según la indicación recibida.</li></ul></div>
    </div>
  </section>
  </div></main>`;
}

/* ---------------------------------- Modales -------------------------------- */

function modalHTML() {
  if (!state.modal) return "";
  const close = `<button type="button" class="icon-button ghost" data-close-modal aria-label="Cerrar">×</button>`;
  const type = typeof state.modal === "string" ? state.modal : state.modal.type;

  if (type === "confirm") return `<div class="modal-backdrop" data-close-modal><section class="modal confirm-modal" role="alertdialog" aria-labelledby="confirm-title">
    <div class="modal-head"><div><h2 id="confirm-title">${escapeHTML(state.modal.title)}</h2></div>${close}</div>
    <p class="confirm-body">${escapeHTML(state.modal.body)}</p>
    <div class="actions"><button class="btn ${state.modal.danger ? "danger" : ""}" data-confirm-yes>${escapeHTML(state.modal.confirmLabel)}</button><button class="btn secondary" type="button" data-close-modal>Cancelar</button></div>
  </section></div>`;

  if (type === "bp") return `<div class="modal-backdrop" data-close-modal><form class="modal" id="bp-form"><div class="modal-head"><div><p class="eyebrow">Nueva lectura</p><h2>Registrar presión</h2></div>${close}</div>
    <div class="select-row"><label class="field"><span class="field-label">Sistólica</span><input name="systolic" type="number" inputmode="numeric" min="50" max="300" required placeholder="128"></label><label class="field"><span class="field-label">Diastólica</span><input name="diastolic" type="number" inputmode="numeric" min="30" max="200" required placeholder="79"></label></div>
    <div class="select-row"><label class="field"><span class="field-label">Pulso</span><input name="pulse" type="number" inputmode="numeric" min="20" max="250" required placeholder="67"></label><label class="field"><span class="field-label">Hora</span><input name="time" type="time" required value="${formatTime()}"></label></div>
    <label class="field"><span class="field-label">Día</span><input name="date" type="date" required value="${state.viewDate}" max="${localDateKey()}"></label>
    <label class="field"><span class="field-label">Origen</span><select name="source"><option>Manual</option><option>Huawei Watch D3</option><option>Otro tensiómetro</option></select></label>
    <div class="actions"><button class="btn" type="submit">Guardar medición</button><button class="btn secondary" type="button" data-close-modal>Cancelar</button></div></form></div>`;

  if (type === "device") return `<div class="modal-backdrop" data-close-modal><section class="modal"><div class="modal-head"><div><p class="eyebrow">Conexión futura</p><h2>Huawei Health + Mi Día</h2></div>${close}</div>
    <div class="connection-steps">
      <div><b>1</b><span><strong>Reloj sincronizado</strong><small>El D3 envía sus mediciones a Huawei Health.</small></span></div>
      <div><b>2</b><span><strong>Permiso de Huawei</strong><small>Registraremos la aplicación y solicitaremos acceso de solo lectura para presión y pulso.</small></span></div>
      <div><b>3</b><span><strong>Autorización de ella</strong><small>Tu mamá inicia sesión con su Huawei ID y decide qué datos compartir.</small></span></div>
      <div><b>4</b><span><strong>Importación segura</strong><small>Mi Día incorpora hora, presión y pulso sin interpretar los valores.</small></span></div>
    </div>
    <div class="notice">No activaremos una conexión falsa. Este botón cambiará a «Vincular reloj» cuando tengamos la aplicación Huawei registrada y aprobada.</div>
    <div class="actions"><button type="button" class="btn secondary" data-close-modal>Entendido</button></div></section></div>`;

  if (type === "liquid") return `<div class="modal-backdrop" data-close-modal><form class="modal" id="liquid-form"><div class="modal-head"><div><p class="eyebrow">Hidratación</p><h2>Registrar otro líquido</h2></div>${close}</div>
    <label class="field"><span class="field-label">Tipo</span><select name="type"><option>Infusión</option><option>Café</option><option>Jugo</option><option>Leche</option><option>Otro</option></select></label>
    <div class="select-row"><label class="field"><span class="field-label">Cantidad</span><input name="amount" type="number" min="1" required value="250"></label><label class="field"><span class="field-label">Unidad</span><select name="unit"><option>ml</option><option>L</option></select></label></div>
    <label class="field"><span class="field-label">Hora</span><input name="time" type="time" required value="${formatTime()}"></label>
    <div class="notice">Quedará separado y no aumentará la meta de agua.</div>
    <div class="actions"><button class="btn" type="submit">Guardar líquido</button><button class="btn secondary" type="button" data-close-modal>Cancelar</button></div></form></div>`;

  if (type === "custom-item") return `<div class="modal-backdrop" data-close-modal><form class="modal" id="custom-item-form"><div class="modal-head"><div><p class="eyebrow">Compra familiar</p><h2>Agregar producto</h2></div>${close}</div>
    <label class="field"><span class="field-label">Producto</span><input name="name" required placeholder="Ej.: Detergente" autocomplete="off"></label>
    <div class="select-row"><label class="field"><span class="field-label">Cantidad</span><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></label><label class="field"><span class="field-label">Unidad</span><select name="unit">${SHOP_UNITS.map(unit => `<option>${unit}</option>`).join("")}</select></label></div>
    <label class="task"><input type="checkbox" name="staple"><span><strong>Guardar en «lo de siempre»</strong><small>Para volver a agregarlo con un toque en la próxima compra.</small></span></label>
    <div class="notice">Los productos que no están en el catálogo quedan marcados como agregados por la familia: la pauta de alimentación no los incluye.</div>
    <div class="actions"><button class="btn" type="submit">Agregar a la lista</button><button class="btn secondary" type="button" data-close-modal>Cancelar</button></div></form></div>`;

  if (type === "intake") {
    const dose = dayDoses(state.day).find(d => d.doseId === state.modal.id);
    if (!dose) return "";
    const intake = dose.intake;
    const med = state.settings.medications.find(m => m.id === dose.medId);
    return `<div class="modal-backdrop" data-close-modal><form class="modal" id="intake-form"><div class="modal-head"><div><p class="eyebrow">Confirmar toma</p><h2>${escapeHTML(dose.name)}</h2></div>${close}</div>
      <input type="hidden" name="doseId" value="${escapeHTML(dose.doseId)}">
      <div class="prescription-box"><span>Indicación programada · ${escapeHTML(dose.time)}</span><strong>${escapeHTML([dose.dosage, dose.amount].filter(Boolean).join(" · "))}</strong><small>${escapeHTML(dose.instructions || "")}</small></div>
      <div class="select-row"><label class="field"><span class="field-label">Cantidad que tomó</span><input name="actualAmount" type="number" min="0.01" step="0.01" required value="${intake?.actualAmount ?? dose.doseValue ?? 1}"></label><label class="field"><span class="field-label">Unidad</span><input name="unit" required value="${escapeHTML(intake?.unit || dose.doseUnit || "unidad")}"></label></div>
      <label class="field"><span class="field-label">Hora real</span><input name="time" type="time" required value="${escapeHTML(intake?.time || formatTime())}"></label>
      <label class="field"><span class="field-label">Nota opcional</span><input name="note" value="${escapeHTML(intake?.note || "")}" placeholder="Ej.: después de desayunar"></label>
      ${med && Number.isFinite(Number(med.stockCount)) ? `<div class="notice">${med.stockCount === 1 ? "Queda" : "Quedan"} ${med.stockCount} ${escapeHTML(unitLabel(med.stockCount, med.doseUnit))} en existencias; al confirmar se descuenta la cantidad registrada.</div>` : ""}
      <div class="actions"><button class="btn" type="submit">Confirmar que la tomó</button>${intake ? `<button class="btn danger" type="button" data-remove-intake="${escapeHTML(dose.doseId)}">Eliminar registro</button>` : ""}</div></form></div>`;
  }

  if (type === "recipe") {
    const recipe = RECIPES.find(r => r.id === state.modal.id);
    if (!recipe) return "";
    const servings = state.modal.servings || state.settings.defaultServings || 4;
    const pantry = state.settings.pantry || {};
    const scaled = scaleRecipe(recipe, servings);
    const match = pantryMatch(recipe, pantry);
    const fav = (state.settings.favoriteRecipes || []).includes(recipe.id);
    return `<div class="modal-backdrop" data-close-modal><section class="modal wide"><div class="modal-head"><div><p class="eyebrow">Receta para la familia</p><h2>${escapeHTML(recipe.name)}</h2></div>${close}</div>
      <div class="recipe-meta"><span class="tag">${recipe.minutes} min</span><span class="tag">${escapeHTML(recipe.meals.join(" · "))}</span>${recipe.tags.map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}${usesCarbohydrate(recipe) ? `<span class="tag">Usa el carbohidrato del día</span>` : ""}</div>
      <div class="servings-stepper">
        <button class="icon-button" data-servings="-1" aria-label="Menos porciones" ${servings <= 1 ? "disabled" : ""}>−</button>
        <strong>${servings} ${servings === 1 ? "porción" : "porciones"}</strong>
        <button class="icon-button" data-servings="1" aria-label="Más porciones" ${servings >= 12 ? "disabled" : ""}>+</button>
        <button class="fav-btn ${fav ? "on" : ""}" data-fav-recipe="${recipe.id}" aria-label="${fav ? "Quitar de favoritas" : "Marcar como favorita"}" aria-pressed="${fav}" style="margin-left:auto">${fav ? "★" : "☆"}</button>
      </div>
      <h3>Ingredientes</h3>
      <div>${scaled.map(ingredient => {
        const have = pantry[ingredient.food]?.available;
        const optional = ingredient.optional;
        return `<div class="ingredient-row ${have ? "have" : optional ? "" : "missing"}">
          <span class="mark" aria-hidden="true">${have ? "✓" : optional ? "·" : "!"}</span>
          <span>${escapeHTML(ingredient.food)}${optional ? ` <small>(opcional)</small>` : ""}</span>
          <b>${escapeHTML(ingredient.display)}</b>
        </div>`;
      }).join("")}</div>
      ${match.complete ? `<div class="notice">Tienes en casa todo lo necesario.</div>` : `<div class="notice">Faltan ${match.missing.length}: ${escapeHTML(match.missing.join(", "))}.</div>`}
      <div class="actions">
        ${match.complete ? "" : `<button class="btn" data-add-missing="${recipe.id}">Agregar lo que falta a la compra</button>`}
        <button class="btn ${match.complete ? "" : "secondary"}" data-plan-recipe="${recipe.id}">Planificar</button>
      </div>
      <h3 style="margin-top:20px">Preparación</h3>
      <ol class="steps-list">${recipe.steps.map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol>
      <div class="notice">Idea organizativa basada en la pauta cargada. No sustituye indicaciones de la nutricionista.</div>
    </section></div>`;
  }

  if (type === "plan") {
    const recipe = RECIPES.find(r => r.id === state.modal.id);
    if (!recipe) return "";
    return `<div class="modal-backdrop" data-close-modal><form class="modal" id="plan-form"><div class="modal-head"><div><p class="eyebrow">Planificar</p><h2>${escapeHTML(recipe.name)}</h2></div>${close}</div>
      <input type="hidden" name="recipeId" value="${escapeHTML(recipe.id)}">
      <label class="field"><span class="field-label">Día</span><input name="date" type="date" required value="${state.viewDate}"></label>
      <div class="select-row"><label class="field"><span class="field-label">Comida</span><select name="meal">${MEALS.map(m => `<option ${recipe.meals.includes(m) ? "selected" : ""}>${m}</option>`).join("")}</select></label><label class="field"><span class="field-label">Porciones</span><input name="servings" type="number" min="1" max="12" value="${state.modal.servings || state.settings.defaultServings || 4}" required></label></div>
      <div class="actions"><button class="btn" type="submit">Agregar al plan</button><button class="btn secondary" type="button" data-close-modal>Cancelar</button></div></form></div>`;
  }

  if (type === "note") {
    const note = state.modal.id ? state.notes.find(n => n.id === state.modal.id) : null;
    return `<div class="modal-backdrop" data-close-modal><form class="modal" id="note-form"><div class="modal-head"><div><p class="eyebrow">${note ? "Editar" : "Nueva"}</p><h2>${note ? "Nota" : "Escribir nota"}</h2></div>${close}</div>
      <input type="hidden" name="noteId" value="${escapeHTML(note?.id || "")}">
      <label class="field"><span class="field-label">Tipo</span><select name="kind">${NOTE_KINDS.map(kind => `<option value="${kind.id}" ${note?.kind === kind.id ? "selected" : ""}>${kind.icon} ${kind.label}</option>`).join("")}</select></label>
      <label class="field"><span class="field-label">Título</span><input name="title" value="${escapeHTML(note?.title || "")}" placeholder="Ej.: Preguntar por el mareo de la mañana"></label>
      <label class="field"><span class="field-label">Contenido</span><textarea name="body" rows="7" required placeholder="Escribe aquí lo que no quieres olvidar.">${escapeHTML(note?.body || "")}</textarea></label>
      <label class="task"><input type="checkbox" name="pinned" ${note?.pinned ? "checked" : ""}><span><strong>Fijar arriba</strong><small>Las notas fijadas aparecen primero.</small></span></label>
      <div class="actions"><button class="btn" type="submit">Guardar nota</button>${note ? `<button class="btn danger" type="button" data-delete-note="${escapeHTML(note.id)}">Eliminar</button>` : ""}</div></form></div>`;
  }

  if (type === "reminder") {
    const reminder = state.modal.id ? (state.settings.reminders || []).find(r => r.id === state.modal.id) : null;
    const current = reminder || { id: "", title: "", icon: "🔔", time: "09:00", repeat: "daily", weekdays: ["1"], date: localDateKey(), active: true };
    return `<div class="modal-backdrop" data-close-modal><form class="modal" id="reminder-form"><div class="modal-head"><div><p class="eyebrow">Recordatorio</p><h2>${reminder ? "Editar recordatorio" : "Nuevo recordatorio"}</h2></div>${close}</div>
      <input type="hidden" name="reminderId" value="${escapeHTML(current.id)}">
      <label class="field"><span class="field-label">¿Qué hay que recordar?</span><input name="title" required value="${escapeHTML(current.title)}" placeholder="Ej.: Control con el cardiólogo"></label>
      <div class="field"><span class="field-label">Icono</span><div class="chip-row">${REMINDER_ICONS.map(icon => `<label class="chip ${current.icon === icon ? "active" : ""}" style="cursor:pointer"><input type="radio" name="icon" value="${icon}" ${current.icon === icon ? "checked" : ""} class="sr-only">${icon}</label>`).join("")}</div></div>
      <div class="select-row"><label class="field"><span class="field-label">Hora</span><input name="time" type="time" required value="${escapeHTML(current.time)}"></label><label class="field"><span class="field-label">Repetir</span><select name="repeat" id="reminder-repeat"><option value="daily" ${current.repeat === "daily" ? "selected" : ""}>Todos los días</option><option value="weekly" ${current.repeat === "weekly" ? "selected" : ""}>Días de la semana</option><option value="once" ${current.repeat === "once" ? "selected" : ""}>Una sola vez</option></select></label></div>
      <div class="field"><span class="field-label">Días de la semana</span><div class="chip-row">${WEEKDAYS.map(([value, label]) => `<label class="chip ${(current.weekdays || []).map(String).includes(value) ? "active" : ""}" style="cursor:pointer"><input type="checkbox" name="weekdays" value="${value}" ${(current.weekdays || []).map(String).includes(value) ? "checked" : ""} class="sr-only">${label}</label>`).join("")}</div><p class="field-hint">Solo se usa cuando repites por días de la semana.</p></div>
      <label class="field"><span class="field-label">Fecha (para una sola vez)</span><input name="date" type="date" value="${escapeHTML(current.date || localDateKey())}"></label>
      <label class="task"><input name="active" type="checkbox" ${current.active !== false ? "checked" : ""}><span><strong>Activo</strong><small>Desmárcalo para pausarlo sin borrarlo.</small></span></label>
      <div class="actions"><button class="btn" type="submit">Guardar recordatorio</button>${reminder ? `<button class="btn danger" type="button" data-delete-reminder="${escapeHTML(reminder.id)}">Eliminar</button>` : ""}</div></form></div>`;
  }

  // Medicamento
  const current = state.modal.id
    ? state.settings.medications.find(m => m.id === state.modal.id)
    : { id: "", name: "", dosage: "", amount: "", doseValue: 1, doseUnit: "tableta", times: ["08:00"], time: "Desayuno", instructions: "", period: "daily", everyDays: 15, startDate: localDateKey(), durationMonths: 3, active: true, stockCount: "" };
  const times = medTimes(current);
  return `<div class="modal-backdrop" data-close-modal><form class="modal" id="med-form"><div class="modal-head"><div><p class="eyebrow">Tratamiento</p><h2>${current.id ? "Editar medicamento" : "Agregar medicamento"}</h2></div>${close}</div>
    <input type="hidden" name="medId" value="${escapeHTML(current.id)}">
    <label class="field"><span class="field-label">Nombre</span><input name="name" required value="${escapeHTML(current.name)}"></label>
    <div class="select-row"><label class="field"><span class="field-label">Concentración / dosis</span><input name="dosage" value="${escapeHTML(current.dosage)}" placeholder="Ej.: 20 mg"></label><label class="field"><span class="field-label">Texto de la indicación</span><input name="amount" value="${escapeHTML(current.amount)}" placeholder="Ej.: 1 tableta"></label></div>
    <div class="select-row"><label class="field"><span class="field-label">Cantidad por toma</span><input name="doseValue" type="number" min="0.01" step="0.01" value="${current.doseValue || 1}"></label><label class="field"><span class="field-label">Unidad por toma</span><input name="doseUnit" value="${escapeHTML(current.doseUnit || "tableta")}"></label></div>
    <fieldset class="times-field"><legend class="field-label">Horarios del día</legend><p class="field-hint">Un medicamento puede tener varias tomas. Elige una pauta frecuente o ajusta las horas.</p>
      <div class="preset-row">${DOSE_PRESETS.map(preset => `<button type="button" class="chip" data-dose-preset="${preset.id}">${escapeHTML(preset.label)}</button>`).join("")}</div>
      <div class="time-list" id="time-list">${times.map((time, index) => `<div class="time-row"><input name="times" type="time" required value="${escapeHTML(time)}" aria-label="Horario ${index + 1}"><button type="button" class="icon-button" data-remove-time aria-label="Quitar este horario" ${times.length === 1 ? "disabled" : ""}>×</button></div>`).join("")}</div>
      <button type="button" class="btn soft small" data-add-time>+ Agregar horario</button></fieldset>
    <div class="select-row"><label class="field"><span class="field-label">Momento (etiqueta)</span><select name="time">${["Desayuno", "Almuerzo", "Cena", "Noche", "Según calendario"].map(v => `<option ${v === current.time ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="field"><span class="field-label">Existencias (opcional)</span><input name="stockCount" type="number" min="0" step="1" value="${current.stockCount ?? ""}" placeholder="Ej.: 30"></label></div>
    <div class="select-row"><label class="field"><span class="field-label">Frecuencia</span><select name="period"><option value="daily" ${current.period === "daily" ? "selected" : ""}>Todos los días</option><option value="every_n_days" ${current.period === "every_n_days" ? "selected" : ""}>Cada ciertos días</option></select></label><label class="field"><span class="field-label">Cada cuántos días</span><input name="everyDays" type="number" min="1" value="${current.everyDays || 1}"></label></div>
    <div class="select-row"><label class="field"><span class="field-label">Duración en meses</span><input name="durationMonths" type="number" min="1" value="${current.durationMonths || 3}"></label><label class="field"><span class="field-label">Fecha inicial</span><input name="startDate" type="date" required value="${escapeHTML(current.startDate)}"></label></div>
    <label class="field"><span class="field-label">Instrucciones</span><input name="instructions" value="${escapeHTML(current.instructions)}"></label>
    <label class="task"><input name="active" type="checkbox" ${current.active ? "checked" : ""}><span><strong>Tratamiento activo</strong><small>Desmárcalo para que deje de aparecer en días futuros.</small></span></label>
    <div class="actions"><button class="btn" type="submit">Guardar medicamento</button>${current.id ? `<button class="btn danger" type="button" data-delete-med="${escapeHTML(current.id)}">Eliminar</button>` : ""}</div></form></div>`;
}

/* -------------------------------- Bienvenida ------------------------------- */

/**
 * Primer uso. La aplicación llega vacía a propósito: la pauta la carga la
 * familia aquí o restaurando una copia de seguridad.
 */
function onboardingPage() {
  return `<div class="app-shell onboarding">
    <div class="welcome">
      <span class="brand-mark" aria-hidden="true">✓</span>
      <h1>Mi Día</h1>
      <p class="welcome-lead">Una agenda privada de medicamentos, alimentación, hidratación y presión. Todo queda guardado solo en este teléfono.</p>

      <form id="onboarding-form" class="welcome-card">
        <label class="field"><span class="field-label">¿Para quién es esta agenda?</span><input name="personName" required value="Mamá" autocomplete="off"></label>
        <label class="field"><span class="field-label">Meta diaria de agua</span><select name="waterGoal">${[2000, 2250, 2500, 2750, 3000].map(v => `<option value="${v}" ${v === 2500 ? "selected" : ""}>${v.toLocaleString("es-CL")} ml</option>`).join("")}</select></label>
        <button class="btn block" type="submit">Comenzar</button>
      </form>

      <div class="welcome-alt">
        <p>¿Ya tenías Mi Día en otro teléfono?</p>
        <button class="btn secondary" data-welcome-import>Restaurar una copia de seguridad</button>
        <input class="sr-only" id="welcome-file" type="file" accept="application/json">
      </div>

      <p class="welcome-note">Los medicamentos se agregan después, en Ajustes. La aplicación registra indicaciones: no diagnostica ni modifica tratamientos.</p>
    </div>
  </div>`;
}

/* ---------------------------------- Render --------------------------------- */

const PAGES = { today: todayPage, shop: shoppingPage, recipes: recipesPage, notes: notesPage, health: healthPage, assistant: assistantPage, settings: settingsPage };

/** Redibuja conservando foco, cursor y scroll: sin esto, escribir se interrumpe. */
function render() {
  const app = document.querySelector("#app");
  const active = document.activeElement;
  const selector = active && app.contains(active)
    ? (active.id ? `#${active.id}` : active.getAttribute("name") ? `[name="${active.getAttribute("name")}"]` : null)
    : null;
  let caret = null;
  try { caret = active?.selectionStart ?? null; } catch { caret = null; }
  const scrollY = window.scrollY;
  const thread = document.querySelector("#chat-thread");
  const threadAtBottom = thread ? thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 40 : true;

  // La bienvenida también necesita los modales (confirmar la restauración).
  app.innerHTML = state.onboarding
    ? `${onboardingPage()}${modalHTML()}`
    : shell((PAGES[state.page] || todayPage)());

  if (selector) {
    const restored = app.querySelector(selector);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (caret !== null) { try { restored.setSelectionRange(caret, caret); } catch { /* campo sin cursor */ } }
    }
  }
  window.scrollTo({ top: scrollY });
  const newThread = document.querySelector("#chat-thread");
  if (newThread && threadAtBottom) newThread.scrollTop = newThread.scrollHeight;
}

/* ------------------------------ Acciones de datos -------------------------- */

async function applyIntake(dose, values) {
  const first = !state.day.medicationIntakes[dose.doseId];
  state.day.medicationIntakes[dose.doseId] = { ...values, recordedAt: new Date().toISOString() };
  delete state.day.doseSkips[dose.doseId];
  const med = state.settings.medications.find(m => m.id === dose.medId);
  if (first && med && Number.isFinite(Number(med.stockCount))) {
    med.stockCount = Math.max(0, Number(med.stockCount) - Number(values.actualAmount || 0));
    await saveSettings();
  }
  await saveDay();
  await scheduleServiceWorkerDoses();
  await updateBadge();
}

async function addWater(amount) {
  state.day.waterMl += amount;
  state.day.waterHistory.push(amount);
  state.day.hydrationEntries.push({ id: uid(), type: "Agua", ml: amount, time: formatTime() });
  await saveDay();
}

async function saveNote(note) {
  await putRecord("notes", note);
  const index = state.notes.findIndex(n => n.id === note.id);
  if (index >= 0) state.notes[index] = note; else state.notes.push(note);
}

/* --------------------------------- Eventos --------------------------------- */

document.addEventListener("click", async event => {
  const target = event.target.closest("button, [data-close-modal]");
  if (!target) return;
  if (target.matches(".modal-backdrop") && target !== event.target) return;
  const d = target.dataset;

  /* --- Controles internos del formulario de medicamentos --- */
  if (d.dosePreset) {
    const preset = DOSE_PRESETS.find(p => p.id === d.dosePreset);
    const list = document.querySelector("#time-list");
    if (preset && list) list.innerHTML = preset.times.map((time, index) => `<div class="time-row"><input name="times" type="time" required value="${time}" aria-label="Horario ${index + 1}"><button type="button" class="icon-button" data-remove-time aria-label="Quitar este horario" ${preset.times.length === 1 ? "disabled" : ""}>×</button></div>`).join("");
    return;
  }
  if ("addTime" in d) {
    const list = document.querySelector("#time-list");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "time-row";
    row.innerHTML = `<input name="times" type="time" required value="12:00" aria-label="Horario ${list.children.length + 1}"><button type="button" class="icon-button" data-remove-time aria-label="Quitar este horario">×</button>`;
    list.append(row);
    list.querySelectorAll("[data-remove-time]").forEach(b => { b.disabled = list.children.length === 1; });
    row.querySelector("input").focus();
    return;
  }
  if ("removeTime" in d) {
    const list = document.querySelector("#time-list");
    if (!list || list.children.length <= 1) return;
    target.closest(".time-row").remove();
    list.querySelectorAll("[data-remove-time]").forEach(b => { b.disabled = list.children.length === 1; });
    return;
  }
  if (d.servings) {
    state.modal = { ...state.modal, servings: Math.min(12, Math.max(1, (state.modal.servings || state.settings.defaultServings || 4) + Number(d.servings))) };
    render();
    return;
  }

  if ("confirmYes" in d) {
    const action = pendingConfirm;
    pendingConfirm = null;
    state.modal = null;
    render();
    if (action) await action();
    return;
  }

  /* --- Navegación --- */
  if (d.page) { state.page = d.page; state.modal = null; render(); window.scrollTo(0, 0); return; }
  if (target.hasAttribute("data-close-modal")) { pendingConfirm = null; state.modal = null; render(); return; }
  if (d.shiftDay) {
    const next = addDays(state.viewDate, Number(d.shiftDay));
    if (next > localDateKey()) return;
    await loadDay(next); render();
    return;
  }
  if ("goToday" in d) { await loadDay(localDateKey()); render(); return; }
  if (d.pickDay) { await loadDay(d.pickDay); state.page = "today"; render(); window.scrollTo(0, 0); return; }
  if (d.statsWindow) { state.statsWindow = Number(d.statsWindow); render(); return; }
  if (d.shopView) { state.shopView = d.shopView; render(); return; }
  if (d.toggleAisle) {
    const aisle = decodeURIComponent(d.toggleAisle);
    state.collapsedAisles[aisle] = !state.collapsedAisles[aisle];
    render();
    return;
  }
  if (d.recipeFilter) { state.recipeFilter = d.recipeFilter; render(); return; }
  if (d.noteFilter) { state.noteFilter = d.noteFilter; render(); return; }

  /* --- Hidratación --- */
  if (d.water) {
    const amount = Number(d.water);
    await addWater(amount); haptic(); render();
    showToast(`Agregaste ${amount === 1000 ? "1 litro" : `${amount} ml`} de agua`);
    return;
  }
  if ("undoWater" in d) {
    const amount = state.day.waterHistory.pop();
    if (amount === undefined) return;
    state.day.waterMl = Math.max(0, state.day.waterMl - amount);
    const index = state.day.hydrationEntries.findLastIndex(e => e.type === "Agua" && Number(e.ml) === amount);
    if (index >= 0) state.day.hydrationEntries.splice(index, 1);
    await saveDay(); render(); showToast("Última cantidad de agua deshecha");
    return;
  }
  if ("otherLiquid" in d) { state.modal = "liquid"; render(); return; }

  /* --- Tomas y recordatorios --- */
  if (d.takeDose) { state.modal = { type: "intake", id: d.takeDose }; render(); return; }
  if (d.skipDose) {
    const id = d.skipDose;
    if (state.day.doseSkips[id]) delete state.day.doseSkips[id];
    else state.day.doseSkips[id] = { skippedAt: new Date().toISOString() };
    await saveDay(); await updateBadge(); render();
    showToast(state.day.doseSkips[id] ? "Toma marcada como omitida" : "Toma nuevamente pendiente");
    return;
  }
  if (d.removeIntake) {
    delete state.day.medicationIntakes[d.removeIntake];
    await saveDay(); await updateBadge(); state.modal = null; render();
    showToast("Registro de toma eliminado");
    return;
  }
  if (d.toggleReminder) {
    const id = d.toggleReminder;
    if (state.day.reminderDone[id]) delete state.day.reminderDone[id];
    else state.day.reminderDone[id] = formatTime();
    await saveDay(); await updateBadge(); haptic(); render();
    return;
  }
  if ("addReminder" in d) { state.modal = { type: "reminder" }; render(); return; }
  if (d.editReminder) { state.modal = { type: "reminder", id: d.editReminder }; render(); return; }
  if (d.deleteReminder) {
    const id = d.deleteReminder;
    const reminder = (state.settings.reminders || []).find(r => r.id === id);
    askConfirm({ title: "Eliminar recordatorio", body: `Se quitará «${reminder?.title || "este recordatorio"}». Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true }, async () => {
      state.settings.reminders = state.settings.reminders.filter(r => r.id !== id);
      await saveSettings(); await scheduleServiceWorkerDoses();
      render(); showToast("Recordatorio eliminado");
    });
    return;
  }
  if ("suggestReminders" in d) {
    state.settings.reminders = SUGGESTED_REMINDERS.map(reminder => ({ ...reminder, id: uid(), active: true }));
    await saveSettings(); await scheduleServiceWorkerDoses(); render();
    showToast("Recordatorios sugeridos agregados");
    return;
  }

  /* --- Alimentación --- */
  if ("saveCarb" in d) {
    state.day.carbohydrate = { meal: document.querySelector("#carb-meal").value, food: document.querySelector("#carb-food").value, time: formatTime() };
    await saveDay(); haptic(); render(); showToast("Porción registrada");
    return;
  }
  if ("removeCarb" in d) { state.day.carbohydrate = null; await saveDay(); render(); return; }
  if ("saveNotes" in d) {
    state.day.notes = document.querySelector("#daily-notes").value.trim();
    await saveDay(); showToast("Nota del día guardada");
    return;
  }

  /* --- Signos e informes --- */
  if ("openBp" in d) { state.modal = "bp"; render(); setTimeout(() => document.querySelector('[name="systolic"]')?.focus(), 0); return; }
  if ("deviceInfo" in d) { state.modal = "device"; render(); return; }
  if (d.deleteBp) {
    state.day.bloodPressure = state.day.bloodPressure.filter(r => r.id !== d.deleteBp);
    await saveDay(); render(); showToast("Medición eliminada");
    return;
  }
  if ("openReport" in d) {
    const html = buildReportHTML({ settings: state.settings, days: state.days, notes: state.notes, windowDays: state.statsWindow });
    if (!openReport(html)) showToast("Permite las ventanas emergentes para ver el informe");
    return;
  }
  if ("exportBpCsv" in d) { downloadFile(`presion-${state.statsWindow}dias-${localDateKey()}.csv`, bloodPressureCSV(state.days, state.statsWindow)); showToast("Archivo CSV creado"); return; }
  if ("exportIntakesCsv" in d) { downloadFile(`tomas-${state.statsWindow}dias-${localDateKey()}.csv`, intakesCSV(state.days, state.statsWindow)); showToast("Archivo CSV creado"); return; }
  if (d.history) { state.historyOpen = state.historyOpen === d.history ? null : d.history; render(); return; }

  /* --- Compras y despensa --- */
  if (d.shopCategory) { state.shopCategory = d.shopCategory; render(); return; }
  if (d.addGrocery) {
    const name = decodeURIComponent(d.addGrocery);
    await addToShoppingList(name);
    haptic(); render(); showToast(`${name} agregado a la compra`);
    return;
  }
  if (d.removeGrocery) {
    delete state.settings.shoppingList[decodeURIComponent(d.removeGrocery)];
    await saveSettings(); render(); showToast("Producto quitado de la lista");
    return;
  }
  if (d.shopCheck) {
    const name = decodeURIComponent(d.shopCheck);
    const item = state.settings.shoppingList[name];
    if (!item) return;
    item.purchased = !item.purchased;
    await saveSettings(); haptic(); render();
    return;
  }
  if ("clearPurchased" in d) {
    for (const [name, item] of Object.entries(state.settings.shoppingList)) if (item.purchased) delete state.settings.shoppingList[name];
    await saveSettings(); render(); showToast("Comprados retirados de la lista");
    return;
  }
  if ("pantryFromList" in d) {
    let count = 0;
    for (const [name, item] of Object.entries(state.settings.shoppingList)) {
      if (!item.purchased) continue;
      state.settings.pantry[name] = { available: true, updatedAt: new Date().toISOString() };
      count += 1;
    }
    await saveSettings(); render();
    showToast(count ? `${count} ${count === 1 ? "producto guardado" : "productos guardados"} en la despensa` : "No hay productos marcados como comprados");
    return;
  }
  if ("addCustom" in d) { state.modal = "custom-item"; render(); setTimeout(() => document.querySelector('#custom-item-form [name="name"]')?.focus(), 0); return; }
  if (d.pantry) {
    const name = decodeURIComponent(d.pantry);
    const wanted = d.pantryValue === "yes";
    const current = state.settings.pantry?.[name];
    // Volver a tocar el mismo estado lo deja sin marcar.
    await setPantry(name, current && current.available === wanted ? null : wanted);
    haptic(); render();
    return;
  }
  if ("shareShopping" in d) {
    const groups = shoppingByAisle();
    const lines = groups.map(([aisle, items]) => {
      const pending = items.filter(([, item]) => !item.purchased);
      if (!pending.length) return "";
      return `${aisle.toUpperCase()}\n${pending.map(([name, item]) => `• ${name}: ${item.quantity} ${unitLabel(item.quantity, item.unit)}`).join("\n")}`;
    }).filter(Boolean);
    const text = `Compra saludable para la familia\n\n${lines.join("\n\n")}\n\nLista basada en la pauta médica.`;
    try {
      if (navigator.share) await navigator.share({ title: "Compra saludable", text });
      else { await navigator.clipboard.writeText(text); showToast("Lista copiada"); }
    } catch { /* el usuario canceló */ }
    return;
  }

  /* --- Recetas --- */
  if (d.recipe) { state.modal = { type: "recipe", id: d.recipe, servings: state.settings.defaultServings || 4 }; render(); return; }
  if (d.favRecipe) {
    state.settings.favoriteRecipes ||= [];
    const id = d.favRecipe;
    const index = state.settings.favoriteRecipes.indexOf(id);
    if (index >= 0) state.settings.favoriteRecipes.splice(index, 1); else state.settings.favoriteRecipes.push(id);
    await saveSettings(); haptic(); render();
    return;
  }
  if (d.addMissing) {
    const recipe = RECIPES.find(r => r.id === d.addMissing);
    const servings = state.modal?.servings || state.settings.defaultServings || 4;
    const scaled = scaleRecipe(recipe, servings);
    const missing = pantryMatch(recipe, state.settings.pantry || {}).missing;
    for (const name of missing) {
      const ingredient = scaled.find(i => i.food === name);
      await addToShoppingList(name, { quantity: ingredient?.qty ?? 1, unit: ingredient?.unit, fromRecipe: recipe.name });
    }
    render();
    showToast(`${missing.length} ${missing.length === 1 ? "ingrediente agregado" : "ingredientes agregados"} a la compra`);
    return;
  }
  if (d.planRecipe) { state.modal = { type: "plan", id: d.planRecipe, servings: state.modal?.servings }; render(); return; }
  if (d.removePlan) {
    const list = state.settings.mealPlan?.[state.viewDate] || [];
    state.settings.mealPlan[state.viewDate] = list.filter(entry => entry.id !== d.removePlan);
    if (!state.settings.mealPlan[state.viewDate].length) delete state.settings.mealPlan[state.viewDate];
    await saveSettings(); render(); showToast("Quitado del plan");
    return;
  }

  /* --- Notas --- */
  if ("newNote" in d) { state.modal = { type: "note" }; render(); setTimeout(() => document.querySelector('#note-form [name="body"]')?.focus(), 0); return; }
  if (d.editNote) { state.modal = { type: "note", id: d.editNote }; render(); return; }
  if (d.pinNote) {
    const note = state.notes.find(n => n.id === d.pinNote);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await saveNote(note); haptic(); render();
    return;
  }
  if (d.deleteNote) {
    const id = d.deleteNote;
    const note = state.notes.find(n => n.id === id);
    askConfirm({ title: "Eliminar nota", body: `Se borrará «${note?.title || "esta nota"}». Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true }, async () => {
      await deleteRecord("notes", id);
      state.notes = state.notes.filter(n => n.id !== id);
      render(); showToast("Nota eliminada");
    });
    return;
  }

  /* --- Ajustes --- */
  if ("saveGeneral" in d) {
    state.settings.personName = document.querySelector("#person-name").value.trim() || "Mamá";
    state.settings.waterGoal = Number(document.querySelector("#water-goal").value);
    state.settings.defaultServings = Math.min(12, Math.max(1, Number(document.querySelector("#default-servings").value) || 4));
    await saveSettings();
    if (isToday()) { state.day.waterGoalSnapshot = state.settings.waterGoal; await saveDay(); }
    render(); showToast("Ajustes guardados");
    return;
  }
  if (d.textScale) { state.settings.textScale = Number(d.textScale); await saveSettings(); applyPreferences(); render(); return; }
  if (d.themeChoice) { state.settings.theme = d.themeChoice; await saveSettings(); applyPreferences(); render(); return; }
  if ("enableReminders" in d) {
    if (nativo.isNative()) {
      const { concedido, exactas } = await nativo.pedirPermisos();
      state.settings.notificationsEnabled = concedido;
      await saveSettings(); render();
      showToast(concedido
        ? (exactas ? "Avisos activados con alarma exacta" : "Avisos activados, pero el sistema puede retrasarlos")
        : "Permiso de avisos no concedido");
      if (concedido) { chime(); await scheduleServiceWorkerDoses(); }
      return;
    }
    if (!("Notification" in window)) { showToast("Este navegador no admite notificaciones"); return; }
    const permission = await Notification.requestPermission();
    state.settings.notificationsEnabled = permission === "granted";
    await saveSettings(); render();
    showToast(permission === "granted" ? "Avisos activados" : "Permiso de avisos no concedido");
    if (permission === "granted") { chime(); await checkReminders(); await scheduleServiceWorkerDoses(); }
    return;
  }
  if ("testNotification" in d) {
    chime(); haptic([200, 100, 200]);
    showToast("Así se verá un aviso de Mi Día", { alert: true });
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration && Notification.permission === "granted") {
      registration.showNotification("Aviso de prueba", { body: "Así avisará Mi Día cuando llegue la hora.", icon: "./icons/icon-192.png", tag: "prueba" }).catch(() => {});
    } else if (Notification.permission !== "granted") showToast("Primero activa los avisos");
    return;
  }
  if ("export" in d) {
    const data = await exportDatabase();
    downloadFile(`mi-dia-backup-${localDateKey()}.json`, JSON.stringify(data, null, 2), "application/json");
    state.settings.lastBackupAt = new Date().toISOString();
    await saveSettings(); render(); showToast("Copia de seguridad creada");
    return;
  }
  if ("import" in d) { document.querySelector("#import-file").click(); return; }
  if ("welcomeImport" in d) { document.querySelector("#welcome-file").click(); return; }
  if ("addMed" in d) { state.modal = { type: "med" }; render(); return; }
  if (d.editMed) { state.modal = { type: "med", id: d.editMed }; render(); return; }
  if (d.deleteMed) {
    const id = d.deleteMed;
    const med = state.settings.medications.find(m => m.id === id);
    askConfirm({ title: "Eliminar medicamento", body: `${med?.name || "Este medicamento"} dejará de aparecer en los días futuros. Los días ya guardados conservan su registro.`, confirmLabel: "Eliminar", danger: true }, async () => {
      state.settings.medications = state.settings.medications.filter(m => m.id !== id);
      await saveSettings();
      if (isToday()) { state.day.medicationSnapshot = state.settings.medications.filter(m => medicationIsDue(m, state.viewDate)).map(snapshotMedication); await saveDay(); }
      await scheduleServiceWorkerDoses();
      render(); showToast("Medicamento eliminado");
    });
    return;
  }
  if ("clearChat" in d) {
    state.chatMessages = [structuredClone(WELCOME_MESSAGE)];
    await saveChat(); render(); showToast("Conversación borrada");
    return;
  }
});

document.addEventListener("input", event => {
  const el = event.target;
  if (el.hasAttribute?.("data-recipe-search")) { state.recipeQuery = el.value; render(); return; }
  if (el.hasAttribute?.("data-note-search")) { state.noteQuery = el.value; render(); }
});

document.addEventListener("change", async event => {
  const el = event.target;

  if (el.dataset.task) {
    const id = el.dataset.task;
    state.day.tasks[id] = el.checked;
    if (el.checked) state.day.taskTimes[id] = formatTime(); else delete state.day.taskTimes[id];
    await saveDay(); haptic(); render();
    showToast(el.checked ? "Registrado" : "Registro deshecho");
    return;
  }
  if (el.dataset.togglePref) {
    state.settings[el.dataset.togglePref] = el.checked;
    await saveSettings(); applyPreferences(); render();
    if (el.dataset.togglePref === "soundEnabled" && el.checked) chime();
    return;
  }
  if ((el.id === "import-file" || el.id === "welcome-file") && el.files?.[0]) {
    let data;
    try {
      data = JSON.parse(await el.files[0].text());
      if (data.format !== "mi-dia-backup" || !Array.isArray(data.settings) || !Array.isArray(data.days)) throw new Error("formato");
    } catch {
      showToast("El archivo no es una copia válida");
      el.value = "";
      return;
    }
    const meds = data.settings?.find(item => item.id === "main")?.medications?.length || 0;
    const partes = [
      `${data.days.length} ${data.days.length === 1 ? "día" : "días"} de registros`,
      `${meds} ${meds === 1 ? "medicamento" : "medicamentos"}`,
      `${(data.notes || []).length} ${(data.notes || []).length === 1 ? "nota" : "notas"}`
    ];
    el.value = "";
    for (const item of data.settings || []) {
      if (item.id === "main") item.onboardedAt ||= new Date().toISOString();
    }
    askConfirm({
      title: "Restaurar copia de seguridad",
      body: `Se cargarán ${partes.join(", ")}. Los datos que haya ahora en este teléfono se reemplazan.`,
      confirmLabel: "Restaurar"
    }, async () => {
      await replaceAll(data);
      await closeDB();
      location.reload();
    });
    return;
  }
  if (el.dataset.groceryAmount) {
    const item = state.settings.shoppingList[decodeURIComponent(el.dataset.groceryAmount)];
    if (item) { item.quantity = Math.max(0.01, Number(el.value) || 1); await saveSettings(); }
    return;
  }
  if (el.dataset.groceryUnit) {
    const item = state.settings.shoppingList[decodeURIComponent(el.dataset.groceryUnit)];
    if (item) { item.unit = el.value; await saveSettings(); }
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  // Atención: un control llamado "id" eclipsa la propiedad form.id,
  // por eso el identificador se lee siempre desde el atributo.
  const formId = form.getAttribute("id");

  if (formId === "chat-form") {
    event.preventDefault();
    const input = form.elements.message;
    const content = input.value.trim();
    if (!content || state.chatBusy) return;
    state.chatMessages.push({ role: "user", content });
    state.chatMessages = state.chatMessages.slice(-10);
    state.chatBusy = true;
    await saveChat();
    render();
    try {
      const endpoint = chatEndpoint();
      if (!endpoint) throw new Error("La Compañera todavía no está configurada en esta versión de la aplicación.");
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: state.chatMessages.filter(m => ["user", "assistant"].includes(m.role)).slice(-10) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "El acompañante no está disponible.");
      state.chatMessages.push({ role: "assistant", content: result.reply });
    } catch (error) {
      // Un TypeError de fetch significa que no se pudo contactar al servidor:
      // nunca se muestra el mensaje técnico del navegador a la usuaria.
      const unreachable = error instanceof TypeError || navigator.onLine === false;
      state.chatMessages.push({
        role: "assistant",
        content: unreachable
          ? "Ahora no tengo conexión para responder. El resto de la agenda funciona igual y puedes volver a preguntarme más tarde."
          : (error.message || "No pude responder en este momento. Intenta nuevamente más tarde.")
      });
    } finally {
      state.chatBusy = false;
      await saveChat();
      render();
    }
    return;
  }

  if (formId === "onboarding-form") {
    event.preventDefault();
    const f = new FormData(form);
    state.settings.personName = String(f.get("personName")).trim() || "Mamá";
    state.settings.waterGoal = Number(f.get("waterGoal")) || 2500;
    state.settings.onboardedAt = new Date().toISOString();
    await saveSettings();
    state.day.waterGoalSnapshot = state.settings.waterGoal;
    await saveDay();
    state.onboarding = false;
    state.page = "today";
    render();
    showToast("Listo. Agrega los medicamentos en Ajustes cuando quieras.");
    return;
  }

  if (formId === "bp-form") {
    event.preventDefault();
    const f = new FormData(form);
    const date = String(f.get("date") || state.viewDate);
    const reading = { id: uid(), time: String(f.get("time")), systolic: Number(f.get("systolic")), diastolic: Number(f.get("diastolic")), pulse: Number(f.get("pulse")), source: String(f.get("source")), recordedAt: new Date().toISOString() };
    const day = date === state.viewDate ? state.day : (await getRecord("days", date)) || newDay(date);
    if (day !== state.day) normalizeDay(day);
    day.bloodPressure.push(reading);
    day.bloodPressure.sort((a, b) => a.time.localeCompare(b.time));
    await saveDay(day);
    if (date !== state.viewDate) await loadDay(date);
    state.modal = null; haptic(); render(); showToast("Medición guardada");
    return;
  }

  if (formId === "liquid-form") {
    event.preventDefault();
    const f = new FormData(form);
    const raw = Number(f.get("amount"));
    state.day.hydrationEntries.push({ id: uid(), type: String(f.get("type")), ml: f.get("unit") === "L" ? raw * 1000 : raw, time: String(f.get("time")) });
    await saveDay(); state.modal = null; render(); showToast("Líquido registrado por separado");
    return;
  }

  if (formId === "intake-form") {
    event.preventDefault();
    const f = new FormData(form);
    const dose = dayDoses(state.day).find(d => d.doseId === String(f.get("doseId")));
    if (!dose) return;
    await applyIntake(dose, {
      actualAmount: Number(f.get("actualAmount")), unit: String(f.get("unit")).trim(),
      time: String(f.get("time")), note: String(f.get("note")).trim()
    });
    state.modal = null; haptic(); render(); showToast("Toma confirmada");
    return;
  }

  if (formId === "custom-item-form") {
    event.preventDefault();
    const f = new FormData(form);
    const name = String(f.get("name")).trim();
    if (!name) return;
    await addToShoppingList(name, { quantity: Number(f.get("quantity")) || 1, unit: String(f.get("unit")), custom: true });
    if (f.get("staple") === "on" && !state.settings.staples.includes(name)) {
      state.settings.staples.push(name);
      await saveSettings();
    }
    state.modal = null; render(); showToast(`${name} agregado a la compra`);
    return;
  }

  if (formId === "plan-form") {
    event.preventDefault();
    const f = new FormData(form);
    const date = String(f.get("date"));
    state.settings.mealPlan ||= {};
    state.settings.mealPlan[date] ||= [];
    state.settings.mealPlan[date].push({ id: uid(), recipeId: String(f.get("recipeId")), meal: String(f.get("meal")), servings: Number(f.get("servings")) || 4 });
    await saveSettings();
    state.modal = null; render();
    showToast(date === state.viewDate ? "Agregado al plan de hoy" : `Planificado para el ${formatDate(date, { day: "numeric", month: "long" })}`);
    return;
  }

  if (formId === "note-form") {
    event.preventDefault();
    const f = new FormData(form);
    const id = String(f.get("noteId") || "") || uid();
    const existing = state.notes.find(n => n.id === id);
    const now = new Date().toISOString();
    await saveNote({
      id,
      kind: String(f.get("kind")),
      title: String(f.get("title")).trim(),
      body: String(f.get("body")).trim(),
      pinned: f.get("pinned") === "on",
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    state.modal = null; haptic(); render(); showToast("Nota guardada");
    return;
  }

  if (formId === "reminder-form") {
    event.preventDefault();
    const f = new FormData(form);
    const id = String(f.get("reminderId") || "") || uid();
    const reminder = {
      id,
      title: String(f.get("title")).trim(),
      icon: String(f.get("icon") || "🔔"),
      time: String(f.get("time")),
      repeat: String(f.get("repeat")),
      weekdays: f.getAll("weekdays").map(String),
      date: String(f.get("date") || localDateKey()),
      active: f.get("active") === "on"
    };
    if (reminder.repeat === "weekly" && !reminder.weekdays.length) { showToast("Elige al menos un día de la semana"); return; }
    state.settings.reminders ||= [];
    const index = state.settings.reminders.findIndex(r => r.id === id);
    if (index >= 0) state.settings.reminders[index] = reminder; else state.settings.reminders.push(reminder);
    await saveSettings(); await scheduleServiceWorkerDoses(); await updateBadge();
    state.modal = null; render(); showToast("Recordatorio guardado");
    return;
  }

  if (formId === "med-form") {
    event.preventDefault();
    const f = new FormData(form);
    const times = [...new Set(f.getAll("times").map(String).filter(Boolean))].sort();
    if (!times.length) { showToast("Indica al menos un horario"); return; }
    const stockRaw = String(f.get("stockCount") || "").trim();
    const id = f.get("medId") || `med-${Date.now()}`;
    const med = {
      id, name: String(f.get("name")).trim(), dosage: String(f.get("dosage")).trim(), amount: String(f.get("amount")).trim(),
      doseValue: Number(f.get("doseValue")) || 1, doseUnit: String(f.get("doseUnit")).trim() || "unidad",
      times, time: String(f.get("time")), instructions: String(f.get("instructions")).trim(),
      period: String(f.get("period")), everyDays: Number(f.get("everyDays")) || 1,
      startDate: String(f.get("startDate")), durationMonths: Number(f.get("durationMonths")) || 3,
      active: f.get("active") === "on",
      ...(stockRaw === "" ? {} : { stockCount: Number(stockRaw) })
    };
    const index = state.settings.medications.findIndex(m => m.id === id);
    if (index >= 0) {
      state.settings.medications[index] = { ...state.settings.medications[index], ...med };
      if (stockRaw === "") delete state.settings.medications[index].stockCount;
    } else state.settings.medications.push(med);
    await saveSettings();
    if (isToday()) {
      state.day.medicationSnapshot = state.settings.medications.filter(m => medicationIsDue(m, state.viewDate)).map(snapshotMedication);
      await saveDay();
    }
    await scheduleServiceWorkerDoses();
    state.modal = null; render(); showToast("Medicamento guardado");
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.modal) { pendingConfirm = null; state.modal = null; render(); }
});

window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); state.deferredInstall = event; });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyPreferences);

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  if (await drainOutbox()) render();
  await checkReminders();
  await scheduleServiceWorkerDoses();
});

navigator.serviceWorker?.addEventListener?.("message", async event => {
  if (event.data?.type === "outbox-updated") { if (await drainOutbox()) render(); return; }
  if (event.data?.type === "reschedule-request") await scheduleServiceWorkerDoses();
});

/* ---------------------------------- Arranque -------------------------------- */

/** Atajos del icono instalado: ?accion=agua|presion|tomas|compra|nota. */
async function applyLaunchAction() {
  const action = new URLSearchParams(location.search).get("accion");
  if (!action) return;
  history.replaceState(null, "", location.pathname);
  if (action === "agua") { await addWater(250); showToast("Agregaste 250 ml de agua"); return; }
  if (action === "presion") { state.page = "health"; state.modal = "bp"; return; }
  if (action === "compra") { state.page = "shop"; return; }
  if (action === "nota") { state.page = "notes"; state.modal = { type: "note" }; return; }
  if (action === "tomas") state.page = "today";
}

/**
 * Aplica una acción hecha desde una notificación de Android.
 * Reutiliza la bandeja `outbox`, igual que el service worker en la web, para
 * que exista un solo camino de entrada y un solo lugar donde corregirlo.
 */
async function aplicarAccionNativa(alerta) {
  if (!alerta?.accion || alerta.accion === "open") {
    state.page = "today";
    render();
    return;
  }
  await putRecord("outbox", {
    id: `${alerta.doseId}-${alerta.accion}-${Date.now()}`,
    doseId: alerta.doseId,
    medId: alerta.medId,
    reminderId: alerta.reminderId,
    date: alerta.date,
    time: alerta.time,
    kind: alerta.accion,
    queuedAt: new Date().toISOString()
  });
  if (await drainOutbox()) render();
  await scheduleServiceWorkerDoses();
}

/** Arranque del puente nativo. No hace nada en el navegador. */
async function initNative() {
  if (!nativo.isNative()) return;
  await nativo.crearCanal();
  await nativo.registrarAcciones(SNOOZE_MINUTES);
  nativo.escucharAcciones(alerta => { aplicarAccionNativa(alerta).catch(console.error); });
  if (state.settings.notificationsEnabled) await scheduleServiceWorkerDoses();
}

/** Si la app queda abierta y cambia la fecha, se pasa sola al día nuevo. */
function watchDayRollover() {
  let knownDay = localDateKey();
  setInterval(async () => {
    const today = localDateKey();
    if (today === knownDay) return;
    knownDay = today;
    await loadDay(today);
    render();
    showToast("Comenzó un nuevo día");
  }, 60000);
}

async function showStorageState() {
  const element = document.querySelector("#storage-state");
  if (!element) return;
  const estimate = await estimateStorage();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  if (!estimate) return;
  element.textContent = `Espacio usado: ${(estimate.usage / 1048576).toFixed(1)} MB · ${persisted ? "almacenamiento protegido por el navegador" : "el navegador podría liberar estos datos, mantén una copia"}`;
}

async function init() {
  const existingSettings = await getRecord("settings", "main");
  state.settings = existingSettings || structuredClone(DEFAULT_SETTINGS);
  const changed = migrateSettings(state.settings);
  // Se distingue por la presencia de la clave, no por su valor: una instalación
  // nueva guarda onboardedAt en null y debe seguir viendo la bienvenida aunque
  // cierre la aplicación a medias; una instalación anterior a esta versión no
  // trae la clave y ya está configurada.
  if (existingSettings && !("onboardedAt" in existingSettings)) state.settings.onboardedAt = new Date().toISOString();
  state.onboarding = !state.settings.onboardedAt;
  if (!existingSettings || changed) await saveSettings();

  const storedChat = await getRecord("settings", "chat");
  state.chatMessages = storedChat?.messages?.length ? storedChat.messages : [structuredClone(WELCOME_MESSAGE)];

  applyPreferences();
  await loadDay(localDateKey());
  state.days = await getAllRecords("days");
  for (const day of state.days) normalizeDay(day);
  const index = state.days.findIndex(day => day.id === state.day.id);
  if (index >= 0) state.days[index] = structuredClone(state.day); else state.days.push(structuredClone(state.day));
  state.notes = await getAllRecords("notes");

  await drainOutbox();
  await applyLaunchAction();

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register("./service-worker.js")
      .then(registration => { registration.update().catch(() => {}); return scheduleServiceWorkerDoses(); })
      .catch(() => {});
  }

  registerWebMCP();
  await initNative();
  render();
  showStorageState();
  reportOverdue();
  await checkReminders();
  await updateBadge();
  clearInterval(tickTimer);
  tickTimer = setInterval(checkReminders, TICK_MS);
  watchDayRollover();
}

/* ----------------------------------- WebMCP --------------------------------- */

function registerWebMCP() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const add = tool => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch { /* sin soporte */ } };
  const empty = { type: "object", properties: {}, additionalProperties: false };

  add({
    name: "get_today_summary", title: "Ver resumen de hoy",
    description: "Devuelve el avance, agua, tomas y recordatorios pendientes del día actual.",
    inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({
      date: state.day.date, ...completion(state.day, state.settings.waterGoal),
      waterMl: state.day.waterMl, waterGoal: state.day.waterGoalSnapshot || state.settings.waterGoal,
      pendingDoses: pendingDoses().map(dose => ({ name: dose.name, time: dose.time, status: dose.status })),
      pendingReminders: dayReminders().filter(r => !r.done).map(r => ({ title: r.title, time: r.time })),
      bloodPressureCount: state.day.bloodPressure.length
    })
  });

  add({
    name: "add_water", title: "Registrar agua",
    description: "Suma 250, 500 o 1000 ml al agua consumida hoy.",
    inputSchema: { type: "object", properties: { amountMl: { type: "number", enum: [250, 500, 1000] } }, required: ["amountMl"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async input => {
      if (![250, 500, 1000].includes(input.amountMl)) throw new Error("Cantidad no válida");
      await addWater(input.amountMl); render();
      return { waterMl: state.day.waterMl, goalMl: state.day.waterGoalSnapshot || state.settings.waterGoal };
    }
  });

  add({
    name: "record_blood_pressure", title: "Registrar presión arterial",
    description: "Guarda una medición manual de presión y pulso para hoy.",
    inputSchema: { type: "object", properties: { systolic: { type: "number", minimum: 50, maximum: 300 }, diastolic: { type: "number", minimum: 30, maximum: 200 }, pulse: { type: "number", minimum: 20, maximum: 250 }, time: { type: "string" }, source: { type: "string" } }, required: ["systolic", "diastolic", "pulse", "time"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async input => {
      const reading = { id: uid(), source: input.source || "Manual", ...input };
      state.day.bloodPressure.push(reading);
      state.day.bloodPressure.sort((a, b) => a.time.localeCompare(b.time));
      await saveDay(); render();
      return { saved: true, date: state.day.date, reading };
    }
  });

  add({
    name: "get_adherence_summary", title: "Ver cumplimiento de medicamentos",
    description: "Porcentaje de tomas registradas, racha de días completos y detalle por medicamento.",
    inputSchema: { type: "object", properties: { windowDays: { type: "number", enum: [7, 30, 90] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: input => {
      const windowDays = input?.windowDays || 30;
      return { ...adherence(state.days, windowDays), streak: perfectDayStreak(state.days), byMedication: adherenceByMedication(state.days, windowDays) };
    }
  });

  add({
    name: "get_blood_pressure_summary", title: "Ver promedios de presión",
    description: "Promedios y rangos de presión y pulso registrados. Es un resumen de lo anotado, sin interpretación clínica.",
    inputSchema: { type: "object", properties: { windowDays: { type: "number", enum: [7, 30, 90] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: input => {
      const windowDays = input?.windowDays || 30;
      const points = bloodPressureSeries(state.days, windowDays);
      return { windowDays, summary: bloodPressureSummary(points), byTimeOfDay: bloodPressureByTimeOfDay(points), notice: "Resumen de registros propios. No constituye diagnóstico ni clasificación." };
    }
  });

  add({
    name: "get_family_shopping_list", title: "Ver lista de compras",
    description: "Alimentos pendientes de comprar, agrupados por pasillo del supermercado.",
    inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({
      byAisle: shoppingByAisle().map(([aisle, items]) => ({
        aisle,
        items: items.filter(([, item]) => !item.purchased).map(([name, item]) => ({ name, quantity: item.quantity, unit: item.unit || "unidad" }))
      })).filter(group => group.items.length)
    })
  });

  add({
    name: "add_recommended_grocery", title: "Agregar alimento recomendado",
    description: "Agrega a la compra familiar un alimento que aparece en la pauta configurada.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number", minimum: 0.01, maximum: 100 }, unit: { type: "string", enum: SHOP_UNITS } }, required: ["name"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async input => {
      if (!isInGuideline(input.name)) throw new Error("Ese alimento no forma parte de la pauta configurada");
      const item = await addToShoppingList(input.name, { quantity: input.quantity || 1, unit: input.unit });
      render();
      return { added: true, name: input.name, quantity: item.quantity, unit: item.unit };
    }
  });

  add({
    name: "suggest_recipes", title: "Sugerir recetas",
    description: "Recetas de la pauta, indicando cuáles se pueden cocinar con lo que hay en casa y qué falta comprar.",
    inputSchema: { type: "object", properties: { meal: { type: "string", enum: MEALS }, onlyAvailable: { type: "boolean" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: input => {
      const pantry = state.settings.pantry || {};
      return {
        recipes: RECIPES
          .filter(recipe => !input?.meal || recipe.meals.includes(input.meal))
          .map(recipe => ({ id: recipe.id, name: recipe.name, minutes: recipe.minutes, meals: recipe.meals, ...pantryMatch(recipe, pantry) }))
          .filter(recipe => !input?.onlyAvailable || recipe.complete)
          .sort((a, b) => b.percent - a.percent),
        notice: "Ideas basadas en la pauta cargada. No sustituyen la indicación de la nutricionista."
      };
    }
  });

  add({
    name: "list_doctor_questions", title: "Ver preguntas para el médico",
    description: "Preguntas y observaciones anotadas en las notas para la próxima consulta.",
    inputSchema: empty, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({
      questions: state.notes.filter(note => note.kind === "pregunta").map(note => ({ title: note.title, body: note.body, updatedAt: note.updatedAt })),
      symptoms: state.notes.filter(note => note.kind === "sintoma").map(note => ({ title: note.title, body: note.body, updatedAt: note.updatedAt }))
    })
  });
}

init().catch(error => {
  console.error(error);
  document.querySelector("#app").innerHTML = '<div class="loading"><span class="brand-mark">!</span><p>No se pudo abrir la agenda. Recarga la página.</p></div>';
});
