/**
 * Business-forward Excel export: Summary tab (KPIs + charts) + Detail tab.
 * Uses ExcelJS for styling / multi-sheet and Chart.js for embedded chart images.
 */

import ExcelJS from 'exceljs';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const BRAND = {
  magenta: 'C41E6A',
  dark: '1A1A2E',
  muted: '6B7280',
  lightBg: 'F8F5F7',
  headerBg: 'C41E6A',
  headerFg: 'FFFFFF',
  accentBlue: '2563EB',
  accentGreen: '059669',
  accentOrange: 'EA580C',
};

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  return v;
}

function safeSheetName(name) {
  return String(name || 'Sheet').replace(/[:\\/?*\[\]]/g, '').slice(0, 31) || 'Sheet';
}

async function renderChartPng({ type = 'bar', labels, datasets, width = 720, height = 360 }) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const chart = new Chart(canvas.getContext('2d'), {
    type,
    data: { labels, datasets },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        title: { display: false },
      },
      scales: type === 'doughnut' || type === 'pie' ? undefined : {
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, precision: 0 } },
      },
    },
  });
  // Let Chart.js paint once.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dataUrl = canvas.toDataURL('image/png');
  chart.destroy();
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function countBy(rows, key) {
  const map = {};
  for (const row of rows) {
    let v = row[key];
    if (v == null || v === '') v = '(blank)';
    if (Array.isArray(v)) v = v.join(', ') || '(blank)';
    const label = String(v);
    map[label] = (map[label] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

/**
 * Build default Summary analytics when a preset does not supply its own.
 */
export function buildAutoSummary(rows, columns) {
  const keys = new Set(columns.map((c) => c.key));
  const kpis = [
    { label: 'Total records', value: rows.length },
  ];
  const charts = [];

  const stageKey = keys.has('current_stage') ? 'current_stage'
    : keys.has('stage') ? 'stage'
    : keys.has('to_stage') ? 'to_stage'
    : null;
  if (stageKey) {
    const byStage = countBy(rows, stageKey).slice(0, 16);
    kpis.push({ label: 'Distinct stages', value: byStage.length });
    charts.push({
      title: 'Volume by stage',
      type: 'bar',
      labels: byStage.map((x) => x.label),
      datasets: [{
        label: 'Count',
        data: byStage.map((x) => x.count),
        backgroundColor: `#${BRAND.magenta}CC`,
        borderColor: `#${BRAND.magenta}`,
        borderWidth: 1,
      }],
    });
  }

  const marketerKey = keys.has('__marketer_name') ? '__marketer_name'
    : keys.has('marketer') ? 'marketer'
    : null;
  if (marketerKey) {
    const byM = countBy(rows, marketerKey).slice(0, 10);
    charts.push({
      title: 'Top marketers',
      type: 'bar',
      labels: byM.map((x) => x.label),
      datasets: [{
        label: 'Referrals',
        data: byM.map((x) => x.count),
        backgroundColor: `#${BRAND.accentBlue}CC`,
        borderColor: `#${BRAND.accentBlue}`,
        borderWidth: 1,
      }],
    });
  }

  const divisionKey = keys.has('division') ? 'division' : null;
  if (divisionKey) {
    const byDiv = countBy(rows, divisionKey);
    charts.push({
      title: 'By division',
      type: 'doughnut',
      labels: byDiv.map((x) => x.label),
      datasets: [{
        data: byDiv.map((x) => x.count),
        backgroundColor: [`#${BRAND.magenta}`, `#${BRAND.accentBlue}`, `#${BRAND.accentGreen}`, `#${BRAND.accentOrange}`],
      }],
    });
  }

  const ownerKey = keys.has('__intake_owner') ? '__intake_owner'
    : keys.has('__actor_name') ? '__actor_name'
    : null;
  if (ownerKey && !marketerKey) {
    const byO = countBy(rows, ownerKey).slice(0, 12);
    charts.push({
      title: 'By staff',
      type: 'bar',
      labels: byO.map((x) => x.label),
      datasets: [{
        label: 'Count',
        data: byO.map((x) => x.count),
        backgroundColor: `#${BRAND.accentGreen}CC`,
        borderColor: `#${BRAND.accentGreen}`,
        borderWidth: 1,
      }],
    });
  }

  return { kpis, charts };
}

/**
 * @param {object} opts
 * @param {object[]} opts.rows
 * @param {{key:string,label:string}[]} opts.columns
 * @param {string} opts.reportTitle
 * @param {string} [opts.subtitle]
 * @param {{ kpis?: {label:string,value:string|number}[], charts?: object[] }} [opts.summary]
 */
export async function exportReportWorkbook({
  rows,
  columns,
  reportTitle,
  subtitle = '',
  summary = null,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wellbound CareStream';
  wb.created = new Date();

  const auto = summary || buildAutoSummary(rows, columns);
  const kpis = auto.kpis || [];
  const charts = auto.charts || [];

  // ── Summary sheet ─────────────────────────────────────────────────────────
  const summaryWs = wb.addWorksheet(safeSheetName('Summary'), {
    properties: { tabColor: { argb: BRAND.magenta } },
  });

  summaryWs.mergeCells('A1:F1');
  const titleCell = summaryWs.getCell('A1');
  titleCell.value = reportTitle;
  titleCell.font = { name: 'Calibri', size: 20, bold: true, color: { argb: BRAND.dark } };
  titleCell.alignment = { vertical: 'middle' };
  summaryWs.getRow(1).height = 28;

  summaryWs.mergeCells('A2:F2');
  summaryWs.getCell('A2').value = 'Wellbound CareStream';
  summaryWs.getCell('A2').font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.magenta } };

  summaryWs.mergeCells('A3:F3');
  summaryWs.getCell('A3').value = subtitle || `Generated ${new Date().toLocaleString()}`;
  summaryWs.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: BRAND.muted } };

  let rowIdx = 5;
  summaryWs.getCell(`A${rowIdx}`).value = 'Key metrics';
  summaryWs.getCell(`A${rowIdx}`).font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND.dark } };
  rowIdx += 1;

  for (const kpi of kpis) {
    summaryWs.getCell(`A${rowIdx}`).value = kpi.label;
    summaryWs.getCell(`A${rowIdx}`).font = { name: 'Calibri', size: 10, color: { argb: BRAND.muted } };
    summaryWs.getCell(`B${rowIdx}`).value = kpi.value;
    summaryWs.getCell(`B${rowIdx}`).font = { name: 'Calibri', size: 14, bold: true, color: { argb: BRAND.dark } };
    rowIdx += 1;
  }

  rowIdx += 1;
  let chartRow = rowIdx;

  for (let i = 0; i < charts.length; i++) {
    const chart = charts[i];
    summaryWs.getCell(`A${chartRow}`).value = chart.title || `Chart ${i + 1}`;
    summaryWs.getCell(`A${chartRow}`).font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.dark } };
    chartRow += 1;

    try {
      const png = await renderChartPng({
        type: chart.type || 'bar',
        labels: chart.labels || [],
        datasets: chart.datasets || [],
        width: chart.type === 'doughnut' || chart.type === 'pie' ? 480 : 720,
        height: 320,
      });
      if (png) {
        const imageId = wb.addImage({ buffer: png, extension: 'png' });
        summaryWs.addImage(imageId, {
          tl: { col: 0, row: chartRow - 1 },
          ext: { width: chart.type === 'doughnut' || chart.type === 'pie' ? 360 : 520, height: 240 },
        });
        chartRow += 14;
      }
    } catch {
      summaryWs.getCell(`A${chartRow}`).value = '(Chart could not be rendered in this browser)';
      chartRow += 2;
    }
    chartRow += 1;
  }

  if (!charts.length) {
    summaryWs.getCell(`A${chartRow}`).value = 'Open the Detail tab for the full row-level export.';
    summaryWs.getCell(`A${chartRow}`).font = { name: 'Calibri', size: 10, italic: true, color: { argb: BRAND.muted } };
  }

  summaryWs.getColumn(1).width = 28;
  summaryWs.getColumn(2).width = 18;

  // ── Detail sheet ──────────────────────────────────────────────────────────
  const detailWs = wb.addWorksheet(safeSheetName('Detail'), {
    properties: { tabColor: { argb: BRAND.accentBlue } },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = detailWs.addRow(columns.map((c) => c.label));
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.headerBg } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.headerFg } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: '9F1654' } },
    };
  });
  headerRow.height = 22;

  for (const row of rows) {
    const dataRow = detailWs.addRow(columns.map((c) => cellValue(row[c.key])));
    dataRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: BRAND.dark } };
      cell.alignment = { vertical: 'middle', wrapText: false };
    });
  }

  columns.forEach((col, i) => {
    let max = String(col.label || '').length;
    for (let r = 0; r < Math.min(rows.length, 80); r++) {
      const len = String(cellValue(rows[r][col.key])).length;
      if (len > max) max = len;
    }
    detailWs.getColumn(i + 1).width = Math.min(Math.max(max + 2, 10), 42);
  });

  // Optional Chart Data sheet (raw series for Excel's native charting)
  if (charts.length) {
    const chartDataWs = wb.addWorksheet(safeSheetName('Chart Data'), {
      properties: { tabColor: { argb: BRAND.accentOrange } },
    });
    let r = 1;
    for (const chart of charts) {
      chartDataWs.getCell(r, 1).value = chart.title || 'Chart';
      chartDataWs.getCell(r, 1).font = { bold: true };
      r += 1;
      chartDataWs.getCell(r, 1).value = 'Label';
      chartDataWs.getCell(r, 2).value = (chart.datasets?.[0]?.label) || 'Value';
      r += 1;
      const labels = chart.labels || [];
      const data = chart.datasets?.[0]?.data || [];
      for (let i = 0; i < labels.length; i++) {
        chartDataWs.getCell(r, 1).value = labels[i];
        chartDataWs.getCell(r, 2).value = data[i];
        r += 1;
      }
      r += 2;
    }
    chartDataWs.getColumn(1).width = 28;
    chartDataWs.getColumn(2).width = 14;
  }

  const date = new Date().toISOString().split('T')[0];
  const filename = `${String(reportTitle).replace(/\s+/g, '_')}_${date}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
