import type mysql from 'mysql2/promise';
import businessRules from './config/business_rules.json';
import { ensureRepstmTables, getRepstmConnection } from './db.js';

type PpfsMetric = 'SUM_PAID' | 'CNT_VISIT' | 'CNT_PID';

interface PpfsDataset {
  label: string;
  data: number[];
}

interface PpfsPivotRow {
  group_name: string;
  item_name: string;
  pid_2567: number;
  visit_2567: number;
  paid_2567: number;
  pid_2568: number;
  visit_2568: number;
  paid_2568: number;
  pid_2569: number;
  visit_2569: number;
  paid_2569: number;
}

interface PpfsLocalYearRow {
  fiscal_year: string;
  stm_cases: number;
  stm_paid_amount: number;
  stm_amount: number;
  latest_import_at: string | null;
}

const PPFS_METRICS: Record<PpfsMetric, string> = {
  SUM_PAID: 'จำนวนเงินที่จ่าย (บาท)',
  CNT_VISIT: 'จำนวนครั้งบริการ',
  CNT_PID: 'ผู้รับบริการ (คน)',
};

const toText = (value: unknown) => String(value ?? '').trim();

const toNumber = (value: unknown) => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const stripTags = (html: string) => html
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#039;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const parseJsonArray = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const extractBalancedArray = (text: string, startIndex: number) => {
  const open = text.indexOf('[', startIndex);
  if (open < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (depth === 0) return text.slice(open, index + 1);
  }
  return '';
};

const extractChartBlock = (html: string, chartId: string) => {
  const marker = `document.getElementById('${chartId}')`;
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const next = html.indexOf('// ', start + marker.length);
  return html.slice(start, next > start ? next : Math.min(html.length, start + 60000));
};

const parseBarChart = (html: string) => {
  const block = extractChartBlock(html, 'chartBar');
  const labelIndex = block.indexOf('labels:');
  const datasetIndex = block.indexOf('datasets:');
  const labels = parseJsonArray<string[]>(extractBalancedArray(block, labelIndex), []);
  const datasets = parseJsonArray<PpfsDataset[]>(extractBalancedArray(block, datasetIndex), []);

  return labels.map((label, index) => ({
    pgroup: label,
    paid_2567: toNumber(datasets.find((item) => item.label === '2567')?.data[index]),
    paid_2568: toNumber(datasets.find((item) => item.label === '2568')?.data[index]),
    paid_2569: toNumber(datasets.find((item) => item.label === '2569')?.data[index]),
  }));
};

const parseLineChart = (html: string) => {
  const block = extractChartBlock(html, 'chartLine');
  const labels = parseJsonArray<string[]>(extractBalancedArray(block, block.indexOf('labels:')), []);
  const datasets: Array<{ access_group: string; values: number[]; total: number; latest_value: number }> = [];
  const datasetRegex = /"label":"([^"]+)"[\s\S]*?"data":(\[[^\]]*\])/g;
  let match: RegExpExecArray | null;
  while ((match = datasetRegex.exec(block))) {
    const values = parseJsonArray<number[]>(match[2], []);
    datasets.push({
      access_group: match[1],
      values,
      total: values.reduce((sum, value) => sum + toNumber(value), 0),
      latest_value: values.length ? toNumber(values[values.length - 1]) : 0,
    });
  }
  return {
    months: labels,
    series: datasets.sort((a, b) => b.total - a.total),
  };
};

const parseDonutChart = (html: string) => {
  const block = extractChartBlock(html, 'chartDonut');
  const labels = parseJsonArray<Array<string | { name?: string; value?: number }>>(extractBalancedArray(block, block.indexOf('labels:')), []);
  const dataMarker = block.indexOf('data:', block.indexOf('datasets:'));
  const values = parseJsonArray<Array<number | { name?: string; value?: number }>>(extractBalancedArray(block, dataMarker), []);
  return labels
    .map((label, index) => {
      const value = values[index];
      return {
        access_group: typeof label === 'object' ? String(label.name || '') : String(label),
        value: typeof value === 'object' ? toNumber(value.value) : toNumber(value),
      };
    })
    .sort((a, b) => b.value - a.value);
};

const parseKpiCards = (html: string) => {
  const cards: Array<{ fiscal_year: string; display_value: string; metric_label: string; numeric_value: number | null }> = [];
  const cardRegex = /<div class="kpi-card[\s\S]*?<div class="kpi-yr"[^>]*>ปี\s*(\d+)<\/div>[\s\S]*?<div class="kpi-value"[^>]*>([^<]*)<\/div>[\s\S]*?<div class="kpi-label">([^<]*)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = cardRegex.exec(html))) {
    cards.push({
      fiscal_year: match[1],
      display_value: stripTags(match[2]),
      metric_label: stripTags(match[3]),
      numeric_value: null,
    });
  }
  return cards;
};

const parsePivotRows = (html: string): PpfsPivotRow[] => {
  const tbodyMatch = html.match(/<table id="hcTable"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];
  const rows: PpfsPivotRow[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tbodyMatch[1]))) {
    const cells = Array.from(trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((cell) => stripTags(cell[1]));
    if (cells.length < 11) continue;
    rows.push({
      group_name: cells[0],
      item_name: cells[1],
      pid_2567: toNumber(cells[2]),
      visit_2567: toNumber(cells[3]),
      paid_2567: toNumber(cells[4]),
      pid_2568: toNumber(cells[5]),
      visit_2568: toNumber(cells[6]),
      paid_2568: toNumber(cells[7]),
      pid_2569: toNumber(cells[8]),
      visit_2569: toNumber(cells[9]),
      paid_2569: toNumber(cells[10]),
    });
  }
  return rows;
};

const getDefaultHcode = () => {
  const rules = businessRules as any;
  return toText(rules?.site_settings?.hospital_code || rules?.hospital?.hcode || '11101') || '11101';
};

const getHospitalInfo = (html: string) => {
  const title = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  const rules = businessRules as any;
  return {
    title,
    hospital_name: toText(rules?.site_settings?.hospital_name) || title.replace(/^PPFS\s*\|\s*/i, ''),
    hcode: getDefaultHcode(),
    region: toText(rules?.site_settings?.nhso_region),
    province: toText(rules?.site_settings?.province),
  };
};

const getFiscalRange = (thaiFiscalYear: number) => ({
  start: `${thaiFiscalYear - 544}-10-01`,
  end: `${thaiFiscalYear - 543}-09-30`,
});

const getLocalStmSummary = async (): Promise<PpfsLocalYearRow[]> => {
  let connection: mysql.PoolConnection | null = null;
  try {
    await ensureRepstmTables();
    connection = await getRepstmConnection();
    const years = [2567, 2568, 2569];
    const clauses = years.map(() => `
      SELECT ? AS fiscal_year,
             COUNT(DISTINCT COALESCE(NULLIF(vn, ''), NULLIF(an, ''), NULLIF(tran_id, ''), record_uid)) AS stm_cases,
             ROUND(SUM(CASE
               WHEN paid_amount IS NOT NULL AND paid_amount <> 0 THEN paid_amount
               ELSE COALESCE(amount, 0)
             END), 2) AS stm_paid_amount,
             ROUND(SUM(COALESCE(amount, 0)), 2) AS stm_amount,
             DATE_FORMAT(MAX(created_at), '%Y-%m-%d %H:%i:%s') AS latest_import_at
      FROM repstm_statement_data
      WHERE data_type = 'STM'
        AND DATE(COALESCE(service_datetime, senddate, created_at)) BETWEEN ? AND ?
    `);
    const params: unknown[] = [];
    years.forEach((year) => {
      const range = getFiscalRange(year);
      params.push(String(year), range.start, range.end);
    });
    const [rows] = await connection.query(clauses.join(' UNION ALL '), params);
    return (Array.isArray(rows) ? rows : []).map((row: any) => ({
      fiscal_year: String(row.fiscal_year || ''),
      stm_cases: toNumber(row.stm_cases),
      stm_paid_amount: toNumber(row.stm_paid_amount),
      stm_amount: toNumber(row.stm_amount),
      latest_import_at: row.latest_import_at ? String(row.latest_import_at) : null,
    }));
  } catch (error) {
    console.warn('Cannot load local STM summary for PPFS benchmark:', error);
    return [];
  } finally {
    connection?.release();
  }
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const getPpfsNhsoReport = async (options: { hcode?: string; metric?: string }) => {
  const hcode = toText(options.hcode || getDefaultHcode()) || '11101';
  const metric = (toText(options.metric || 'SUM_PAID').toUpperCase() as PpfsMetric);
  const safeMetric: PpfsMetric = metric in PPFS_METRICS ? metric : 'SUM_PAID';
  const url = `https://khonkaen2.nhso.go.th/mis/ppfs2569/hcode.php?hcode=${encodeURIComponent(hcode)}&metric=${encodeURIComponent(safeMetric)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'FDHChecker/1.0 PPFS benchmark',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`NHSO PPFS report HTTP ${response.status}`);
  }
  const html = await response.text();
  const pivotRows = parsePivotRows(html);
  const pgroupRows = parseBarChart(html);
  const localRows = await withTimeout(getLocalStmSummary(), 6000, []);
  const localByYear = new Map(localRows.map((row) => [row.fiscal_year, row]));
  const years = ['2567', '2568', '2569'];
  const yearSummary = years.map((year) => {
    const paid = pivotRows.reduce((sum, row) => sum + toNumber((row as any)[`paid_${year}`]), 0);
    const visits = pivotRows.reduce((sum, row) => sum + toNumber((row as any)[`visit_${year}`]), 0);
    const people = pivotRows.reduce((sum, row) => sum + toNumber((row as any)[`pid_${year}`]), 0);
    const metricValue = safeMetric === 'CNT_VISIT'
      ? visits
      : safeMetric === 'CNT_PID'
        ? people
        : paid;
    const local = localByYear.get(year) || null;
    return {
      fiscal_year: year,
      nhso_metric_value: Math.round(metricValue * 100) / 100,
      nhso_paid: Math.round(paid * 100) / 100,
      nhso_visits: visits,
      nhso_people: people,
      local_stm_cases: local?.stm_cases ?? 0,
      local_stm_paid_amount: local?.stm_paid_amount ?? 0,
      local_stm_amount: local?.stm_amount ?? 0,
      latest_local_import_at: local?.latest_import_at ?? null,
      paid_gap_vs_local_stm: local ? Math.round((paid - local.stm_paid_amount) * 100) / 100 : null,
    };
  });

  const topItems2569 = [...pivotRows]
    .sort((a, b) => b.paid_2569 - a.paid_2569)
    .slice(0, 25);

  return {
    fetched_at: new Date().toISOString(),
    source_url: url,
    hcode,
    metric: safeMetric,
    metric_label: PPFS_METRICS[safeMetric],
    hospital: getHospitalInfo(html),
    kpi_cards: parseKpiCards(html),
    year_summary: yearSummary,
    pgroup_yearly: pgroupRows,
    monthly_access: parseLineChart(html),
    access_share: parseDonutChart(html),
    pivot_rows: pivotRows,
    top_items_2569: topItems2569,
    local_note: 'ยอดของเราในรอบแรกอิง STM ที่นำเข้าแล้วทุกกองทุน จึงใช้ดูแนวโน้ม/ช่องว่างเบื้องต้น ยังไม่ใช่ยอด PPFS ที่ map รายการครบทุก PGROUP',
  };
};
