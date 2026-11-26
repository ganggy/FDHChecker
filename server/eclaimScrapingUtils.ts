/**
 * Pure helper utilities for NHSO e-Claim scraping, filename deduplication,
 * fund/type classification, and download link scoring.
 */

export type EclaimFileType = 'REP' | 'STM' | 'INV';

/**
 * Generates normalized filename stem aliases so legacy Statement IDs
 * (e.g. `11101_OP202605_01`), prefixed names (`STM_11101_OP202605_01.xls`),
 * and browser duplicate suffixes (` (1)`) match consistently.
 */
export function getFilenameStemAliases(name: string): string[] {
  const base = String(name || '')
    .trim()
    .split(/[\\/]/)
    .pop() || '';
  if (!base) return [];

  const withoutSheet = base.replace(/\s+\[.*\]$/, '');
  const withoutExt = withoutSheet.replace(/\.(ecd|xls|xlsx|zip|csv|txt)$/i, '');
  const normalized = withoutExt
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim()
    .toLowerCase();
  if (!normalized) return [];

  const aliases = new Set<string>([normalized]);
  const rawLower = withoutExt.trim().toLowerCase();
  if (rawLower && rawLower !== normalized) {
    aliases.add(rawLower);
  }

  const prefixMatch = normalized.match(/^(?:stm|rep|inv)_(.+)$/);
  if (prefixMatch?.[1]) {
    aliases.add(prefixMatch[1]);
  } else if (/^\d{5}_(?:op|ip)(?:ucs|cs|lgo|bkk|ofc|sss)?20\d{4}_\d+/.test(normalized)) {
    aliases.add(`stm_${normalized}`);
  }

  return Array.from(aliases);
}

/**
 * Infers the actual e-Claim file type from filename when pages mix REP and STM rows.
 */
export function inferDetectedTypeFromFilename(
  filename: string,
  defaultType: EclaimFileType
): EclaimFileType {
  const f = String(filename || '').trim();
  if (!f) return defaultType;
  const upper = f.toUpperCase();

  if (
    /^STM_|COCDSTM|SOCDSTM|FOCDSTM|LGO-HD|\d{5}_(?:OP|IP)(?:UCS|CS|LGO|BKK|OFC|SSS)?20\d{4}_\d+/i.test(upper)
  ) {
    return 'STM';
  }
  if (/^ECLAIM_|\bREP[_-]/i.test(upper) && !upper.includes('STM')) {
    return 'REP';
  }
  if (/^INV_|\bINV[_-]/i.test(upper)) {
    return 'INV';
  }
  return defaultType;
}

/**
 * Maps Thai/English e-Claim benefit scheme labels to canonical 3-letter fund codes.
 */
export function inferFundFromBenefitLabel(label: string, fallback = ''): string {
  const text = String(label || '').trim();
  if (!text) return fallback;
  const upper = text.toUpperCase();

  if (/ข้าราชการ|CSMBS|\bOFC\b|กรมบัญชีกลาง|CSCD/.test(upper)) return 'OFC';
  if (/อปท|ท้องถิ่น|\bLGO\b/.test(upper)) return 'LGO';
  if (/กทม|กรุงเทพ|\bBKK\b/.test(upper)) return 'BKK';
  if (/ประกันสังคม|\bSSS\b|SSOP/.test(upper)) return 'SSS';
  if (/บัตรทอง|หลักประกันสุขภาพ|\bUCS\b|\bUC\b/.test(upper)) return 'UCS';
  return fallback || upper;
}

export interface ScoreDownloadLinkInput {
  href: string;
  onclick: string;
  label: string;
  title?: string;
  ariaLabel?: string;
  colHeader?: string;
  linkIndex: number;
  isStatementReportPage?: boolean;
}

export interface ScoreDownloadLinkResult {
  score: number;
  isPdf: boolean;
  isEcd: boolean;
  isExcelExplicit: boolean;
  isExcelOrZip: boolean;
}

/**
 * Scores candidate download links in an e-Claim table row so detail Excel/ZIP
 * columns (`Download Statement`) beat summary PDF form columns (`แบบ 7119_2`, `แบบ 7106`).
 */
export function scoreEclaimDownloadLink(input: ScoreDownloadLinkInput): ScoreDownloadLinkResult {
  const href = String(input.href || '');
  const onclick = String(input.onclick || '');
  const label = String(input.label || '');
  const title = String(input.title || '');
  const ariaLabel = String(input.ariaLabel || '');
  const colHeader = String(input.colHeader || '');
  const combined = `${href} ${onclick} ${label} ${title} ${ariaLabel} ${colHeader}`;

  const isEcd = /\.ecd(?:$|[?#'"\s])/i.test(combined);
  const isSummaryFormColumn = /7119|7106|หนังสือแจ้งการโอน|คำขอเบิก|ใบสรุป|ใบสำคัญรับเงิน|รายงานสรุป|printpdf|reportpdf|\.pdf(?:$|[?#'"\s])|\bpdf\b/i.test(
    `${colHeader} ${href} ${onclick} ${label} ${title}`
  );
  const isPdf = isSummaryFormColumn;
  const isStatementHeader = /download\s*statement|ดาวน์โหลด\s*statement|^statement$/i.test(colHeader);
  const isExcelExplicit = /download\s*excel|excel\s*file|ดาวน์โหลด\s*excel/i.test(combined) || isStatementHeader;
  const isExcelOrZip = /excel|\.xlsx?|\.zip|\.csv|export|detail|รายละเอียด|rep_|stm_|statement/i.test(combined);

  let score = 0;
  if (isEcd) score -= 500;
  if (isPdf) score -= 350;
  if (isStatementHeader) score += 240;
  if (isExcelExplicit) score += 150;
  if (isExcelOrZip) score += 100;

  if (input.isStatementReportPage) {
    if (input.linkIndex === 0 && !isPdf && !isEcd) {
      score += 120;
    }
  } else {
    score += input.linkIndex * 10;
  }

  return { score, isPdf, isEcd, isExcelExplicit, isExcelOrZip };
}
