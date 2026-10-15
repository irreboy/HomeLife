/* Horarios y expansión de tomas.
 *
 * Toda fecha se calcula con los componentes del calendario local, nunca en UTC:
 * así un cambio de horario de verano no desplaza una toma.
 *
 * Cada toma recibe un identificador estable con el día incluido
 * (`medId|AAAA-MM-DD|HH:MM`), de modo que sobrevive a recargas y permite
 * varias tomas del mismo medicamento en un día.
 */

export const DOSE_PRESETS = [
  { id: "od", label: "1 vez al día", times: ["08:00"] },
  { id: "bd", label: "2 veces al día", times: ["08:00", "20:00"] },
  { id: "tds", label: "3 veces al día", times: ["08:00", "14:00", "20:00"] },
  { id: "qid", label: "4 veces al día", times: ["08:00", "12:00", "16:00", "20:00"] },
  { id: "qhs", label: "Solo en la noche", times: ["21:00"] }
];

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateFromKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key, amount) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Fecha y hora reales de una toma, en hora local. */
export function doseDueAt(dateKey, time) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const [hh, mm] = String(time || "08:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

export function doseId(medId, dateKey, time) {
  return `${medId}|${dateKey}|${time}`;
}

/** Horarios de un medicamento, tolerando el modelo antiguo de una sola hora. */
export function medTimes(med) {
  if (Array.isArray(med.times) && med.times.length) return [...med.times].sort();
  if (med.reminderTime) return [med.reminderTime];
  return ["08:00"];
}

export function medicationIsDue(med, dateKey) {
  if (!med.active) return false;
  const current = dateFromKey(dateKey);
  const start = dateFromKey(med.startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + Number(med.durationMonths || 120));
  if (current < start || current >= end) return false;
  if (med.period === "daily") return true;
  const days = Math.round((current - start) / 86400000);
  return days % Number(med.everyDays || 1) === 0;
}

/** Una entrada por cada toma programada del día, ya ordenada por hora. */
export function expandDoses(medications = [], dateKey) {
  const doses = [];
  for (const med of medications) {
    if (med.active === false) continue;
    if (med.startDate && !medicationIsDue(med, dateKey)) continue;
    for (const time of medTimes(med)) {
      doses.push({
        doseId: doseId(med.id, dateKey, time),
        medId: med.id,
        date: dateKey,
        time,
        dueAt: doseDueAt(dateKey, time).toISOString(),
        name: med.name,
        dosage: med.dosage || "",
        amount: med.amount || "",
        instructions: med.instructions || "",
        doseValue: med.doseValue ?? 1,
        doseUnit: med.doseUnit || "unidad",
        moment: med.time || ""
      });
    }
  }
  return doses.sort((a, b) => a.time.localeCompare(b.time));
}

/** Instantánea guardada en el día para que el historial no cambie si la pauta cambia. */
export function snapshotMedication(med) {
  return {
    id: med.id, name: med.name, dosage: med.dosage, amount: med.amount,
    doseValue: med.doseValue, doseUnit: med.doseUnit,
    times: medTimes(med), time: med.time, instructions: med.instructions,
    period: med.period, everyDays: med.everyDays, startDate: med.startDate,
    durationMonths: med.durationMonths, active: med.active
  };
}

/** Tomas del día con su estado: tomada, omitida, atrasada o pendiente. */
export function dayDoses(day) {
  const meds = Array.isArray(day.medicationSnapshot) ? day.medicationSnapshot : [];
  const now = new Date();
  return expandDoses(meds, day.date).map(dose => {
    const intake = day.medicationIntakes?.[dose.doseId];
    const skipped = !!day.doseSkips?.[dose.doseId];
    const overdue = !intake && !skipped && doseDueAt(dose.date, dose.time) < now;
    return { ...dose, intake, skipped, overdue, status: intake ? "taken" : skipped ? "skipped" : overdue ? "overdue" : "pending" };
  });
}

/** Días estimados de existencias según cuántas tomas consume por día. */
export function stockForecast(med) {
  const remaining = Number(med.stockCount);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const perDay = medTimes(med).length * Number(med.doseValue || 1);
  const perDayAverage = med.period === "daily" ? perDay : perDay / Math.max(1, Number(med.everyDays || 1));
  if (!perDayAverage) return null;
  const days = Math.floor(remaining / perDayAverage);
  return { remaining, days, runsOutOn: addDays(localDateKey(), days) };
}
