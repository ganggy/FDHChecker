import type { HospitalConnection } from './hospitalDatabase.js';
import { activeHospitalDatabaseConfig } from './hospitalDatabase.js';
import { readHospitalSchema } from './hospitalSchema.js';
import { readHospitalIdentity } from './siteProfile.js';

export interface TableCheckItem {
  table: string;
  required: boolean;
  exists: boolean;
  missingColumns?: string[];
  description: string;
}

export interface CatalogCheckItem {
  catalog: string;
  total: number;
  ready: number;
  percent: number;
  description: string;
  status: 'good' | 'warning' | 'critical';
}

export interface FeatureCapabilityItem {
  id: string;
  name: string;
  status: 'ready' | 'needs_config' | 'partial' | 'disabled';
  statusLabel: string;
  details: string;
  actionTab?: string;
}

export interface HospitalReadinessReport {
  timestamp: string;
  hospital: {
    hospital_code: string;
    hospital_name: string;
    database_type: 'mysql' | 'postgresql';
    database_name: string;
  };
  overallScore: number;
  readinessLevel: 'READY' | 'NEEDS_ATTENTION' | 'INCOMPLETE';
  schemaChecks: TableCheckItem[];
  catalogChecks: CatalogCheckItem[];
  authenSource: {
    detectedSources: string[];
    primarySource: string;
    status: 'ready' | 'partial' | 'missing';
  };
  capabilities: FeatureCapabilityItem[];
  recommendations: string[];
}

/**
 * Core table definitions required by FDH Checker
 */
const CORE_TABLES: Array<{ table: string; required: boolean; columns: string[]; description: string }> = [
  { table: 'patient', required: true, columns: ['hn', 'cid', 'pname', 'fname', 'lname', 'birthday'], description: 'ข้อมูลประชากร/ผู้ป่วย' },
  { table: 'ovst', required: true, columns: ['vn', 'hn', 'vstdate', 'vsttime', 'pttype'], description: 'ข้อมูลการมารับบริการผู้ป่วยนอก (OPD)' },
  { table: 'ovstdiag', required: true, columns: ['vn', 'icd10', 'diagtype'], description: 'การวินิจฉัยโรคผู้ป่วยนอก' },
  { table: 'opitemrece', required: true, columns: ['vn', 'hn', 'an', 'icode', 'qty', 'unitprice', 'sum_price'], description: 'รายการยาและค่ารักษาพยาบาล' },
  { table: 'drugitems', required: true, columns: ['icode', 'name'], description: 'คลังรายการยา' },
  { table: 'nondrugitems', required: true, columns: ['icode', 'name'], description: 'คลังค่าบริการ/แล็บ/หัตถการ' },
  { table: 'pttype', required: true, columns: ['pttype', 'name'], description: 'สิทธิการรักษาพยาบาล' },
  { table: 'ipt', required: false, columns: ['an', 'hn', 'vn', 'dchdate', 'dchtime', 'regdate'], description: 'ข้อมูลผู้ป่วยใน (IPD)' },
  { table: 'iptdiag', required: false, columns: ['an', 'icd10', 'diagtype'], description: 'การวินิจฉัยโรคผู้ป่วยใน' },
  { table: 'income', required: false, columns: ['income', 'name'], description: 'หมวดรายได้ค่ารักษาพยาบาล' },
  { table: 'spclty', required: false, columns: ['spclty', 'name'], description: 'แผนก/ความเชี่ยวชาญ' },
  { table: 'ward', required: false, columns: ['ward', 'name'], description: 'หอผู้ป่วยใน' },
  { table: 'ovstist', required: false, columns: ['ovstist', 'name'], description: 'สถานภาพการมารับบริการ' },
  { table: 'dtmain', required: false, columns: ['vn', 'hn'], description: 'ข้อมูลบริการทันตกรรม' },
];

/**
 * Inspects hospital HOSxP database readiness and compatibility
 */
export async function inspectHospitalReadiness(
  connection: HospitalConnection,
  extraConfig?: {
    fdhApiConfigured?: boolean;
    localAiAvailable?: boolean;
    siteSettings?: Record<string, unknown>;
  }
): Promise<HospitalReadinessReport> {
  const timestamp = new Date().toISOString();

  // 1. Hospital Identity
  let identity = { hospital_name: '', hospital_code: '' };
  try {
    identity = await readHospitalIdentity(connection);
  } catch {
    identity = { hospital_name: 'ไม่สามารถอ่านชื่อ รพ.', hospital_code: '' };
  }

  // 2. Schema Checks
  const tablesToCheck = CORE_TABLES.map(t => t.table);
  tablesToCheck.push('authenhos', 'nhso_authen', 'visit_pttype', 'sys_var', 'eclaimdb');
  const hasSchema = await readHospitalSchema(connection, tablesToCheck);

  const schemaChecks: TableCheckItem[] = [];
  let requiredTablesPresent = 0;
  let totalRequiredTables = 0;

  for (const tableDef of CORE_TABLES) {
    if (tableDef.required) totalRequiredTables += 1;
    const tableExists = hasSchema(tableDef.table);
    if (tableExists && tableDef.required) requiredTablesPresent += 1;

    const missingCols: string[] = [];
    if (tableExists) {
      for (const col of tableDef.columns) {
        if (!hasSchema(tableDef.table, col)) {
          missingCols.push(col);
        }
      }
    }

    schemaChecks.push({
      table: tableDef.table,
      required: tableDef.required,
      exists: tableExists,
      missingColumns: missingCols.length ? missingCols : undefined,
      description: tableDef.description,
    });
  }

  // 3. Authen Source Detection
  const detectedSources: string[] = [];
  if (hasSchema('authenhos')) detectedSources.push('authenhos (Kiosk BMS)');
  if (hasSchema('nhso_authen')) detectedSources.push('nhso_authen (สปสช.)');
  if (hasSchema('ovst', 'claim_code')) detectedSources.push('ovst.claim_code');
  if (hasSchema('visit_pttype', 'auth_code')) detectedSources.push('visit_pttype.auth_code');

  const authenSource = {
    detectedSources,
    primarySource: detectedSources[0] || 'ไม่มีตาราง Authen ใน HOSxP',
    status: detectedSources.length > 0 ? ('ready' as const) : ('missing' as const),
  };

  // 4. Catalog / Master Data Completeness Check
  const catalogChecks: CatalogCheckItem[] = [];

  // 4.1 drugitems TMT 24-digit check
  if (hasSchema('drugitems')) {
    try {
      const hasDidStd = hasSchema('drugitems', 'didstd');
      const hasDid = hasSchema('drugitems', 'did');
      const hasIstatus = hasSchema('drugitems', 'istatus');

      const statusFilter = hasIstatus ? "WHERE (istatus = 'Y' OR istatus IS NULL OR istatus = '')" : '';
      const tmtExpr = hasDidStd && hasDid
        ? "(LENGTH(TRIM(IFNULL(didstd, ''))) = 24 OR LENGTH(TRIM(IFNULL(did, ''))) = 24)"
        : hasDidStd
          ? "LENGTH(TRIM(IFNULL(didstd, ''))) = 24"
          : hasDid
            ? "LENGTH(TRIM(IFNULL(did, ''))) = 24"
            : '0 = 1';

      const [rows] = await connection.query(
        `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN ${tmtExpr} THEN 1 ELSE 0 END) as ready 
         FROM drugitems ${statusFilter}`
      );
      const row = (rows as Record<string, unknown>[])[0] || {};
      const total = Number(row.total || 0);
      const ready = Number(row.ready || 0);
      const percent = total > 0 ? Math.round((ready / total) * 100) : 0;
      catalogChecks.push({
        catalog: 'ยา (drugitems: รหัส TMT 24 หลัก)',
        total,
        ready,
        percent,
        description: 'รหัส TMT มาตรฐาน 24 หลักในแฟ้ม DRU สำหรับส่งเคลม FDH',
        status: percent >= 85 ? 'good' : percent >= 60 ? 'warning' : 'critical',
      });
    } catch {
      catalogChecks.push({
        catalog: 'ยา (drugitems)',
        total: 0,
        ready: 0,
        percent: 0,
        description: 'ไม่สามารถนับรหัส TMT ใน drugitems ได้',
        status: 'warning',
      });
    }
  }

  // 4.2 nondrugitems NHSO ADP / TMLT check
  if (hasSchema('nondrugitems')) {
    try {
      const hasNhsoCode = hasSchema('nondrugitems', 'nhso_adp_code');
      const hasBillcode = hasSchema('nondrugitems', 'billcode');
      const hasIstatus = hasSchema('nondrugitems', 'istatus');

      const statusFilter = hasIstatus ? "WHERE (istatus = 'Y' OR istatus IS NULL OR istatus = '')" : '';
      const adpExpr = hasNhsoCode && hasBillcode
        ? "(TRIM(IFNULL(nhso_adp_code, '')) <> '' OR TRIM(IFNULL(billcode, '')) <> '')"
        : hasNhsoCode
          ? "TRIM(IFNULL(nhso_adp_code, '')) <> ''"
          : hasBillcode
            ? "TRIM(IFNULL(billcode, '')) <> ''"
            : '0 = 1';

      const [rows] = await connection.query(
        `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN ${adpExpr} THEN 1 ELSE 0 END) as ready 
         FROM nondrugitems ${statusFilter}`
      );
      const row = (rows as Record<string, unknown>[])[0] || {};
      const total = Number(row.total || 0);
      const ready = Number(row.ready || 0);
      const percent = total > 0 ? Math.round((ready / total) * 100) : 0;
      catalogChecks.push({
        catalog: 'ค่าบริการ/หัตถการ (nondrugitems: รหัส ADP/สปสช.)',
        total,
        ready,
        percent,
        description: 'รหัสมาตรฐานค่าบริการ สปสช./กรมบัญชีกลาง ในแฟ้ม ADP',
        status: percent >= 75 ? 'good' : percent >= 50 ? 'warning' : 'critical',
      });
    } catch {
      catalogChecks.push({
        catalog: 'ค่าบริการ/หัตถการ (nondrugitems)',
        total: 0,
        ready: 0,
        percent: 0,
        description: 'ไม่สามารถนับรหัส ADP ใน nondrugitems ได้',
        status: 'warning',
      });
    }
  }

  // 4.3 pttype HIPDATA mapping check
  if (hasSchema('pttype')) {
    try {
      const hasHipdata = hasSchema('pttype', 'hipdata_code');
      const hasPcode = hasSchema('pttype', 'pcode');
      const pttypeExpr = hasHipdata && hasPcode
        ? "(TRIM(IFNULL(hipdata_code, '')) <> '' OR TRIM(IFNULL(pcode, '')) <> '')"
        : hasHipdata
          ? "TRIM(IFNULL(hipdata_code, '')) <> ''"
          : hasPcode
            ? "TRIM(IFNULL(pcode, '')) <> ''"
            : '0 = 1';

      const [rows] = await connection.query(
        `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN ${pttypeExpr} THEN 1 ELSE 0 END) as ready 
         FROM pttype`
      );
      const row = (rows as Record<string, unknown>[])[0] || {};
      const total = Number(row.total || 0);
      const ready = Number(row.ready || 0);
      const percent = total > 0 ? Math.round((ready / total) * 100) : 0;
      catalogChecks.push({
        catalog: 'สิทธิการรักษา (pttype: รหัส HIPDATA/กองทุน)',
        total,
        ready,
        percent,
        description: 'การผูกรหัสกองทุนกลางในแฟ้ม INS สำหรับส่งออกเคลม',
        status: percent >= 80 ? 'good' : percent >= 50 ? 'warning' : 'critical',
      });
    } catch {
      catalogChecks.push({
        catalog: 'สิทธิการรักษา (pttype)',
        total: 0,
        ready: 0,
        percent: 0,
        description: 'ไม่สามารถตรวจรหัส HIPDATA ใน pttype ได้',
        status: 'warning',
      });
    }
  }

  // 5. Capability Matrix
  const capabilities: FeatureCapabilityItem[] = [];

  // 5.1 FDH 16 Files Export
  const canExport16 = requiredTablesPresent >= totalRequiredTables && Boolean(identity.hospital_code);
  capabilities.push({
    id: 'fdh_export',
    name: 'ส่งออกข้อมูล 16 แฟ้มมาตรฐาน (FDH Export)',
    status: canExport16 ? 'ready' : 'needs_config',
    statusLabel: canExport16 ? 'พร้อมใช้งาน' : 'ขาดตารางหลัก',
    details: canExport16 ? 'ตารางหลักและรหัสหน่วยบริการพร้อมส่งออก' : 'กรุณาตั้งค่ารหัส รพ. และตรวจตารางที่ขาด',
    actionTab: 'hospital',
  });

  // 5.2 Direct FDH API Submission
  const fdhApiReady = Boolean(extraConfig?.fdhApiConfigured);
  capabilities.push({
    id: 'fdh_api',
    name: 'ยิงส่งข้อมูล FDH ผ่าน API อัตโนมัติ',
    status: fdhApiReady ? 'ready' : 'needs_config',
    statusLabel: fdhApiReady ? 'พร้อมใช้งาน' : 'ต้องตั้งค่าสิทธิ์ API',
    details: fdhApiReady ? 'Token และการเชื่อมต่อ FDH API สมบูรณ์' : 'กรุณาบันทึก Username/Password และสิทธิ์ MOPH_CLAIM_API',
    actionTab: 'fdh',
  });

  // 5.3 Authen Code Synchronization
  const authenReady = authenSource.status === 'ready';
  capabilities.push({
    id: 'authen_sync',
    name: 'ระบบตรวจสอบและผูกรหัส Authen สปสช.',
    status: authenReady ? 'ready' : 'partial',
    statusLabel: authenReady ? 'พร้อมใช้งาน' : 'ไม่พบตาราง Authen',
    details: authenReady ? `ใช้ตารางหลัก: ${authenSource.primarySource}` : 'ไม่พบตาราง authenhos หรือ nhso_authen ในระบบ',
  });

  // 5.4 Statement & REP/STM Reconciliation
  const hasStmSchema = hasSchema('eclaimdb') || hasSchema('sys_var');
  capabilities.push({
    id: 'rep_stm',
    name: 'กระทบยอด Statement (REP / STM)',
    status: hasStmSchema ? 'ready' : 'partial',
    statusLabel: hasStmSchema ? 'พร้อมใช้งาน' : 'โหมดนำเข้าไฟล์ ZIP',
    details: hasStmSchema ? 'รองรับทั้งไฟล์ ZIP/XML และเชื่อมต่อ Statement' : 'รองรับการนำเข้าไฟล์ ZIP Statement แบบ Manual',
    actionTab: 'advanced',
  });

  // 5.5 Accounts Receivable (ผังบัญชีลูกหนี้)
  const siteSettings = extraConfig?.siteSettings || {};
  const hasWalkinConfig = Array.isArray(siteSettings.uc_walkin_pttypes) && siteSettings.uc_walkin_pttypes.length > 0;
  capabilities.push({
    id: 'receivables',
    name: 'บัญชีลูกหนี้ค่ารักษาพยาบาล (Accounts Receivable)',
    status: hasWalkinConfig ? 'ready' : 'needs_config',
    statusLabel: hasWalkinConfig ? 'พร้อมใช้งาน' : 'แนะนำตั้งค่าแมปปิ้ง',
    details: hasWalkinConfig ? 'ตั้งค่าสิทธิ UC Walk-in และผังบัญชีแล้ว' : 'กรุณาแมปปิ้งสิทธิ Walk-in และผังบัญชีของ รพ.',
    actionTab: 'hospital',
  });

  // 5.6 Local AI Assistant
  const aiReady = Boolean(extraConfig?.localAiAvailable);
  capabilities.push({
    id: 'local_ai',
    name: 'ผู้ช่วยอัจฉริยะ (FDH Local AI / Ollama)',
    status: aiReady ? 'ready' : 'disabled',
    statusLabel: aiReady ? 'พร้อมใช้งาน' : 'ไม่ได้เปิดใช้งาน',
    details: aiReady ? 'เชื่อมต่อโมเดลภายในสำเร็จ' : 'เครื่องนี้ไม่ได้รัน Local AI หรือยังไม่ได้ติดตั้งโมเดล',
  });

  // 6. Overall Readiness Score Calculation
  // Schema weight: 40%
  // Catalog weight: 35%
  // Authen & API weight: 25%
  const schemaScore = totalRequiredTables > 0 ? (requiredTablesPresent / totalRequiredTables) * 40 : 0;
  const catalogAvg = catalogChecks.length > 0
    ? catalogChecks.reduce((sum, item) => sum + item.percent, 0) / catalogChecks.length
    : 0;
  const catalogScore = (catalogAvg / 100) * 35;
  const authenScore = authenReady ? 15 : 5;
  const fdhScore = fdhApiReady ? 10 : 5;

  const overallScore = Math.min(100, Math.round(schemaScore + catalogScore + authenScore + fdhScore));
  const readinessLevel = overallScore >= 85 ? 'READY' : overallScore >= 60 ? 'NEEDS_ATTENTION' : 'INCOMPLETE';

  // 7. Actionable Recommendations
  const recommendations: string[] = [];
  if (!identity.hospital_code) {
    recommendations.push('ตั้งค่ารหัสหน่วยบริการ (HCODE) ในหน้าตั้งค่า');
  }
  for (const cat of catalogChecks) {
    if (cat.status === 'critical') {
      recommendations.push(`ปรับปรุงรหัสมาตรฐานในฐานข้อมูล HOSxP: ${cat.catalog} มีความสมบูรณ์เพียง ${cat.percent}%`);
    } else if (cat.status === 'warning') {
      recommendations.push(`แนะนำตรวจสอบ ${cat.catalog} เพิ่มเติม (ปัจจุบันผูกแล้ว ${cat.percent}%)`);
    }
  }
  if (!fdhApiReady) {
    recommendations.push('ตั้งค่าเชื่อมต่อ FDH API (Username/Password จาก MOPH Account Center) เพื่อยิงเคลมอัตโนมัติ');
  }
  if (!hasWalkinConfig) {
    recommendations.push('เลือกสิทธิ UC Walk-in และรหัสรายการบริการในหน้า ตั้งค่าระบบ -> ขอบเขตหน่วยบริการ');
  }

  return {
    timestamp,
    hospital: {
      hospital_code: identity.hospital_code || 'ยังไม่ได้ระบุ',
      hospital_name: identity.hospital_name || 'ไม่ระบุชื่อ',
      database_type: activeHospitalDatabaseConfig.type,
      database_name: activeHospitalDatabaseConfig.database || activeHospitalDatabaseConfig.schema,
    },
    overallScore,
    readinessLevel,
    schemaChecks,
    catalogChecks,
    authenSource,
    capabilities,
    recommendations,
  };
}
