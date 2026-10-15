/* Métricas de cumplimiento y tendencias.
 *
 * Este módulo solamente cuenta y promedia lo que la usuaria registró.
 * No clasifica la presión arterial ni interpreta cifras: esa frontera es
 * deliberada y pertenece al profesional tratante.
 */

import { dayDoses, addDays, localDateKey } from "./schedule.js";

const FOOD_IDS = ["breakfast-veg", "breakfast-protein", "lunch-veg", "lunch-protein", "dinner-veg", "dinner-protein", "fruit", "fat"];

/** Avance del día: tomas, alimentación, carbohidrato y meta de agua. */
export function completion(day, waterGoalFallback = 2500) {
  const doses = dayDoses(day);
  const goal = day.waterGoalSnapshot || waterGoalFallback;
  let done = 0;
  let total = 0;

  for (const dose of doses) {
    total += 1;
    // Una toma omitida a conciencia no cuenta como pendiente eterna.
    if (dose.intake || dose.skipped) done += 1;
  }
  for (const id of FOOD_IDS) { total += 1; if (day.tasks?.[id]) done += 1; }
  total += 1; if (day.carbohydrate) done += 1;
  total += 1; if (day.waterMl >= goal) done += 1;

  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Cumplimiento de medicamentos en una ventana de días (7, 30 o 90). */
export function adherence(days, windowDays, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const inWindow = days.filter(day => day.date >= from && day.date <= today);
  let scheduled = 0;
  let taken = 0;
  let skipped = 0;

  for (const day of inWindow) {
    for (const dose of dayDoses(day)) {
      scheduled += 1;
      if (dose.intake) taken += 1;
      else if (dose.skipped) skipped += 1;
    }
  }
  return {
    windowDays, scheduled, taken, skipped,
    missed: Math.max(0, scheduled - taken - skipped),
    percent: scheduled ? Math.round((taken / scheduled) * 100) : null
  };
}

/** Días consecutivos, hasta hoy, con todas las tomas registradas. */
export function perfectDayStreak(days, today = localDateKey()) {
  const byDate = new Map(days.map(day => [day.date, day]));
  let streak = 0;
  let cursor = today;
  for (let i = 0; i < 400; i += 1) {
    const day = byDate.get(cursor);
    if (!day) break;
    const doses = dayDoses(day);
    if (!doses.length || !doses.every(dose => dose.intake)) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Cumplimiento por medicamento: muestra cuál se olvida con más frecuencia. */
export function adherenceByMedication(days, windowDays = 30, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const rows = new Map();
  for (const day of days.filter(d => d.date >= from && d.date <= today)) {
    for (const dose of dayDoses(day)) {
      const row = rows.get(dose.medId) || { medId: dose.medId, name: dose.name, scheduled: 0, taken: 0 };
      row.scheduled += 1;
      if (dose.intake) row.taken += 1;
      row.name = dose.name;
      rows.set(dose.medId, row);
    }
  }
  return [...rows.values()]
    .map(row => ({ ...row, percent: row.scheduled ? Math.round((row.taken / row.scheduled) * 100) : null }))
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
}

/** A qué hora se registran realmente las tomas, por tramo del día. */
export function intakeHistogram(days, windowDays = 30, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const buckets = [
    { label: "Mañana", hint: "06–12 h", from: 6, to: 12, count: 0 },
    { label: "Tarde", hint: "12–18 h", from: 12, to: 18, count: 0 },
    { label: "Noche", hint: "18–24 h", from: 18, to: 24, count: 0 },
    { label: "Madrugada", hint: "00–06 h", from: 0, to: 6, count: 0 }
  ];
  for (const day of days.filter(d => d.date >= from && d.date <= today)) {
    for (const intake of Object.values(day.medicationIntakes || {})) {
      const hour = Number(String(intake.time || "").slice(0, 2));
      const bucket = buckets.find(b => hour >= b.from && hour < b.to);
      if (bucket) bucket.count += 1;
    }
  }
  return buckets;
}

/* ---------------------------- Presión arterial ---------------------------- */

export function bloodPressureSeries(days, windowDays = 30, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const points = [];
  for (const day of days.filter(d => d.date >= from && d.date <= today)) {
    for (const reading of day.bloodPressure || []) {
      points.push({ date: day.date, time: reading.time, systolic: Number(reading.systolic), diastolic: Number(reading.diastolic), pulse: Number(reading.pulse), source: reading.source || "Manual" });
    }
  }
  return points.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? Math.round(clean.reduce((sum, v) => sum + v, 0) / clean.length) : null;
}

/** Promedios del período. Son un resumen de lo registrado, no un diagnóstico. */
export function bloodPressureSummary(points) {
  if (!points.length) return null;
  return {
    count: points.length,
    systolic: average(points.map(p => p.systolic)),
    diastolic: average(points.map(p => p.diastolic)),
    pulse: average(points.map(p => p.pulse)),
    systolicMin: Math.min(...points.map(p => p.systolic)),
    systolicMax: Math.max(...points.map(p => p.systolic)),
    diastolicMin: Math.min(...points.map(p => p.diastolic)),
    diastolicMax: Math.max(...points.map(p => p.diastolic)),
    first: points[0],
    last: points.at(-1)
  };
}

/** Promedios por tramo del día: útil para la consulta médica. */
export function bloodPressureByTimeOfDay(points) {
  const buckets = [
    { label: "Mañana", hint: "06–12 h", from: 6, to: 12, items: [] },
    { label: "Tarde", hint: "12–18 h", from: 12, to: 18, items: [] },
    { label: "Noche", hint: "18–06 h", from: 18, to: 30, items: [] }
  ];
  for (const point of points) {
    let hour = Number(String(point.time || "").slice(0, 2));
    if (hour < 6) hour += 24;
    const bucket = buckets.find(b => hour >= b.from && hour < b.to);
    if (bucket) bucket.items.push(point);
  }
  return buckets.map(bucket => ({
    label: bucket.label, hint: bucket.hint, count: bucket.items.length,
    systolic: average(bucket.items.map(p => p.systolic)),
    diastolic: average(bucket.items.map(p => p.diastolic)),
    pulse: average(bucket.items.map(p => p.pulse))
  }));
}

/** Promedios diarios con banda mínimo–máximo, para períodos largos. */
export function dailyAverages(points) {
  const byDate = new Map();
  for (const point of points) {
    const list = byDate.get(point.date) || [];
    list.push(point);
    byDate.set(point.date, list);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({
    date,
    systolic: average(items.map(p => p.systolic)),
    diastolic: average(items.map(p => p.diastolic)),
    pulse: average(items.map(p => p.pulse)),
    systolicMin: Math.min(...items.map(p => p.systolic)),
    systolicMax: Math.max(...items.map(p => p.systolic)),
    count: items.length
  }));
}

/** Litros de agua por día en la ventana indicada. */
export function hydrationSeries(days, windowDays = 14, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const byDate = new Map(days.map(day => [day.date, day]));
  const series = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const day = byDate.get(date);
    series.push({ date, waterMl: day?.waterMl || 0, goal: day?.waterGoalSnapshot || 2500 });
  }
  return series;
}
