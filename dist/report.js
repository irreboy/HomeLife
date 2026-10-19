/* Informe para la consulta médica.
 *
 * Genera un documento imprimible (el navegador lo guarda como PDF) y un CSV.
 * El informe transcribe los registros y sus promedios; no incluye
 * clasificaciones ni conclusiones clínicas.
 */

import { dayDoses, dateFromKey, addDays, localDateKey } from "./schedule.js";
import { adherence, adherenceByMedication, bloodPressureSeries, bloodPressureSummary, bloodPressureByTimeOfDay, dailyAverages } from "./stats.js";

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatDate(key, options = { day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("es-CL", options).format(dateFromKey(key));
}

/* --------------------------------- Gráfico -------------------------------- */

/**
 * Gráfico de presión en SVG, sin librerías externas.
 * Hasta ~42 días muestra cada lectura; en períodos largos usa promedios
 * diarios con banda mínimo–máximo, como hacen los monitores de referencia.
 */
export function bpChartSVG(points, { width = 640, height = 220, windowDays = 30 } = {}) {
  if (!points.length) return `<p class="chart-empty">Sin lecturas en el período.</p>`;

  const useAverages = windowDays > 42;
  const series = useAverages ? dailyAverages(points) : points;
  const pad = { top: 16, right: 12, bottom: 28, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const all = series.flatMap(p => [p.systolic, p.diastolic, p.systolicMax, p.systolicMin].filter(Number.isFinite));
  const min = Math.min(...all) - 10;
  const max = Math.max(...all) + 10;
  const span = Math.max(1, max - min);

  const x = i => pad.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = value => pad.top + plotH - ((value - min) / span) * plotH;

  const line = key => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  const band = useAverages
    ? `<path d="${series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.systolicMax).toFixed(1)}`).join(" ")} ${series.slice().reverse().map((p, i) => `L${x(series.length - 1 - i).toFixed(1)},${y(p.systolicMin).toFixed(1)}`).join(" ")} Z" fill="currentColor" opacity=".12"/>`
    : "";

  const gridValues = [min + span * 0.25, min + span * 0.5, min + span * 0.75].map(v => Math.round(v));
  const grid = gridValues.map(v => `<g><line x1="${pad.left}" y1="${y(v).toFixed(1)}" x2="${width - pad.right}" y2="${y(v).toFixed(1)}" stroke="currentColor" opacity=".12"/><text x="4" y="${(y(v) + 4).toFixed(1)}" font-size="10" fill="currentColor" opacity=".6">${v}</text></g>`).join("");

  const dots = useAverages ? "" : series.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.systolic).toFixed(1)}" r="2.5" fill="var(--chart-systolic, #0d766e)"/><circle cx="${x(i).toFixed(1)}" cy="${y(p.diastolic).toFixed(1)}" r="2.5" fill="var(--chart-diastolic, #9a6b00)"/>`).join("");

  const firstLabel = escapeHTML(formatDate(series[0].date, { day: "numeric", month: "short" }));
  const lastLabel = escapeHTML(formatDate(series.at(-1).date, { day: "numeric", month: "short" }));

  return `<svg class="bp-chart" viewBox="0 0 ${width} ${height}" role="img"
    aria-label="Presión sistólica y diastólica registrada entre el ${firstLabel} y el ${lastLabel}">
    ${grid}
    ${band}
    <path d="${line("systolic")}" fill="none" stroke="var(--chart-systolic, #0d766e)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${line("diastolic")}" fill="none" stroke="var(--chart-diastolic, #9a6b00)" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    <text x="${pad.left}" y="${height - 8}" font-size="10" fill="currentColor" opacity=".6">${firstLabel}</text>
    <text x="${width - pad.right}" y="${height - 8}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${lastLabel}</text>
  </svg>
  <p class="chart-legend"><span class="key systolic"></span>Sistólica <span class="key diastolic"></span>Diastólica${useAverages ? " · promedios diarios con banda mínimo–máximo" : ""}</p>`;
}

/* ----------------------------------- CSV ---------------------------------- */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvDocument(rows) {
  // Separador ";" y BOM: así Excel en es-CL abre el archivo en columnas.
  return `﻿${rows.map(row => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function bloodPressureCSV(days, windowDays, today = localDateKey()) {
  const rows = [["Fecha", "Hora", "Sistólica (mmHg)", "Diastólica (mmHg)", "Pulso (bpm)", "Origen"]];
  for (const point of bloodPressureSeries(days, windowDays, today)) {
    rows.push([point.date, point.time, point.systolic, point.diastolic, point.pulse, point.source]);
  }
  return csvDocument(rows);
}

export function intakesCSV(days, windowDays, today = localDateKey()) {
  const from = addDays(today, -(windowDays - 1));
  const rows = [["Fecha", "Medicamento", "Hora programada", "Hora real", "Cantidad indicada", "Cantidad registrada", "Unidad", "Estado", "Nota"]];
  for (const day of days.filter(d => d.date >= from && d.date <= today).sort((a, b) => a.date.localeCompare(b.date))) {
    for (const dose of dayDoses(day)) {
      const status = dose.intake ? "Tomada" : dose.skipped ? "Omitida" : "Sin registro";
      rows.push([day.date, dose.name, dose.time, dose.intake?.time || "", `${dose.doseValue} ${dose.doseUnit}`, dose.intake?.actualAmount ?? "", dose.intake?.unit || "", status, dose.intake?.note || ""]);
    }
  }
  return csvDocument(rows);
}

export function downloadFile(filename, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------------- Informe -------------------------------- */

export function buildReportHTML({ settings, days, notes = [], windowDays = 30, today = localDateKey() }) {
  const from = addDays(today, -(windowDays - 1));
  const points = bloodPressureSeries(days, windowDays, today);
  const summary = bloodPressureSummary(points);
  const byTime = bloodPressureByTimeOfDay(points);
  const meds = adherence(days, windowDays, today);
  const perMed = adherenceByMedication(days, windowDays, today);
  const inWindow = days.filter(d => d.date >= from && d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const dayNotes = inWindow.filter(day => day.notes?.trim());
  // Las preguntas y los síntomas anotados viajan a la consulta con el informe.
  const questions = notes.filter(note => note.kind === "pregunta");
  const symptoms = notes.filter(note => note.kind === "sintoma");

  const activeMeds = (settings.medications || []).filter(m => m.active !== false);

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de registros · ${escapeHTML(settings.personName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #1b2a28; margin: 0 auto; max-width: 820px; padding: 28px; background: #fff; }
  h1 { font-size: 21px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1.5px solid #0d766e; color: #0d766e; text-transform: uppercase; letter-spacing: .04em; }
  .sub { color: #5c6f6c; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 7px; border-bottom: 1px solid #e2eceb; }
  th { background: #f1f7f6; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #44605c; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .card { flex: 1 1 130px; border: 1px solid #dbe8e6; border-radius: 8px; padding: 9px 11px; }
  .card span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #5c6f6c; }
  .card strong { display: block; font-size: 19px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .card small { color: #5c6f6c; }
  .chart { color: #44605c; margin-top: 8px; }
  .chart svg { display: block; width: 100%; max-width: 700px; height: auto; }
  .chart-legend { font-size: 11px; color: #5c6f6c; display: flex; align-items: center; gap: 6px; }
  .key { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .key.systolic { background: #0d766e; } .key.diastolic { background: #9a6b00; }
  ol.questions { margin: 8px 0 0; padding-left: 22px; }
  ol.questions li { margin-bottom: 9px; }
  .notice { margin-top: 26px; padding: 10px 12px; border-left: 3px solid #0d766e; background: #f4f8f7; font-size: 11.5px; color: #44605c; }
  footer { margin-top: 18px; font-size: 10.5px; color: #7c8e8b; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } table, .cards { page-break-inside: avoid; } }
</style></head>
<body>
  <h1>Registros de ${escapeHTML(settings.personName)}</h1>
  <p class="sub">Período: ${escapeHTML(formatDate(from))} a ${escapeHTML(formatDate(today))} (${windowDays} días)</p>
  <p class="sub">Documento generado por la aplicación Mi Día el ${escapeHTML(formatDate(today))}.</p>

  <h2>Presión arterial y pulso</h2>
  ${summary ? `
  <div class="cards">
    <div class="card"><span>Promedio de presión</span><strong>${summary.systolic} / ${summary.diastolic}</strong><small>mmHg · ${summary.count} lecturas</small></div>
    <div class="card"><span>Pulso promedio</span><strong>${summary.pulse ?? "—"}</strong><small>bpm</small></div>
    <div class="card"><span>Rango sistólica</span><strong>${summary.systolicMin}–${summary.systolicMax}</strong><small>mmHg</small></div>
    <div class="card"><span>Rango diastólica</span><strong>${summary.diastolicMin}–${summary.diastolicMax}</strong><small>mmHg</small></div>
  </div>
  <div class="chart">${bpChartSVG(points, { windowDays, width: 700, height: 210 })}</div>
  <table><thead><tr><th>Tramo del día</th><th class="num">Lecturas</th><th class="num">Sistólica</th><th class="num">Diastólica</th><th class="num">Pulso</th></tr></thead><tbody>
  ${byTime.map(bucket => `<tr><td>${bucket.label} <small>(${bucket.hint})</small></td><td class="num">${bucket.count}</td><td class="num">${bucket.systolic ?? "—"}</td><td class="num">${bucket.diastolic ?? "—"}</td><td class="num">${bucket.pulse ?? "—"}</td></tr>`).join("")}
  </tbody></table>` : `<p class="sub">No hay lecturas registradas en el período.</p>`}

  <h2>Medicamentos de la pauta vigente</h2>
  ${activeMeds.length ? `<table><thead><tr><th>Medicamento</th><th>Dosis</th><th>Horarios</th><th>Frecuencia</th><th>Desde</th></tr></thead><tbody>
  ${activeMeds.map(med => `<tr><td>${escapeHTML(med.name)}</td><td>${escapeHTML([med.dosage, med.amount].filter(Boolean).join(" · "))}</td><td>${escapeHTML((Array.isArray(med.times) && med.times.length ? med.times : [med.reminderTime]).filter(Boolean).join(", "))}</td><td>${med.period === "daily" ? "Diaria" : `Cada ${med.everyDays} días`}</td><td>${escapeHTML(med.startDate || "—")}</td></tr>`).join("")}
  </tbody></table>` : `<p class="sub">Sin medicamentos activos.</p>`}

  <h2>Registro de tomas</h2>
  <div class="cards">
    <div class="card"><span>Tomas registradas</span><strong>${meds.percent === null ? "—" : `${meds.percent}%`}</strong><small>${meds.taken} de ${meds.scheduled} programadas</small></div>
    <div class="card"><span>Sin registro</span><strong>${meds.missed}</strong><small>tomas</small></div>
    <div class="card"><span>Omitidas a propósito</span><strong>${meds.skipped}</strong><small>tomas</small></div>
  </div>
  ${perMed.length ? `<table><thead><tr><th>Medicamento</th><th class="num">Programadas</th><th class="num">Registradas</th><th class="num">Porcentaje</th></tr></thead><tbody>
  ${perMed.map(row => `<tr><td>${escapeHTML(row.name)}</td><td class="num">${row.scheduled}</td><td class="num">${row.taken}</td><td class="num">${row.percent === null ? "—" : `${row.percent}%`}</td></tr>`).join("")}
  </tbody></table>` : ""}

  <h2>Lecturas detalladas</h2>
  ${points.length ? `<table><thead><tr><th>Fecha</th><th>Hora</th><th class="num">Sistólica</th><th class="num">Diastólica</th><th class="num">Pulso</th><th>Origen</th></tr></thead><tbody>
  ${points.slice().reverse().map(point => `<tr><td>${escapeHTML(formatDate(point.date, { day: "2-digit", month: "2-digit", year: "numeric" }))}</td><td>${escapeHTML(point.time)}</td><td class="num">${point.systolic}</td><td class="num">${point.diastolic}</td><td class="num">${point.pulse}</td><td>${escapeHTML(point.source)}</td></tr>`).join("")}
  </tbody></table>` : `<p class="sub">Sin lecturas.</p>`}

  ${questions.length ? `<h2>Preguntas para la consulta</h2><ol class="questions">
  ${questions.map(note => `<li><strong>${escapeHTML(note.title || "Pregunta")}</strong>${note.body ? `<br>${escapeHTML(note.body)}` : ""}</li>`).join("")}
  </ol>` : ""}

  ${symptoms.length ? `<h2>Síntomas anotados</h2><table><thead><tr><th>Fecha</th><th>Descripción</th></tr></thead><tbody>
  ${symptoms.map(note => `<tr><td>${escapeHTML(formatDate(String(note.updatedAt).slice(0, 10), { day: "2-digit", month: "2-digit" }))}</td><td>${escapeHTML([note.title, note.body].filter(Boolean).join(" — "))}</td></tr>`).join("")}
  </tbody></table>` : ""}

  ${dayNotes.length ? `<h2>Observaciones del día a día</h2><table><thead><tr><th>Fecha</th><th>Nota</th></tr></thead><tbody>
  ${dayNotes.map(day => `<tr><td>${escapeHTML(formatDate(day.date, { day: "2-digit", month: "2-digit" }))}</td><td>${escapeHTML(day.notes.trim())}</td></tr>`).join("")}
  </tbody></table>` : ""}

  <div class="notice">
    <strong>Sobre este documento.</strong> Reúne lo que ${escapeHTML(settings.personName)} registró en su agenda personal,
    con sus promedios. No contiene diagnósticos, clasificaciones ni interpretación de las cifras,
    y no reemplaza una evaluación profesional. Las horas corresponden a la hora local del teléfono.
  </div>
  <footer>Mi Día · Vida Saludable — datos guardados únicamente en el dispositivo.</footer>
</body></html>`;
}

/** Abre el informe en una pestaña nueva y ofrece imprimir o guardar como PDF. */
export function openReport(html) {
  const tab = window.open("", "_blank");
  if (!tab) return false;
  tab.document.write(html);
  tab.document.close();
  tab.focus();
  setTimeout(() => { try { tab.print(); } catch { /* el usuario puede imprimir manualmente */ } }, 400);
  return true;
}
