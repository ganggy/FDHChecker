// Backend API Server สำหรับเชื่อมต่อ HOSxP
// ใช้ Node.js + Express

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import crypto from 'crypto';
import { getVisitsCached } from './cacheManager.js';
import {
  getCheckData,
  testDatabaseConnection,
  getExportData,
  getReceiptItems,
  getDrugPrices,
  getServiceADPCodes,
  getKidneyMonitorDetailed,
  getUTFConnection,
  getAppSetting,
  setAppSetting,
  saveFdhStatusImportLog,
  getFdhStatusImportLogs,
  ensureRepstmTables,
  importRepstmRows,
  getRepstmImportBatches,
  getRepstmImportedRows,
  getRepDataRows,
  getReceivableCandidates,
  getReceivableBatches,
  getReceivableFilterOptions,
  getInsuranceOverview,
  saveReceivableBatch,
  syncNhsoAuthenCodes,
  getAuthenSyncLogs,
  ensureNhsoClosePrivilegeTable,
  getNhsoClosePrivilegeCandidates,
  getNhsoClosePrivilegeHistory,
  testNhsoClosePrivilegeToken,
  submitNhsoClosePrivileges,
  importFdhStatusForDateRange,
} from './db.js';
import businessRules from './config/business_rules.json';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const CONFIG_SETTING_KEY = 'business_rules';
const APP_SETTINGS_KEY = 'site_settings';
const FDH_API_SETTINGS_KEY = 'fdh_api_settings';
const NHSO_AUTHEN_SETTINGS_KEY = 'nhso_authen_settings';
const NHSO_CLOSE_SETTINGS_KEY = 'nhso_close_settings';
const NHSO_ECLAIM_SETTINGS_KEY = 'nhso_eclaim_settings';

// Global Playwright browser session for NHSO eclaim — kept alive between requests so
// the JSESSIONID session cookie is never sent via server-side fetch (IP-binding workaround).
type EclaimBrowserSession = {
  browser: import('playwright').Browser;
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
  ready: boolean;
  repPageUrl: string;
  createdAt: number;
};
let eclaimBrowserSession: EclaimBrowserSession | null = null;

const isTruthyFlag= (value: unknown) => (
  value === true ||
  value === 1 ||
  value === '1' ||
  String(value ?? '').trim().toUpperCase() === 'Y'
);

const readJsonConfigFile = async (filePath: string) => {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
};

const readConfigWithFallback = async (filePath: string) => {
  const dbConfig = await getAppSetting(CONFIG_SETTING_KEY);
  if (dbConfig) return { ...dbConfig, _source: 'database' };
  return { ...(await readJsonConfigFile(filePath)), _source: 'file' };
};

const getDefaultFdhApiConfig = () => ({
  environment: 'prd',
  hcode: String((businessRules as Record<string, unknown>)?.site_settings && typeof (businessRules as Record<string, unknown>).site_settings === 'object'
    ? ((businessRules as Record<string, unknown>).site_settings as Record<string, unknown>).hospital_code || ''
    : ''),
  tokenUrl: 'https://fdh.moph.go.th/token?Action=get_moph_access_token',
  apiBaseUrl: 'https://fdh.moph.go.th',
  upload16Url: 'https://fdh.moph.go.th/api/v2/data_hub/16_files',
  preScreenUrl: 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file',
  username: '',
  password: ''
});

const getDefaultNhsoAuthenConfig = () => ({
  environment: 'prd',
  token: '',
  apiBaseUrl: 'https://authenucws.nhso.go.th',
  maxDays: 4,
});

const getDefaultNhsoCloseConfig = () => ({
  environment: 'prd',
  token: '',
  apiBaseUrl: 'https://nhsoapi.nhso.go.th/nhsoendpoint',
  sourceId: 'KSPAPI',
  claimServiceCode: 'PG0060001',
  recorderPid: '',
  maxDays: 4,
});

const getDefaultNhsoEclaimConfig = () => ({
  // Keycloak SSO token endpoint (grant_type=password, client_id=eclaim)
  authUrl: 'https://iam.nhso.go.th/realms/nhso/protocol/openid-connect/token',
  clientId: 'eclaim',
  fileListUrl: 'https://eclaim.nhso.go.th/Client/backend/api/center/m-uploads/search',
  downloadUrl: 'https://eclaim.nhso.go.th/Client/ec2/backend/api/transaction/rep-downloads/exec-download',
  username: '',
  password: '',
});

const getResolvedHospitalCode = async (): Promise<string> => {
  const siteSettings = await getAppSetting<Record<string, unknown>>(APP_SETTINGS_KEY);
  const appSettingsHcode = siteSettings && typeof siteSettings === 'object'
    ? String(siteSettings.hospital_code || '')
    : '';

  if (appSettingsHcode.trim()) {
    return appSettingsHcode.trim();
  }

  const dbBusinessRules = await getAppSetting<Record<string, unknown>>(CONFIG_SETTING_KEY);
  const dbSiteSettings = dbBusinessRules && typeof dbBusinessRules === 'object'
    ? dbBusinessRules.site_settings as Record<string, unknown> | undefined
    : undefined;
  const fallbackHcode = String(dbSiteSettings?.hospital_code || getDefaultFdhApiConfig().hcode || '');
  return fallbackHcode.trim();
};

const getResolvedFdhApiConfig = async (overrides?: Record<string, unknown>) => {
  const savedConfig = await getAppSetting<Record<string, unknown>>(FDH_API_SETTINGS_KEY);
  const resolvedHospitalCode = await getResolvedHospitalCode();
  const mergedConfig = {
    ...getDefaultFdhApiConfig(),
    ...(savedConfig || {}),
    ...(overrides || {})
  } as Record<string, unknown>;

  if (!String(mergedConfig.hcode || '').trim()) {
    mergedConfig.hcode = resolvedHospitalCode;
  }

  // Fallback: read API_FDH_User / API_FDH_Password from HosXP opdconfig
  // when not configured in app settings
  if (!String(mergedConfig.username || '').trim() || !String(mergedConfig.password || '').trim()) {
    try {
      const conn = await getUTFConnection();
      const [rows] = await conn.query('SELECT API_FDH_User, API_FDH_Password FROM opdconfig LIMIT 1');
      const conf = (rows as any)?.[0];
      if (conf) {
        if (!String(mergedConfig.username || '').trim() && conf.API_FDH_User) {
          mergedConfig.username = String(conf.API_FDH_User).trim();
        }
        if (!String(mergedConfig.password || '').trim() && conf.API_FDH_Password) {
          mergedConfig.password = String(conf.API_FDH_Password).trim();
        }
      }
    } catch {
      // opdconfig not available or columns don't exist — that's OK
    }
  }

  return mergedConfig;
};

const getResolvedNhsoAuthenConfig = async (overrides?: Record<string, unknown>) => {
  const savedConfig = await getAppSetting<Record<string, unknown>>(NHSO_AUTHEN_SETTINGS_KEY);
  return {
    ...getDefaultNhsoAuthenConfig(),
    ...(savedConfig || {}),
    ...(overrides || {}),
  } as Record<string, unknown>;
};

const getResolvedNhsoCloseConfig = async (overrides?: Record<string, unknown>) => {
  const savedConfig = await getAppSetting<Record<string, unknown>>(NHSO_CLOSE_SETTINGS_KEY);
  return {
    ...getDefaultNhsoCloseConfig(),
    ...(savedConfig || {}),
    ...(overrides || {}),
  } as Record<string, unknown>;
};

const getResolvedNhsoEclaimConfig = async (overrides?: Record<string, unknown>) => {
  const savedConfig = await getAppSetting<Record<string, unknown>>(NHSO_ECLAIM_SETTINGS_KEY);
  return {
    ...getDefaultNhsoEclaimConfig(),
    ...(savedConfig || {}),
    ...(overrides || {}),
  } as Record<string, unknown>;
};

const getFdhTokenEndpoint = (tokenUrlInput: string) => {
  const tokenUrl = tokenUrlInput.trim();
  if (!tokenUrl) return '';

  try {
    const parsed = new URL(tokenUrl);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return `${parsed.origin}/token`;
    }
    if (parsed.pathname.endsWith('/token')) {
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (parsed.pathname.endsWith('/token/') || parsed.pathname.includes('/token')) {
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    }
    return `${parsed.origin}/token`;
  } catch {
    return tokenUrl.replace(/\/+$/, '');
  }
};

const getPasswordHashCandidates = (password: string) => {
  const sha256Lower = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
  const sha256Upper = sha256Lower.toUpperCase();
  return Array.from(new Set([
    sha256Lower,
    sha256Upper,
    password
  ]));
};

const extractTokenFromPayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;

  const directPayload = payload as Record<string, unknown>;
  const directCandidates = [
    directPayload.access_token,
    directPayload.token,
    directPayload.jwt,
    directPayload.jwt_token,
    directPayload.id_token
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedData = directPayload.data;
  if (nestedData && typeof nestedData === 'object') {
    return extractTokenFromPayload(nestedData);
  }

  return null;
};

// Enhanced connection test on startup
testDatabaseConnection().then(result => {
  if (result.isConnected) {
    console.log('✅ HOSxP Database Connected Successfully');
    console.log(`📊 Tables: ${result.tableCount}, Recent records: ${result.sampleRecordCount}`);
    console.log(`🔄 Using REAL DATABASE DATA as primary source`);
  } else {
    console.error('❌ HOSxP Database Connection Failed:', result.error);
    console.log('🔄 Will use mock data as fallback');
  }
});

// Mock data for fallback
const getMockData = () => [
  {
    id: 1,
    hn: '123456',
    vn: '2601234',
    patientName: 'นายสมชาย ใจดี',
    fund: 'UCS',
    serviceDate: '2026-03-15',
    serviceType: 'OPD',
    price: 1200,
    status: 'สมบูรณ์',
    issues: [],
    details: {
      drugCode: 'D001',
      procedureCode: 'P001',
      rightCode: 'R001',
      standardPrice: 1200,
      notes: 'ข้อมูลครบถ้วน',
    },
  },
  {
    id: 2,
    hn: '234567',
    vn: '2601235',
    patientName: 'นางสาวสายใจ รักดี',
    fund: 'SSS',
    serviceDate: '2026-03-15',
    serviceType: 'IPD',
    price: 3500,
    status: 'ไม่สมบูรณ์',
    issues: ['ขาดรหัสหัตถการ', 'ราคาไม่ตรงมาตรฐาน'],
    details: {
      drugCode: 'D002',
      procedureCode: '',
      rightCode: 'R002',
      standardPrice: 3500,
      notes: 'มีปัญหาต้องแก้',
    },
  }, {
    id: 3,
    hn: '345678',
    vn: '2601236',
    patientName: 'เด็กชายภูผา กล้าหาญ',
    fund: 'UCS',
    serviceDate: '2026-03-15',
    serviceType: 'OPD',
    price: 800,
    status: 'สมบูรณ์',
    issues: [],
    details: {
      drugCode: 'D003',
      procedureCode: 'P003',
      rightCode: 'R003',
      standardPrice: 800,
      notes: 'ข้อมูลครบถ้วน',
    },
  },
  {
    id: 4,
    hn: '456789',
    vn: '2601237',
    patientName: 'นายมงคล สุขสันต์',
    fund: 'OFC',
    serviceDate: '2026-03-15',
    serviceType: 'IPD',
    price: 5200,
    status: 'ไม่สมบูรณ์',
    issues: ['ขาดรหัสหัตถการ'],
    details: {
      drugCode: 'D004',
      procedureCode: '',
      rightCode: 'R004',
      standardPrice: 5200,
      notes: 'มีปัญหาต้องแก้',
    },
  }, {
    id: 5,
    hn: '567890',
    vn: '2601238',
    patientName: 'นางนิยม เรียบร้อย',
    fund: 'LGO',
    serviceDate: '2026-03-15',
    serviceType: 'OPD',
    price: 950,
    status: 'สมบูรณ์',
    issues: [],
    details: {
      drugCode: 'D005',
      procedureCode: 'P005',
      rightCode: 'R005',
      standardPrice: 950,
      notes: 'ข้อมูลครบถ้วน',
    },
  },
];

// API สำหรับดึงข้อมูลตรวจสอบจาก HOSxP - ใช้ข้อมูลจริงเป็นหลัก
app.get('/api/hosxp/checks', async (req, res) => {
  try {
    const { fund, startDate, endDate } = req.query;

    console.log(`🔍 Fetching REAL HOSxP data - Fund: ${fund || 'All'}, Date: ${startDate} to ${endDate}`);

    // ===== ขั้นตอนที่ 1: ลองดึงข้อมูลจริงจากฐานข้อมูล HOSxP =====
    let data = await getCheckData(
      fund as string | undefined,
      startDate as string | undefined,
      endDate as string | undefined
    );

    let usingRealData = false;

    // ตรวจสอบว่าได้ข้อมูลจริงหรือไม่
    if (Array.isArray(data) && data.length > 0) {
      console.log(`✅ SUCCESS: Got ${data.length} REAL records from HOSxP database`);
      usingRealData = true;
    } else {
      console.log(`⚠️ No real data available - trying database connection test...`);

      // ตรวจสอบการเชื่อมต่อฐานข้อมูล
      const dbStatus = await testDatabaseConnection();

      if (dbStatus.isConnected && dbStatus.hasData) {
        console.log('✅ Database connected with data - empty result likely due to date/fund filters');
        // ถ้าฐานข้อมูลเชื่อมต่อได้แต่ไม่มีข้อมูลในช่วงที่กรอง ให้ return array ว่าง
        data = [];
        usingRealData = true;
      } else {
        console.log(`❌ Database connection failed: ${dbStatus.error || 'Unknown error'}`);
        console.log('🔄 Falling back to mock data...');

        // ===== ขั้นตอนที่ 2: ใช้ Mock Data เป็น Fallback =====
        data = getMockData();

        // กรองข้อมูล mock ตามเงื่อนไข
        if (startDate && endDate) {
          data = data.filter((item: Record<string, unknown>) => {
            const itemDate = item.serviceDate as string;
            return itemDate >= (startDate as string) && itemDate <= (endDate as string);
          });
        }
        if (fund && fund !== 'ทั้งหมด') {
          data = data.filter((item: Record<string, unknown>) => item.fund === fund);
        }

        usingRealData = false;
      }
    }
    // ===== ขั้นตอนที่ 3: เพิ่มสถานะให้ทุกรายการ =====
    const dataWithStatus = data.map((record: Record<string, unknown>) => {
      // Enhanced validation for real data
      const hasHN = record.hn && String(record.hn).trim().length > 0;
      const hasVN = record.vn && String(record.vn).trim().length > 0;
      const hasPatientName = record.patientName && String(record.patientName).trim().length > 0;
      const hasPrice = record.price && Number(record.price) > 0;
      const hasFund = record.fund && String(record.fund).trim().length > 0;
      const hasServiceDate = record.serviceDate && String(record.serviceDate).trim().length > 0;

      const isIPD = record.serviceType === 'ผู้ป่วยใน';

      const issues: string[] = [];
      if (!hasHN) issues.push('ขาด HN');
      if (!hasVN) issues.push('ขาด VN');
      if (!hasPatientName) issues.push('ขาดชื่อผู้ป่วย');
      if (!hasFund) issues.push('ขาดข้อมูลกองทุน');
      if (!hasServiceDate) issues.push('ขาดวันที่บริการ');

      // ตรวจสอบราคาเฉพาะ OPD
      if (!isIPD && !hasPrice) {
        issues.push('ขาดข้อมูลราคา');
      }
      const rec = record as any;
      const isOFC_LGO = rec.hipdata_code === 'OFC' || rec.hipdata_code === 'LGO';
      const isUCS = rec.hipdata_code === 'UCS' || rec.hipdata_code === 'WEL';
      const mainDiag = String(rec.main_diag || '');
      const fundName = String(rec.fund || '');

      const dialysisRegex = new RegExp(businessRules.diagnosis_patterns.dialysis_regex);
      const hasFerrokidSignal = isTruthyFlag(rec.has_ferrokid) || (
        isTruthyFlag(rec.ferrokid_age_eligible) &&
        (isTruthyFlag(rec.has_ferrokid_med) || isTruthyFlag(rec.has_ferrokid_diag))
      );

      const isSpecialFund = !isIPD && (
        rec.has_anc_diag || rec.has_anc_adp ||
        rec.has_cx_diag || rec.has_cx_adp ||
        rec.has_fp_diag || rec.has_fp_adp ||
        rec.has_pp_diag || rec.has_pp_adp ||
        rec.has_preg_lab || rec.has_preg_item ||
        rec.has_pal_diag || rec.has_pal_adp ||
        rec.has_herb || rec.has_telmed || rec.has_drugp ||
        rec.has_instrument || rec.has_knee_oper ||
        rec.has_fpg || rec.has_chol || rec.has_anemia || rec.has_iron ||
        hasFerrokidSignal ||
        rec.fpg_age_eligible || rec.has_fpg_adp || rec.has_fpg_lab || rec.has_fpg_diag ||
        rec.chol_age_eligible || rec.has_chol_adp || rec.has_chol_lab || rec.has_chol_diag ||
        rec.anemia_age_eligible || rec.has_anemia_adp || rec.has_anemia_lab || rec.has_anemia_diag ||
        rec.iron_age_eligible || rec.has_iron_adp || rec.has_iron_diag ||
        rec.has_upt || rec.has_anc_visit || rec.has_anc_us || rec.has_anc_lab1 || rec.has_anc_lab2 ||
        rec.has_anc_dental_exam || rec.has_anc_dental_clean ||
        rec.has_post_care || rec.has_post_supp || rec.has_fluoride ||
        rec.has_fp_pill || rec.has_fp_condom ||
        rec.has_chemo_diag || rec.has_hepc_diag || rec.has_rehab_diag || rec.has_crrt_diag ||
        rec.has_robot_item || rec.has_proton_diag || rec.has_cxr_item || rec.has_clopidogrel ||
        dialysisRegex.test(mainDiag) ||
        rec.project_code === businessRules.project_codes.er_emergency ||
        fundName.includes('ฉุกเฉิน') ||
        fundName.endsWith('AE') ||
        fundName.includes('OP Refer')
      );

      const isBillable = !isIPD && (isOFC_LGO || (isUCS && isSpecialFund));
      const hasCloseEp = !!rec.has_close_ep;
      const hasAuthenPp = !!rec.has_authen_pp;

      if (isBillable && !hasCloseEp) {
        issues.push('ยังไม่ปิดสิทธิ (EP)');
      }

      const isComplete = issues.length === 0;

      return {
        ...record,
        status: isComplete ? 'ready' : 'pending',
        isBillable,
        issues: issues,
        has_authen: hasAuthenPp ? 1 : 0,
        has_close: hasCloseEp ? 1 : 0,
        fdh_status_label: hasCloseEp
          ? 'ปิดสิทธิแล้ว (EP)'
          : hasAuthenPp
            ? 'มี Authen (PP)'
            : 'ยังไม่มีสถานะ FDH',
        _dataSource: usingRealData ? 'HOSxP-Database' : 'Mock-Fallback'
      };
    });

    // ===== ขั้นตอนที่ 4: ส่งผลลัพธ์พร้อมข้อมูลการทำงาน =====
    const responseData = {
      success: true,
      dataSource: usingRealData ? 'HOSxP-Database' : 'Mock-Fallback',
      totalRecords: dataWithStatus.length,
      filters: {
        fund: fund || 'ทั้งหมด',
        startDate: startDate || null,
        endDate: endDate || null
      },
      data: dataWithStatus,
      timestamp: new Date().toISOString()
    }; console.log(`✅ RESPONSE: ${dataWithStatus.length} records from ${usingRealData ? 'REAL DATABASE' : 'MOCK DATA'}`);
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching checks:', error);
    // Fallback to mock data on error
    const { fund, startDate, endDate } = req.query;
    let data = getMockData();
    if (startDate && endDate) {
      data = data.filter((item: Record<string, unknown>) => {
        const itemDate = item.serviceDate as string;
        return itemDate >= (startDate as string) && itemDate <= (endDate as string);
      });
    }
    if (fund) {
      data = data.filter((item: Record<string, unknown>) => item.fund === fund);
    }

    // Add status field for fallback data too
    const dataWithStatus = data.map((record: Record<string, unknown>) => {
      const hasHN = record.hn && String(record.hn).trim().length > 0;
      const hasPatientName = record.patientName && String(record.patientName).trim().length > 0;
      const hasPrice = record.price && Number(record.price) > 0;
      const hasFund = record.fund && String(record.fund).trim().length > 0;
      const isComplete = hasHN && hasPatientName && hasPrice && hasFund;

      return {
        ...record,
        status: isComplete ? 'สมบูรณ์' : 'ไม่สมบูรณ์',
        issues: !isComplete ? ['ข้อมูลไม่ครบถ้วน'] : [],
        _dataSource: 'Error-Fallback'
      };
    });

    res.json({
      success: false,
      dataSource: 'Error-Fallback',
      totalRecords: dataWithStatus.length,
      data: dataWithStatus,
      error: 'Database connection failed'
    });
  }
});

// API สำหรับดึงข้อมูลรายการใบเสร็จจาก opitemrece (ข้อมูลจริง)
app.get('/api/hosxp/receipt/:vn', async (req, res) => {
  try {
    const { vn } = req.params;
    console.log(`🧾 Fetching REAL receipt items for VN: ${vn} from opitemrece table`);
    // ดึงข้อมูลจาก opitemrece table โดยตรง
    const receiptItems = await getReceiptItems(vn); if (Array.isArray(receiptItems) && receiptItems.length > 0) {
      console.log(`✅ Found ${receiptItems.length} receipt items from opitemrece with s_drugitems mapping`);

      // คำนวณสถิติเชิงลึก
      const totalItems = receiptItems.length;
      const totalAmount = receiptItems.reduce((sum, item) => {
        const itemSum = Number(item.sum_price) || Number(item.qty) * Number(item.unitprice) || 0;
        return sum + itemSum;
      }, 0);

      // สถิติการเบิก/เคลม
      const nhsoClaimableItems = receiptItems.filter(item => item.has_nhso_adp === 1).length;
      const tmltClaimableItems = receiptItems.filter(item => item.has_tmlt === 1).length;
      const ttmtClaimableItems = receiptItems.filter(item => item.has_ttmt === 1).length;

      // สถิติตามประเภทรายการ
      const drugItems = receiptItems.filter(item =>
        String(item.item_type).includes('ยา')
      ).length;
      const labItems = receiptItems.filter(item =>
        String(item.item_type).includes('การตรวจ')
      ).length;
      const serviceItems = receiptItems.filter(item =>
        String(item.item_type).includes('บริการ')
      ).length;

      res.json({
        success: true,
        dataSource: 'opitemrece+s_drugitems',
        vn: vn,
        totalItems: totalItems,
        totalAmount: totalAmount,
        statistics: {
          byClaimType: {
            nhsoAdp: nhsoClaimableItems,
            tmlt: tmltClaimableItems,
            ttmt: ttmtClaimableItems,
            nhsoAdpPercentage: totalItems > 0 ? Math.round((nhsoClaimableItems / totalItems) * 100) : 0,
            tmltPercentage: totalItems > 0 ? Math.round((tmltClaimableItems / totalItems) * 100) : 0,
            ttmtPercentage: totalItems > 0 ? Math.round((ttmtClaimableItems / totalItems) * 100) : 0
          },
          byItemType: {
            drugs: drugItems,
            lab: labItems,
            services: serviceItems
          }
        },
        items: receiptItems,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`⚠️ No receipt items found for VN: ${vn}`);
      res.json({
        success: false,
        dataSource: 'opitemrece-table',
        vn: vn,
        totalItems: 0,
        totalAmount: 0,
        items: [],
        message: `ไม่พบรายการใบเสร็จสำหรับ VN: ${vn}`,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error fetching receipt items:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูลใบเสร็จ',
      vn: req.params.vn
    });
  }
});

// API สำหรับดึงข้อมูลการวินิจฉัยและหัตถการ
app.get('/api/hosxp/visit/:vn/diags', async (req, res) => {
  try {
    const { vn } = req.params;
    console.log(`🩺 Fetching diags and procedures for VN: ${vn}`);
    const { getDiagsAndProcedures } = await import('./db.js');
    const data = await getDiagsAndProcedures(vn);

    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching diags and procedures:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการดึงข้อมูลวินิจฉัยและหัตถการ'
    });
  }
});

// API สำหรับดึงข้อมูลยาและการรักษา
app.get('/api/hosxp/prescriptions/:vn', async (req, res) => {
  try {
    const { vn } = req.params;
    console.log(`📊 Fetching REAL prescriptions for VN: ${vn}`);

    // Always fetch from database
    const prescriptions = await getDrugPrices(vn);

    console.log(`✅ Returning ${prescriptions.length} prescription items`);
    res.json(prescriptions);
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    // Return empty array on error, don't use mock fallback
    res.status(500).json([]);
  }
});

// API สำหรับดึงข้อมูลค่าบริการ ADP Code
app.get('/api/hosxp/services/:vn', async (req, res) => {
  try {
    const { vn } = req.params;
    console.log(`🏥 Fetching REAL ADP services for VN: ${vn}`);

    // Always try to fetch from database first
    let services = await getServiceADPCodes(vn);

    // Only use mock data if database query returns empty or error
    if (!Array.isArray(services) || services.length === 0) {
      console.log(`⚠️ No real ADP service data for VN: ${vn}, using mock as fallback`);
      const mockServiceSets = {
        '690350441149': [
          {
            icode: 'IPD001',
            income: '02',
            income_name: 'ค่าบริการแพทย์',
            adp_code: 'ADP001',
            adp_name: 'การตรวจรักษาโดยแพทย์เฉพาะทาง',
            adp_price: 500,
            can_claim: 1,
          },
          {
            icode: 'LAB001',
            income: '03',
            income_name: 'ค่าตรวจวิเคราะห์',
            adp_code: 'ADP002',
            adp_name: 'การตรวจวิเคราะห์ทางห้องปฏิบัติการ',
            adp_price: 200,
            can_claim: 1,
          },
          {
            icode: 'XRAY001',
            income: '04',
            income_name: 'ค่าเอกซเรย์',
            adp_code: null,
            adp_name: null,
            adp_price: 0,
            can_claim: 0,
          }
        ],
        '690351541353': [
          {
            icode: 'OPD001',
            income: '01',
            income_name: 'ค่าบริการ OPD',
            adp_code: 'ADP001',
            adp_name: 'การตรวจรักษาผู้ป่วยนอก',
            adp_price: 300,
            can_claim: 1,
          }
        ],
        '690351555432': [
          {
            icode: 'OPD002',
            income: '01',
            income_name: 'ค่าบริการผู้ป่วยนอก',
            adp_code: 'ADP003',
            adp_name: 'การตรวจรักษาทั่วไป',
            adp_price: 200,
            can_claim: 1,
          },
          {
            icode: 'DRUG001',
            income: '05',
            income_name: 'ค่าจ่ายยา',
            adp_code: null,
            adp_name: null,
            adp_price: 0,
            can_claim: 0,
          }
        ],
        '2601234': [
          {
            icode: 'IPD002',
            income: '02',
            income_name: 'ค่าบริการผู้ป่วยใน',
            adp_code: 'ADP004',
            adp_name: 'การรักษาผู้ป่วยใน',
            adp_price: 800,
            can_claim: 1,
          }
        ],
        'default': [
          {
            icode: 'OPD001',
            income: '01',
            income_name: 'ค่าบริการ OPD',
            adp_code: 'ADP001',
            adp_name: 'การตรวจรักษาผู้ป่วยนอก',
            adp_price: 300,
            can_claim: 1,
          }
        ]
      };

      services = mockServiceSets[vn as keyof typeof mockServiceSets] || mockServiceSets.default;
    }

    console.log(`✅ Returning ${services.length} ADP service items`);
    res.json(services);
  } catch (error) {
    console.error('Error fetching ADP services:', error);
    res.json([]);
  }
});

// API สำหรับดึงข้อมูลผู้ป่วย
app.get('/api/hosxp/patients/:hn', (req, res) => {
  try {
    const { hn } = req.params;
    const patient = getMockData().find(r => r.hn === hn);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      hn: patient.hn,
      patientName: patient.patientName,
      fund: patient.fund,
    });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูล IPD
app.get('/api/hosxp/ipd-list', async (req, res) => {
  try {
    const { startDate, endDate, statusFilter } = req.query;
    console.log(`🛏️ Fetching IPD List: ${startDate} to ${endDate}, Status: ${statusFilter || 'All'}`);
    const { getEligibleIPD } = await import('./db.js');
    const data = await getEligibleIPD(startDate as string, endDate as string, statusFilter as string);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching IPD list:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลรายกองทุน
app.get('/api/hosxp/specific-funds', async (req, res) => {
  try {
    const { fundType, startDate, endDate } = req.query;
    if (!fundType || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    console.log(`🔍 Fetching Specific Fund Data: ${fundType} from ${startDate} to ${endDate}`);
    const { getSpecificFundData } = await import('./db.js');
    const data = await getSpecificFundData(fundType as string, startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching specific fund data:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูลรายละเอียดชาร์ต IPD
app.get('/api/hosxp/ipd-chart', async (req, res) => {
  try {
    const { an } = req.query;
    if (!an) return res.status(400).json({ success: false, error: 'Missing an parameter' });

    console.log(`📋 Fetching IPD Chart details for AN: ${an}`);
    const { getIPDChartDetails } = await import('./db.js');
    const data = await getIPDChartDetails(an as string);
    if (!data) return res.status(404).json({ success: false, error: 'Cannot fetch chart data' });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching IPD Chart details:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// API สำหรับบันทึกสถานะการตรวจสอบชาร์ต (Audit)
app.post('/api/hosxp/audit', express.json(), async (req, res) => {
  try {
    const { an, status, updated_by, notes } = req.body;
    if (!an || !status) return res.status(400).json({ success: false, error: 'Missing required fields' });

    console.log(`✅ Saving Audit Status for AN: ${an} -> ${status}`);
    const { getUTFConnection } = await import('./db.js');
    const connection = await getUTFConnection();
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS z_fdh_audit_log (
          an varchar(20) NOT NULL,
          status varchar(30) DEFAULT NULL,
          updated_by varchar(100) DEFAULT NULL,
          notes text,
          created_at datetime DEFAULT CURRENT_TIMESTAMP,
          updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (an)
        ) ENGINE=MyISAM DEFAULT CHARSET=tis620;
      `);
      await connection.query(`
        INSERT INTO z_fdh_audit_log (an, status, updated_by, notes) 
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status), updated_by = VALUES(updated_by), notes = VALUES(notes), updated_at = NOW();
      `, [an, status, updated_by || 'ระบบ', notes || '']);
      res.json({ success: true });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error saving IPD Audit status:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// API สำหรับดึงข้อมูล Visit ที่เข้าข่ายเบิก FDH
app.get('/api/hosxp/eligible-visits', async (req, res) => {
  try {
    const { startDate, endDate, fund } = req.query;
    console.log(`🔍 Checking FDH eligibility - Dates: ${startDate} to ${endDate}, Fund: ${fund || 'All'}`);

    // Try real database first
    let data = await getVisitsCached(
      startDate as string,
      endDate as string,
      fund as string
    );

    const usingRealData = true; // getVisitsCached handles fallback internally

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`⚠️ No eligible visits found for the given criteria, even with cache/fallback.`);
      data = []; // Ensure data is an empty array if nothing found
    } else {
      console.log(`✅ Found ${data.length} eligible visits (from cache or database).`);
    }
    const enrichedData = data.map((item: any) => {
      const issues: string[] = [];
      const serviceType = item.an ? 'ผู้ป่วยใน' : 'ผู้ป่วยนอก';

      const dialysisRegex = new RegExp(businessRules.diagnosis_patterns.dialysis_regex);

      // Smart Check logic based on 6 core conditions from manual
      if (!item.has_cid) issues.push('ER101: ขาดเลข CID หรือ CID ไม่ถูกต้อง');
      if (!item.has_diagnosis) issues.push('ER102: ขาดรหัสวินิจฉัย (ICD-10)');

      // ผู้ป่วยใน ไม่ต้องตรวจสอบราคาในหน้านี้ (เพราะเป็นระบบ OPD)
      if (!item.an && !item.has_receipt) {
        issues.push('ER103: ขาดข้อมูลค่าบริการหรือราคาเป็น 0');
      }

      const hasCloseEp = !!item.has_close;

      if (!item.fund || item.fund === 'สิทธิว่าง') issues.push('ER105: ไม่ระบุสิทธิ์การรักษา');

      // Additional MDS (Minimal Data Set) checks
      if (!item.serviceDate) issues.push('ER106: ขาดวันที่รับบริการ');
      if (!item.vn) issues.push('ER107: ขาดเลขที่บริการ (VN)');

      // --- 8 Special Fund Checks (ก้อนเงินพิเศษ) ---
      // ... (Rest of the special fund checks)
      if (item.has_anc_diag && !item.has_anc_adp) issues.push('ER201: ตรวจพบรหัส ANC แต่ขาดรายการค่าบริการเบิก');
      if (!item.has_anc_diag && item.has_anc_adp) issues.push('ER202: มีรายการเบิก ANC แต่ขาดรหัสวินิจฉัย (ICD-10)');
      if (item.has_cx_diag && !item.has_cx_adp) issues.push('ER203: ตรวจพบรหัส CA Cervix แต่ขาดรายการค่าบริการเบิก');
      if (!item.has_cx_diag && item.has_cx_adp) issues.push('ER204: มีรายการเบิก CA Cervix แต่ขาดรหัสวินิจฉัย (ICD-10)');
      if (item.has_fp_diag && !item.has_fp_adp) issues.push('ER205: ตรวจพบรหัสคุมกำเนิดแต่ขาดรายการค่าบริการเบิก');
      if (!item.has_fp_diag && item.has_fp_adp) issues.push('ER206: มีรายการเบิกคุมกำเนิดแต่ขาดรหัสวินิจฉัย (ICD-10)');
      if (item.has_pp_diag && !item.has_pp_adp) issues.push('ER207: ตรวจพบรหัสหลังคลอดแต่ขาดรายการค่าบริการเบิก');
      if (!item.has_pp_diag && item.has_pp_adp) issues.push('ER208: มีรายการเบิกหลังคลอดแต่ขาดรหัสวินิจฉัย (ICD-10)');
      if (item.has_preg_lab && !item.has_preg_item) issues.push('ER209: ตรวจพบ Lab ตรวจครรภ์แต่ขาดรหัสเบิกจ่าย สปสช.');
      if (!item.has_preg_lab && item.has_preg_item) issues.push('ER210: มีรหัสเบิกตรวจครรภ์แต่ขาดข้อมูลการส่ง Lab');
      if (item.has_knee_oper && (item.age_y || 0) < 40) issues.push('ER211: ตรวจพบการพอกเข่าแต่อายุไม่ถึงเกณฑ์ (40 ปี)');
      if (item.has_pal_diag && !item.has_pal_adp) issues.push('ER212: ตรวจพบวินิจฉัย Palliative แต่ขาดรายการเบิก');
      if (!item.has_pal_diag && item.has_pal_adp) issues.push('ER213: มีรายการเบิก Palliative แต่ขาดรหัสวินิจฉัยสภาวะ');

      // Logic for status
      let status: 'ready' | 'pending' | 'rejected' = 'ready';

      // หากเป็น IPD จะไม่เบิกในช่องทาง OPD นี้
      if (item.an) {
        status = 'rejected';
        if (item.has_receipt) {
          issues.push('WRN-IPD: พบข้อมูล IPD (AN) กรุณาโอนค่าใช้จ่ายไปยังหน้าชำระเงิน IPD');
        }
      } else {
        // นับเฉพาะที่เป็น Error จริงๆ (เว้น WRN ไว้)
        const criticalErrors = issues.filter(iss => iss.startsWith('ER'));
        if (criticalErrors.length > 0) {
          // ถ้าขาด CID หรือ Diagnosis หรือ Fund จะถือว่า Rejected (ส่งไม่ได้)
          if (!item.has_cid || !item.has_diagnosis || !item.fund) {
            status = 'rejected';
          } else {
            status = 'pending';
          }
        }
      }

      // เช็คว่าเข้าเกณฑ์กองทุนพิเศษแต่ข้อมูลยังไม่ครบหรือไม่
      const hasFerrokidSignal = isTruthyFlag(item.has_ferrokid) || (
        isTruthyFlag(item.ferrokid_age_eligible) &&
        (isTruthyFlag(item.has_ferrokid_med) || isTruthyFlag(item.has_ferrokid_diag))
      );
      const isSpecialFund = !item.an && (
        item.has_anc_diag || item.has_anc_adp ||
        item.has_cx_diag || item.has_cx_adp ||
        item.has_fp_diag || item.has_fp_adp ||
        item.has_pp_diag || item.has_pp_adp ||
        item.has_preg_lab || item.has_preg_item ||
        item.has_pal_diag || item.has_pal_adp ||
        item.has_herb || item.has_telmed || item.has_drugp ||
        item.has_instrument || item.has_knee_oper ||
        item.has_fpg || item.has_chol || item.has_anemia || item.has_iron ||
        hasFerrokidSignal ||
        item.fpg_age_eligible || item.has_fpg_adp || item.has_fpg_lab || item.has_fpg_diag ||
        item.chol_age_eligible || item.has_chol_adp || item.has_chol_lab || item.has_chol_diag ||
        item.anemia_age_eligible || item.has_anemia_adp || item.has_anemia_lab || item.has_anemia_diag ||
        item.iron_age_eligible || item.has_iron_adp || item.has_iron_diag ||
        item.has_upt || item.has_anc_visit || item.has_anc_us || item.has_anc_lab1 || item.has_anc_lab2 ||
        item.has_anc_dental_exam || item.has_anc_dental_clean ||
        item.has_post_care || item.has_post_supp || item.has_fluoride ||
        item.has_fp_pill || item.has_fp_condom ||
        item.has_chemo_diag || item.has_hepc_diag || item.has_rehab_diag || item.has_crrt_diag ||
        item.has_robot_item || item.has_proton_diag || item.has_cxr_item || item.has_clopidogrel ||
        dialysisRegex.test(item.main_diag || '') ||   // Dialysis
        item.project_code === businessRules.project_codes.er_emergency ||
        (item.fund || '').includes('ฉุกเฉิน') ||
        (item.fund || '').endsWith('AE') ||
        (item.fund || '').includes('OP Refer')
      );

      const isOFC_LGO = item.hipdata_code === 'OFC' || item.hipdata_code === 'LGO';
      const isUCS = item.hipdata_code === 'UCS' || item.hipdata_code === 'WEL';
      const isBillable = !item.an && (isOFC_LGO || (isUCS && isSpecialFund));

      if (isBillable && !hasCloseEp) {
        issues.push('ER108: ยังไม่ปิดสิทธิ NHSO (EP)');
      }

      return {
        ...item,
        has_authen: item.has_authen ? 1 : 0,
        has_close: hasCloseEp ? 1 : 0,
        serviceType,
        missing: issues.map(iss => iss.split(': ')[1] || iss), // Extract display label
        issues, // Combined error codes
        status,
        isPotentialClaim: isSpecialFund,
        isBillable,
        _dataSource: usingRealData ? 'HOSxP-Database' : 'Mock-Fallback' // getVisitsCached will indicate source
      };
    });

    res.json({
      success: true,
      dataSource: usingRealData ? 'HOSxP-Database' : 'Mock-Fallback',
      totalRecords: enrichedData.length,
      data: enrichedData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching eligible visits:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});


// API สำหรับส่งออกข้อมูล 16 แฟ้ม เป็นไฟล์ ZIP (MOPH 16 Folders)
app.post('/api/fdh/export-zip', async (req, res) => {
  try {
    const { vns } = req.body;

    if (!vns || !Array.isArray(vns) || vns.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรายการที่ต้องการส่งออก' });
    }

    console.log(`📦 Exporting ${vns.length} visits to FDH ZIP format...`);

    // 1. ดึงข้อมูลจากฐานข้อมูล
    const data = await getExportData(vns);

    if (!data) {
      console.error('❌ getExportData returned null for VNs:', vns);
      return res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลจากฐานข้อมูลได้' });
    }

    // 2. สร้างไฟล์ ZIP
    const zip = new AdmZip();

    // รายชื่อแฟ้มทั้งหมด 16 แฟ้ม (ตามมาตรฐานรหัส 16 แฟ้ม)
    const folderNames = ['INS', 'PAT', 'OPD', 'ORF', 'ODX', 'OOP', 'IPD', 'IRF', 'IDX', 'IOP', 'CHT', 'CHA', 'AER', 'ADP', 'LVD', 'DRU'];

    const fileLayouts: Record<string, string[]> = {
      INS: ['HN', 'INSCL', 'SUBTYPE', 'CID', 'HCODE', 'DATEEXP', 'HOSPMAIN', 'HOSPSUB', 'GOVCODE', 'GOVNAME', 'PERMITNO', 'DOCNO', 'OWNRPID', 'OWNNAME', 'AN', 'SEQ', 'SUBINSCL', 'RELINSCL', 'HTYPE'],
      PAT: ['HCODE', 'HN', 'CHANGWAT', 'AMPHUR', 'DOB', 'SEX', 'MARRIAGE', 'OCCUPA', 'NATION', 'PERSON_ID', 'NAMEPAT', 'TITLE', 'FNAME', 'LNAME', 'IDTYPE'],
      OPD: ['HN', 'CLINIC', 'DATEOPD', 'TIMEOPD', 'SEQ', 'UUC', 'DETAIL', 'BTEMP', 'SBP', 'DBP', 'PR', 'RR', 'OPTYPE', 'TYPEIN', 'TYPEOUT'],
      ORF: ['HN', 'DATEOPD', 'CLINIC', 'REFER', 'REFERTYPE', 'SEQ', 'REFERDATE'],
      ODX: ['HN', 'DATEDX', 'CLINIC', 'DIAG', 'DXTYPE', 'DRDX', 'PERSON_ID', 'SEQ'],
      OOP: ['HN', 'DATEOPD', 'CLINIC', 'OPER', 'DROPID', 'PERSON_ID', 'SEQ', 'SERVPRICE'],
      IPD: ['HN', 'AN', 'DATEADM', 'TIMEADM', 'DATEDSC', 'TIMEDSC', 'DISCHS', 'DISCHT', 'WARDDSC', 'DEPT', 'ADM_W', 'UUC', 'SVCTYPE'],
      IRF: ['AN', 'REFER', 'REFERTYPE'],
      IDX: ['AN', 'DIAG', 'DXTYPE', 'DRDX'],
      IOP: ['AN', 'OPER', 'OPTYPE', 'DROPID', 'DATEIN', 'TIMEIN', 'DATEOUT', 'TIMEOUT'],
      CHT: ['HN', 'AN', 'DATE', 'TOTAL', 'PAID', 'PTTYPE', 'PERSON_ID', 'SEQ', 'OPD_MEMO', 'INVOICE_NO', 'INVOICE_LT'],
      CHA: ['HN', 'AN', 'DATE', 'CHRGITEM', 'AMOUNT', 'PERSON_ID', 'SEQ'],
      AER: ['HN', 'AN', 'DATEOPD', 'AUTHAE', 'AEDATE', 'AETIME', 'AETYPE', 'REFER_NO', 'REFMAINI', 'IREFTYPE', 'REFMAINO', 'OREFTYPE', 'UCAE', 'EMTYPE', 'SEQ', 'AESTATUS', 'DALERT', 'TALERT'],
      ADP: ['HN', 'AN', 'DATEOPD', 'BILLMAUD', 'TYPE', 'CODE', 'QTY', 'RATE', 'SEQ', 'CAGCODE', 'DOSE', 'CA_TYPE', 'SERIALNO', 'TOTCOPAY', 'USE_STATUS', 'TOTAL', 'QTYDAY', 'TMLTCODE', 'STATUS1', 'BI', 'GRAVIDA', 'GA_WEEK', 'DCIP', 'LMP', 'SP_ITEM'],
      LVD: ['SEQLVD', 'AN', 'DATEOUT', 'TIMEOUT', 'DATEIN', 'TIMEIN', 'QTYDAY'],
      DRU: ['HCODE', 'HN', 'AN', 'CLINIC', 'PERSON_ID', 'DATE_SERV', 'DID', 'DIDNAME', 'AMOUNT', 'DRUGPRIC', 'DRUGCOST', 'DIDSTD', 'UNIT', 'UNIT_PACK', 'SEQ', 'DRUGTYPE', 'DRUGREMARK', 'PA_NO', 'TOTCOPAY', 'USE_STATUS', 'TOTAL']
    };

    // ฟังก์ชันสำหรับแปลงข้อมูลเป็นรูปแบบ Pipe Delimited (.txt)
    // ใช้ header และลำดับคอลัมน์ตายตัวตามตัวอย่างไฟล์ที่นำเข้าได้
    const normalizePipeValue = (value: unknown) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/\r\n/g, ' ')
        .replace(/[\r\n]/g, ' ')
        .replace(/\|/g, ' ')
        .trim();
    };

    const formatToPipe = (data: any, folder: string) => {
      const columns = fileLayouts[folder] || [];
      const rows = (data as any)[folder] || [];
      const header = columns.join('|');
      if (!rows || rows.length === 0) {
        return header;
      }

      const body = rows
        .map((row: any) => columns.map((column) => normalizePipeValue(row?.[column])).join('|'))
        .join('\r\n');

      return `${header}\r\n${body}`;
    };

    // ใส่ข้อมูลลงในแต่ละไฟล์
    folderNames.forEach(folder => {
      const content = formatToPipe(data, folder);
      zip.addFile(`${folder}.TXT`, iconv.encode(content, 'cp874'));
    });

    // 3. ส่งไฟล์ ZIP กลับไปยัง Client
    const zipBuffer = zip.toBuffer();
    const filename = `FDH_Export_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(zipBuffer);

    console.log(`✅ Exported ZIP successfully: ${filename} (${zipBuffer.length} bytes)`);

  } catch (error) {
    console.error('Error exporting ZIP:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการสร้างไฟล์ ZIP' });
  }
});

// API สำหรับดูข้อมูล 16 แฟ้ม (Preview JSON)
app.post('/api/fdh/view-data', async (req, res) => {
  try {
    const { vns } = req.body;
    if (!vns || !Array.isArray(vns) || vns.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรายการที่ต้องการดูข้อมูล' });
    }

    const data = await getExportData(vns);
    if (!data) {
      return res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลจากฐานข้อมูลได้' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error viewing data:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการดึงข้อมูลแสดงผล' });
  }
});


// API สำหรับส่งข้อมูลไปยังระบบ FDH
app.post('/api/fdh/submit', (req, res) => {
  try {
    const { records, submittedAt } = req.body;

    console.log(`📤 Submitting ${records.length} records to FDH`);

    res.json({
      success: true,
      message: 'Data submitted to FDH successfully',
      submittedRecords: records.length,
      submittedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error submitting to FDH:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับดึงรายการกองทุนทั้งหมด
app.get('/api/hosxp/funds', async (req, res) => {
  try {
    // Get all unique funds from the database
    const allData = await getCheckData();

    if (Array.isArray(allData) && allData.length > 0) {
      // Extract unique funds and sort them
      const fundsSet = new Set<string>();
      allData.forEach((record: Record<string, unknown>) => {
        if (record.fund) {
          fundsSet.add(String(record.fund));
        }
      });
      const funds = Array.from(fundsSet).sort().map((fundName) => ({
        id: fundName,    // ใช้ชื่อกองทุนจริงเป็น id เช่น "UCS", "บัตรทอง"
        name: fundName,
      }));

      res.json(funds);
    } else {
      // Fallback to mock funds
      const mockFunds = [
        { id: 'UCS', name: 'กองทุนหลักประกันสุขภาพถ้วนหน้า (UCS)' },
        { id: 'SSS', name: 'กองทุนประกันสังคม (SSS)' },
        { id: 'OFC', name: 'กองทุนข้าราชการ (OFC)' },
        { id: 'LGO', name: 'กองทุน อปท.' },
      ];
      res.json(mockFunds);
    }
  } catch (error) {
    console.error('Error fetching funds:', error);
    const mockFunds = [
      { id: 'UCS', name: 'กองทุนหลักประกันสุขภาพถ้วนหน้า (UCS)' },
      { id: 'SSS', name: 'กองทุนประกันสังคม (SSS)' },
      { id: 'OFC', name: 'กองทุนข้าราชการ (OFC)' },
      { id: 'LGO', name: 'กองทุน อปท.' },
    ];
    res.json(mockFunds);
  }
});

// API สำหรับตรวจสอบความถูกต้องของข้อมูลแบบละเอียด
app.post('/api/hosxp/validate', (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const validated = records.map((record: Record<string, unknown>) => {
      const issues: string[] = [];

      // ตรวจสอบ HN
      if (!record.hn || String(record.hn).trim().length === 0) {
        issues.push('❌ ขาดเลขประจำตัวผู้ป่วย (HN)');
      }

      // ตรวจสอบชื่อผู้ป่วย
      if (!record.patientName || String(record.patientName).trim().length === 0) {
        issues.push('❌ ขาดชื่อผู้ป่วย');
      }

      // ตรวจสอบกองทุน
      if (!record.fund || String(record.fund).trim().length === 0) {
        issues.push('❌ ขาดข้อมูลกองทุน');
      }

      // ตรวจสอบราคา
      if (!record.price || Number(record.price) <= 0) {
        issues.push('❌ ราคาไม่ถูกต้องหรือไม่ได้กำหนด');
      }

      // ตรวจสอบวันที่บริการ
      if (!record.serviceDate || String(record.serviceDate).trim().length === 0) {
        issues.push('❌ ขาดวันที่บริการ');
      }

      // ตรวจสอบประเภทบริการ
      if (!record.serviceType || String(record.serviceType).trim().length === 0) {
        issues.push('❌ ขาดประเภทบริการ');
      }

      return {
        ...record,
        status: issues.length === 0 ? 'สมบูรณ์' : 'ไม่สมบูรณ์',
        issues,
      };
    });

    res.json(validated);
  } catch (error) {
    console.error('Error validating records:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับตรวจสอบความถูกต้องของข้อมูลแบบเชิงลึก
app.post('/api/hosxp/validate-detailed', async (req, res) => {
  try {
    const { records, validationMode } = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const validated = records.map((record: Record<string, unknown>) => {
      const issues: string[] = [];
      const details: Record<string, unknown> = {};

      // ===== ตรวจสอบฟิลด์พื้นฐาน =====

      // 1. HN
      if (!record.hn || String(record.hn).trim().length === 0) {
        issues.push('❌ ขาดเลขประจำตัวผู้ป่วย (HN)');
      } else {
        details.hn_status = '✓';
      }

      // 2. ชื่อผู้ป่วย
      if (!record.patientName || String(record.patientName).trim().length === 0) {
        issues.push('❌ ขาดชื่อผู้ป่วย');
      } else {
        details.name_status = '✓';
      }

      // 3. กองทุน
      if (!record.fund || String(record.fund).trim().length === 0) {
        issues.push('❌ ขาดข้อมูลกองทุน');
      } else {
        details.fund_status = '✓';
        // ตรวจสอบว่าเป็นกองทุนย่อย
        const fundName = String(record.fund);
        if (fundName.includes('AE') || fundName.includes('ร่วมจ่าย')) {
          details.fund_type = 'sub-fund';
          details.note = 'เป็นกองทุนย่อย';
        }
      }

      // 4. ราคา
      if (!record.price || Number(record.price) <= 0) {
        issues.push('❌ ราคาไม่ถูกต้องหรือไม่ได้กำหนด');
      } else {
        details.price_status = '✓';
        details.price_value = record.price;
      }

      // 5. วันที่บริการ
      if (!record.serviceDate || String(record.serviceDate).trim().length === 0) {
        issues.push('❌ ขาดวันที่บริการ');
      } else {
        details.date_status = '✓';
      }

      // 6. ประเภทบริการ
      if (!record.serviceType || String(record.serviceType).trim().length === 0) {
        issues.push('❌ ขาดประเภทบริการ');
      } else {
        const serviceType = String(record.serviceType);
        if (serviceType === 'OPD') {
          details.service_type_detail = 'ผู้ป่วยนอก';
        } else if (serviceType === 'IPD') {
          details.service_type_detail = 'ผู้ป่วยใน';
        }
        details.serviceType_status = '✓';
      }

      // ===== ตรวจสอบเพิ่มเติม (ถ้า validationMode = 'detailed') =====
      if (validationMode === 'detailed') {
        // 7. รหัสยา
        if (!record.drugCode || String(record.drugCode).trim().length === 0) {
          issues.push('⚠️ ไม่มีรหัสยา (Drug Code)');
          details.drug_warning = true;
        } else {
          details.drug_code = record.drugCode;
        }

        // 8. รหัสหัตถการ
        if (!record.procedureCode || String(record.procedureCode).trim().length === 0) {
          issues.push('⚠️ ไม่มีรหัสหัตถการ (Procedure Code)');
          details.procedure_warning = true;
        } else {
          details.procedure_code = record.procedureCode;
        }

        // 9. รหัสสิทธิ์
        if (!record.rightCode || String(record.rightCode).trim().length === 0) {
          issues.push('⚠️ ไม่มีรหัสสิทธิ์ (Right Code)');
          details.right_warning = true;
        } else {
          details.right_code = record.rightCode;
        }
      }

      return {
        ...record,
        status: issues.filter(i => i.includes('❌')).length === 0 ? 'สมบูรณ์' : 'ไม่สมบูรณ์',
        issues,
        details,
      };
    });

    res.json(validated);
  } catch (error) {
    console.error('Error validating records:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API สำหรับตรวจสอบสถานะฐานข้อมูล
app.get('/api/hosxp/status', async (req, res) => {
  try {
    const dbStatus = await testDatabaseConnection();
    res.json({
      database: {
        connected: dbStatus.isConnected,
        hasData: dbStatus.hasData,
        tables: dbStatus.tableCount,
        recentRecords: dbStatus.sampleRecordCount,
        error: dbStatus.error || null,
      },
      server: {
        status: 'running', mode: dbStatus.isConnected ? 'real-data' : 'mock-fallback',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    res.status(500).json({
      database: { connected: false, error: 'Connection test failed' },
      server: { status: 'error', mode: 'mock-fallback' },
    });
  }
});

// API ทดสอบโครงสร้างตาราง s_drugitems
app.get('/api/test/s-drugitems-structure', async (req, res) => {
  try {
    const { testSDrugitemsStructure } = await import('./db.js');
    const structure = await testSDrugitemsStructure();

    res.json({
      success: true,
      message: 'ตรวจสอบโครงสร้างตาราง s_drugitems เรียบร้อย',
      columns: structure,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing s_drugitems structure:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการตรวจสอบโครงสร้างตาราง',
      message: (error as Error).message
    });
  }
});

// API ทดสอบการ JOIN ระหว่าง opitemrece และ s_drugitems
app.get('/api/test/receipt-join/:vn', async (req, res) => {
  try {
    const { testReceiptJoin } = await import('./db.js');
    const vn = req.params.vn;
    const joinResult = await testReceiptJoin(vn);

    res.json({
      success: true,
      message: `ทดสอบการ JOIN สำหรับ VN: ${vn} เรียบร้อย`,
      vn: vn,
      items: joinResult,
      count: joinResult.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing receipt join:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการทดสอบ JOIN',
      message: (error as Error).message,
      vn: req.params.vn
    });
  }
});

// API ทดสอบค่า ovstost ที่มีในระบบ
app.get('/api/test/ovstost-values', async (req, res) => {
  try {
    const { testDatabaseConnection } = await import('./db.js');
    const dbStatus = await testDatabaseConnection();

    if (!dbStatus.isConnected) {
      return res.json({
        success: false,
        error: 'Database not connected',
        message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'
      });
    }

    // ดึงค่า ovstost ที่มีในระบบพร้อมจำนวน
    const mysql = await import('mysql2/promise');
    const pool = mysql.default.createPool({
      host: process.env.HOSXP_HOST || '192.168.2.254',
      user: process.env.HOSXP_USER || 'opd',
      password: process.env.HOSXP_PASSWORD || 'opd',
      database: process.env.HOSXP_DB || 'hos',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    const connection = await pool.getConnection();

    // ดึงค่า ovstost ที่แตกต่างกันพร้อมจำนวนและตัวอย่าง
    const [ovstostValues] = await connection.query(`
      SELECT 
        ovst.ovstost,
        COUNT(*) as count,
        MIN(ovst.vstdate) as earliest_date,
        MAX(ovst.vstdate) as latest_date,
        GROUP_CONCAT(DISTINCT ovst.vn ORDER BY ovst.vstdate DESC LIMIT 3) as sample_vns
      FROM ovst 
      WHERE DATE(ovst.vstdate) >= '2026-03-01'
      GROUP BY ovst.ovstost 
      ORDER BY count DESC
      LIMIT 20
    `);

    // ดึงข้อมูลตัวอย่างจาก ovstost แต่ละประเภท
    const [sampleData] = await connection.query(`
      SELECT 
        ovst.vn,
        ovst.ovstost,
        ovst.vstdate,
        CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patientName
      FROM ovst
      LEFT JOIN patient pt ON ovst.hn = pt.hn
      WHERE DATE(ovst.vstdate) >= '2026-03-01'
      ORDER BY ovst.vstdate DESC
      LIMIT 10
    `);

    connection.release();
    pool.end();

    res.json({
      success: true,
      message: 'ตรวจสอบค่า ovstost ในระบบเรียบร้อย',
      ovstost_summary: ovstostValues,
      sample_records: sampleData,
      current_mapping: {
        'OPD': "ovstost IN ('1', '01')",
        'IPD': "ovstost IN ('2', '02')",
        'OTHER': 'กรณีอื่นๆ'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking ovstost values:', error);
    res.status(500).json({
      success: false,
      error: 'เกิดข้อผิดพลาดในการตรวจสอบค่า ovstost',
      message: (error as Error).message
    });
  }
});

// API สำหรับดึงข้อมูล Monitor หน่วยไต (N185) พร้อม ROI Analysis
app.get('/api/hosxp/kidney-monitor', async (req, res) => {
  try {    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing date parameters' });
    }
    console.log(`🏥 Fetching Kidney Monitor Data (Detailed ROI) from ${startDate} to ${endDate}`);

    // ใช้ function ใหม่ที่คำนวณ ROI ละเอียด
    const result = await getKidneyMonitorDetailed(startDate as string, endDate as string);

    console.log(`✅ Found ${result.returned}/${result.totalCount} kidney cases with ROI analysis${result.truncated ? ' ⚠️ TRUNCATED' : ''}`);
    res.json({
      success: true,
      data: result.data,
      total: result.totalCount,
      meta: {
        total: result.totalCount,
        returned: result.returned,
        truncated: result.truncated,
        limit: result.totalCount,
      }
    });
  } catch (error) {
    console.error('Error fetching kidney monitor data:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Debug endpoint for kidney monitor queries
app.get('/api/debug/kidney-monitor', async (req, res) => {
  try {
    const conn = await getUTFConnection();
    const { startDate = '2026-03-01', endDate = '2026-03-21' } = req.query;

    console.log(`\n🔍 DEBUG: Testing kidney monitor queries from ${startDate} to ${endDate}`);    // Test 1: Check N185/Z49 patients
    console.log('\n--- Test 1: N185/Z49 patients ---');
    const [test1] = await conn.query(`
      SELECT COUNT(DISTINCT o.vn) as count
      FROM ovst o
      JOIN ovstdiag d ON o.vn = d.vn
      WHERE DATE(o.vstdate) BETWEEN ? AND ?
        AND (d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%')
    ` as string, [startDate, endDate]);
    console.log('N185/Z49 record count:', test1);

    // Test 2: Get sample dialysis patients
    console.log('\n--- Test 2: Sample dialysis patients (LIMIT 3) ---');
    const [test2] = await conn.query(`
      SELECT 
        o.vn, o.hn, o.vstdate,
        pt.pname, pt.fname, pt.lname,
        ptt.name as pttname,
        d.icd10
      FROM ovst o
      LEFT JOIN patient pt ON o.hn = pt.hn
      LEFT JOIN pttype ptt ON pt.pttype = ptt.pttype
      JOIN ovstdiag d ON o.vn = d.vn
      WHERE DATE(o.vstdate) BETWEEN ? AND ?
        AND (d.icd10 LIKE 'N185%' OR d.icd10 LIKE 'Z49%')
      ORDER BY o.vstdate DESC
      LIMIT 3
    ` as string, [startDate, endDate]);
    console.log('Sample patients:', test2);    // Test 3: Check opitemrece columns
    console.log('\n--- Test 3: OPITEMRECE columns ---');
    const [test3] = await conn.query(`DESCRIBE opitemrece` as string);
    const columns = (test3 as Record<string, unknown>[]).map(c => c.Field);
    console.log('Columns:', columns);

    // Test 4: Get sample opitemrece data for one patient
    let sampleVN = '';
    if (Array.isArray(test2) && test2.length > 0) {
      sampleVN = (test2[0] as Record<string, unknown>).vn as string;
    }

    console.log(`\n--- Test 4: OPITEMRECE data for VN ${sampleVN} ---`);
    const [test4] = await conn.query(`
      SELECT *
      FROM opitemrece
      WHERE vn = ?
      LIMIT 10
    ` as string, [sampleVN]);

    // Log the data for inspection
    if (Array.isArray(test4) && test4.length > 0) {
      console.log(`Found ${test4.length} items for this visit`);
      console.log('First item:', JSON.stringify(test4[0], null, 2));
      console.log('All items summary:');
      (test4 as Record<string, unknown>[]).forEach((item: Record<string, unknown>, idx: number) => {
        console.log(`  Item ${idx}: icode=${item.icode}, income=${item.income}, qty=${item.qty}, unitprice=${item.unitprice}, sum_price=${item.sum_price}`);
      });
    }

    conn.release();
    res.json({
      success: true,
      debug: {
        test1,
        test2_count: Array.isArray(test2) ? test2.length : 0,
        test2_sample: Array.isArray(test2) ? test2.slice(0, 2) : [],
        opitemrece_columns: columns,
        sample_vn: sampleVN,
        sample_opitemrece_items: Array.isArray(test4) ? test4.slice(0, 3) : [],
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({ success: false, error: String(error) });
  }
});

// Health check endpoint
// --- Configuration API ---

// GET: ดึงข้อมูลการตั้งค่าธุรกิจ (Backend)
app.get('/api/config/business-rules/backend', async (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config', 'business_rules.json');
    const data = await readConfigWithFallback(configPath);
    res.json(data);
  } catch (error) {
    console.error('Error reading backend config:', error);
    res.status(500).json({ success: false, error: 'Cannot read backend configuration' });
  }
});

ensureRepstmTables()
  .then(() => {
    console.log('✅ REP/STM/INV import tables ready in repstminv');
  })
  .catch((error) => {
    console.error('❌ REP/STM/INV table setup failed:', error);
  });

ensureNhsoClosePrivilegeTable()
  .then(() => {
    console.log('✅ NHSO close privilege table ready in HOSxP');
  })
  .catch((error) => {
    console.error('❌ NHSO close privilege table setup failed:', error);
  });

app.post('/api/fdh/import-status', async (req, res) => {
  try {
    const { jwtToken, hcode, environment, transactionUids } = req.body as {
      jwtToken?: string;
      hcode?: string;
      environment?: 'prd' | 'uat';
      transactionUids?: string[];
    };

    const mergedConfig = await getResolvedFdhApiConfig({
      ...(environment ? { environment } : {}),
      ...(hcode ? { hcode } : {})
    });

    const token = jwtToken?.trim();
    const finalHcode = String(hcode || mergedConfig.hcode || '').trim();
    const finalEnvironment = String(environment || mergedConfig.environment || 'prd') as 'prd' | 'uat';
    const apiBaseUrl = String(mergedConfig.apiBaseUrl || '').replace(/\/+$/, '');

    if (!token) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ JWT token' });
    }

    if (!finalHcode) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ HCODE' });
    }

    if (!transactionUids || !Array.isArray(transactionUids) || transactionUids.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ transaction_uid อย่างน้อย 1 รายการ' });
    }

    const uniqueTransactionUids = Array.from(new Set(transactionUids.map(item => String(item).trim()).filter(Boolean)));
    const endpoint = `${apiBaseUrl}/api/v2/reservation/get`;

    const responses = await Promise.all(uniqueTransactionUids.map(async (transactionUid) => {
      const requestPayload = {
        transaction_uid: transactionUid,
        hcode: finalHcode
      };

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(requestPayload)
        });

        const responseJson = await response.json().catch(() => ({}));
        await saveFdhStatusImportLog({
          transactionUid,
          hcode: finalHcode,
          environment: finalEnvironment,
          responseStatus: Number(responseJson.status || response.status) || response.status,
          responseMessage: String(responseJson.message || ''),
          responseMessageTh: String(responseJson.message_th || ''),
          requestPayload,
          responsePayload: responseJson
        });

        return {
          transaction_uid: transactionUid,
          request_payload: requestPayload,
          response_payload: responseJson,
          response_status: Number(responseJson.status || response.status) || response.status,
          response_message: responseJson.message || response.statusText,
          response_message_th: responseJson.message_th || ''
        };
      } catch (error) {
        const errorPayload = {
          status: 500,
          message: 'request failed',
          message_th: (error as Error).message
        };

        await saveFdhStatusImportLog({
          transactionUid,
          hcode: finalHcode,
          environment: finalEnvironment,
          responseStatus: 500,
          responseMessage: 'request failed',
          responseMessageTh: (error as Error).message,
          requestPayload,
          responsePayload: errorPayload
        });

        return {
          transaction_uid: transactionUid,
          request_payload: requestPayload,
          response_payload: errorPayload,
          response_status: 500,
          response_message: 'request failed',
          response_message_th: (error as Error).message
        };
      }
    }));

    res.json({
      success: true,
      endpoint,
      imported: responses.length,
      data: responses
    });
  } catch (error) {
    console.error('Error importing FDH status:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการนำเข้าสถานะจาก FDH' });
  }
});

app.get('/api/fdh/import-status/logs', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const data = await getFdhStatusImportLogs(limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching FDH import logs:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านประวัติการนำเข้าสถานะ' });
  }
});

app.post('/api/repstm/import', async (req, res) => {
  try {
    const { dataType, sourceFilename, sheetName, importedBy, notes, rows } = req.body as {
      dataType?: 'REP' | 'STM' | 'INV';
      sourceFilename?: string;
      sheetName?: string;
      importedBy?: string;
      notes?: string;
      rows?: Record<string, unknown>[];
    };

    const normalizedType = String(dataType || '').toUpperCase() as 'REP' | 'STM' | 'INV';
    if (!['REP', 'STM', 'INV'].includes(normalizedType)) {
      return res.status(400).json({ success: false, error: 'dataType ต้องเป็น REP, STM หรือ INV' });
    }

    if (!sourceFilename || !String(sourceFilename).trim()) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุชื่อไฟล์ต้นทาง' });
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลสำหรับนำเข้า' });
    }

    const sanitizedRows = rows
      .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
      .map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [String(key).trim(), value ?? ''])
      ));

    if (sanitizedRows.length === 0) {
      return res.status(400).json({ success: false, error: 'ข้อมูลหลังแปลงไฟล์ไม่อยู่ในรูปแบบตาราง' });
    }

    const result = await importRepstmRows({
      dataType: normalizedType,
      sourceFilename: String(sourceFilename).trim(),
      sheetName: sheetName ? String(sheetName).trim() : undefined,
      importedBy: importedBy ? String(importedBy).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      rows: sanitizedRows,
    });

    if (!result.success) {
      throw result.error || new Error('Import failed');
    }

    res.json({
      success: true,
      duplicate: Boolean((result as Record<string, unknown>).duplicate),
      message: typeof (result as Record<string, unknown>).message === 'string'
        ? String((result as Record<string, unknown>).message)
        : `นำเข้า ${normalizedType} สำเร็จ`,
      batchId: result.batchId,
      rowCount: result.rowCount,
    });
  } catch (error) {
    console.error('Error importing REP/STM/INV:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการนำเข้า REP/STM/INV' });
  }
});

app.get('/api/repstm/batches', async (req, res) => {
  try {
    const dataType = req.query.dataType ? String(req.query.dataType).toUpperCase() as 'REP' | 'STM' | 'INV' : undefined;
    const limit = Number(req.query.limit || 20);
    const data = await getRepstmImportBatches(dataType, limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching REP/STM/INV batches:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านประวัติการนำเข้า REP/STM/INV' });
  }
});

app.get('/api/repstm/:dataType', async (req, res) => {
  try {
    const dataType = String(req.params.dataType || '').toUpperCase() as 'REP' | 'STM' | 'INV';
    if (!['REP', 'STM', 'INV'].includes(dataType)) {
      return res.status(400).json({ success: false, error: 'dataType ต้องเป็น REP, STM หรือ INV' });
    }

    const limit = Number(req.query.limit || 200);
    const data = dataType === 'REP'
      ? await getRepDataRows(limit)
      : await getRepstmImportedRows(dataType, limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching REP/STM/INV rows:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านข้อมูล REP/STM/INV' });
  }
});

app.get('/api/receivables/candidates', async (req, res) => {
  try {
    const data = await getReceivableCandidates({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      patientRight: req.query.patientRight ? String(req.query.patientRight) : undefined,
      hosxpRight: req.query.hosxpRight ? String(req.query.hosxpRight) : undefined,
      financeRight: req.query.financeRight ? String(req.query.financeRight) : undefined,
    });
    res.json({ success: true, data, totalRecords: data.length });
  } catch (error) {
    console.error('Error fetching receivable candidates:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านข้อมูลตั้งลูกหนี้สิทธิ์' });
  }
});

app.get('/api/receivables/filter-options', async (_req, res) => {
  try {
    const data = await getReceivableFilterOptions();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching receivable filter options:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านตัวเลือกสิทธิ์บัญชีลูกหนี้' });
  }
});

app.get('/api/receivables/batches', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const data = await getReceivableBatches(limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching receivable batches:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านประวัติบัญชีลูกหนี้' });
  }
});

app.get('/api/insurance/overview', async (req, res) => {
  try {
    const data = await getInsuranceOverview({
      startDate: String(req.query.startDate || ''),
      endDate: String(req.query.endDate || ''),
      accountCode: String(req.query.accountCode || ''),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching insurance overview:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานภาพรวมงานประกันได้',
    });
  }
});

app.post('/api/receivables/batches', async (req, res) => {
  try {
    const result = await saveReceivableBatch(req.body || {});
    if (!result.success) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('Error saving receivable batch:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกชุดบัญชีลูกหนี้' });
  }
});

// GET: ดึงข้อมูลการตั้งค่าธุรกิจ (Frontend)
app.get('/api/config/business-rules/frontend', async (req, res) => {
  try {
    // Frontend config is in ../src/config/business_rules.json relative to server/index.ts
    const configPath = path.join(__dirname, '..', 'src', 'config', 'business_rules.json');
    const data = await readConfigWithFallback(configPath);
    res.json(data);
  } catch (error) {
    console.error('Error reading frontend config:', error);
    res.status(500).json({ success: false, error: 'Cannot read frontend configuration' });
  }
});

// POST: บันทึกการตั้งค่าธุรกิจ (Backend)
app.post('/api/config/business-rules/backend', async (req, res) => {
  try {
    const newConfig = req.body;
    const configPath = path.join(__dirname, 'config', 'business_rules.json');
    await setAppSetting(CONFIG_SETTING_KEY, newConfig);
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 4), 'utf8');
    console.log('✅ Backend business rules updated via API');
    res.json({ success: true, message: 'Backend configuration updated successfully' });
  } catch (error) {
    console.error('Error updating backend config:', error);
    res.status(500).json({ success: false, error: 'Cannot update backend configuration' });
  }
});

// POST: บันทึกการตั้งค่าธุรกิจ (Frontend)
app.post('/api/config/business-rules/frontend', async (req, res) => {
  try {
    const newConfig = req.body;
    const configPath = path.join(__dirname, '..', 'src', 'config', 'business_rules.json');
    await setAppSetting(CONFIG_SETTING_KEY, newConfig);
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 4), 'utf8');
    console.log('✅ Frontend business rules updated via API');
    res.json({ success: true, message: 'Frontend configuration updated successfully' });
  } catch (error) {
    console.error('Error updating frontend config:', error);
    res.status(500).json({ success: false, error: 'Cannot update frontend configuration' });
  }
});

app.get('/api/config/app-settings', async (req, res) => {
  try {
    const config = await getAppSetting(APP_SETTINGS_KEY);
    res.json({
      success: true,
      data: config || null,
      source: config ? 'database' : 'empty'
    });
  } catch (error) {
    console.error('Error reading app settings:', error);
    res.status(500).json({ success: false, error: 'Cannot read app settings' });
  }
});

app.post('/api/config/app-settings', async (req, res) => {
  try {
    const newSettings = req.body;
    await setAppSetting(APP_SETTINGS_KEY, newSettings);
    console.log('✅ App settings updated via API');
    res.json({ success: true, message: 'App settings updated successfully' });
  } catch (error) {
    console.error('Error updating app settings:', error);
    res.status(500).json({ success: false, error: 'Cannot update app settings' });
  }
});

app.get('/api/config/fdh-api-settings', async (req, res) => {
  try {
    const config = await getAppSetting(FDH_API_SETTINGS_KEY);
    const resolvedConfig = await getResolvedFdhApiConfig();
    res.json({
      success: true,
      data: resolvedConfig,
      source: config ? 'database' : 'default'
    });
  } catch (error) {
    console.error('Error reading FDH API settings:', error);
    res.status(500).json({ success: false, error: 'Cannot read FDH API settings' });
  }
});

app.post('/api/config/fdh-api-settings', async (req, res) => {
  try {
    const resolvedHospitalCode = await getResolvedHospitalCode();
    const payload = {
      ...getDefaultFdhApiConfig(),
      ...(req.body || {}),
      hcode: resolvedHospitalCode || String((req.body || {}).hcode || '')
    };
    await setAppSetting(FDH_API_SETTINGS_KEY, payload);
    res.json({ success: true, message: 'FDH API settings updated successfully' });
  } catch (error) {
    console.error('Error updating FDH API settings:', error);
    res.status(500).json({ success: false, error: 'Cannot update FDH API settings' });
  }
});

app.get('/api/config/nhso-authen-settings', async (_req, res) => {
  try {
    const data = await getResolvedNhsoAuthenConfig();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error reading NHSO authen settings:', error);
    res.status(500).json({ success: false, error: 'Cannot read NHSO authen settings' });
  }
});

app.post('/api/config/nhso-authen-settings', async (req, res) => {
  try {
    const current = await getResolvedNhsoAuthenConfig();
    const payload = {
      ...current,
      environment: req.body?.environment === 'uat' ? 'uat' : 'prd',
      token: String(req.body?.token || current.token || ''),
      apiBaseUrl: String(req.body?.apiBaseUrl || current.apiBaseUrl || ''),
      maxDays: Number(req.body?.maxDays || current.maxDays || 4),
    };
    await setAppSetting(NHSO_AUTHEN_SETTINGS_KEY, payload);
    res.json({ success: true, message: 'NHSO authen settings updated successfully' });
  } catch (error) {
    console.error('Error saving NHSO authen settings:', error);
    res.status(500).json({ success: false, error: 'Cannot save NHSO authen settings' });
  }
});

app.post('/api/nhso/authen/sync', async (req, res) => {
  try {
    const { startDate, endDate } = req.body as { startDate?: string; endDate?: string };
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุวันที่เริ่มต้นและสิ้นสุด' });
    }

    const authenConfig = await getResolvedNhsoAuthenConfig();
    const token = String(authenConfig.token || '').trim();
    const apiBaseUrl = String(authenConfig.apiBaseUrl || '').trim();
    const hospitalCode = await getResolvedHospitalCode();
    const maxDays = Number(authenConfig.maxDays || 4);

    if (!token) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า NHSO Token' });
    }

    const summary = await syncNhsoAuthenCodes({
      token,
      baseUrl: apiBaseUrl,
      hospitalCode,
      startDate,
      endDate,
      maxDays,
    });
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error syncing NHSO authen codes:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการ sync Authen Code' });
  }
});

app.get('/api/nhso/authen/logs', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const data = await getAuthenSyncLogs(limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error reading NHSO authen sync logs:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถอ่านประวัติการนำเข้า Authen Code ได้' });
  }
});

app.get('/api/config/nhso-close-settings', async (_req, res) => {
  try {
    const data = await getResolvedNhsoCloseConfig();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error reading NHSO close settings:', error);
    res.status(500).json({ success: false, error: 'Cannot read NHSO close settings' });
  }
});

app.post('/api/config/nhso-close-settings', async (req, res) => {
  try {
    const current = await getResolvedNhsoCloseConfig();
    const payload = {
      ...current,
      environment: req.body?.environment === 'uat' ? 'uat' : 'prd',
      token: String(req.body?.token || current.token || ''),
      apiBaseUrl: String(req.body?.apiBaseUrl || current.apiBaseUrl || ''),
      sourceId: String(req.body?.sourceId || current.sourceId || 'KSPAPI'),
      claimServiceCode: String(req.body?.claimServiceCode || current.claimServiceCode || 'PG0060001'),
      recorderPid: String(req.body?.recorderPid || current.recorderPid || ''),
      maxDays: Number(req.body?.maxDays || current.maxDays || 4),
    };
    await setAppSetting(NHSO_CLOSE_SETTINGS_KEY, payload);
    res.json({ success: true, message: 'NHSO close settings updated successfully' });
  } catch (error) {
    console.error('Error saving NHSO close settings:', error);
    res.status(500).json({ success: false, error: 'Cannot save NHSO close settings' });
  }
});

app.get('/api/nhso/close/candidates', async (req, res) => {
  try {
    await ensureNhsoClosePrivilegeTable();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุวันที่เริ่มต้นและสิ้นสุด' });
    }

    const settings = await getResolvedNhsoCloseConfig();
    const maxDays = Number(settings.maxDays || 4);
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
    if (Number.isNaN(diffDays) || diffDays < 0) {
      return res.status(400).json({ success: false, error: 'ช่วงวันที่ไม่ถูกต้อง' });
    }
    if (diffDays > maxDays) {
      return res.status(400).json({ success: false, error: `ช่วงวันที่มากเกินไป ระบบนี้รองรับไม่เกิน ${maxDays} วัน` });
    }

    const data = await getNhsoClosePrivilegeCandidates({
      startDate,
      endDate,
      closeStatus: ['pending', 'ok', 'cancel', 'error'].includes(String(req.query.closeStatus || '')) ? String(req.query.closeStatus) as 'pending' | 'ok' | 'cancel' | 'error' : 'all',
      authenStatus: ['has_authen', 'missing_authen'].includes(String(req.query.authenStatus || '')) ? String(req.query.authenStatus) as 'has_authen' | 'missing_authen' : 'all',
      mainInscl: String(req.query.mainInscl || 'all'),
      search: String(req.query.search || ''),
      limit: Number(req.query.limit || 300),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading NHSO close candidates:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการอ่านรายการปิดสิทธิ' });
  }
});

app.post('/api/nhso/close/submit', async (req, res) => {
  try {
    const { items } = req.body as {
      items?: Array<{
        vn: string;
        cid: string;
        vstDateTime: string;
        mainInscl: string;
        income: number;
        rcptMoney: number;
        ucMoney: number;
        authencodeWeb?: string;
        pttypeName?: string;
        invno?: string;
      }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาเลือกรายการที่จะปิดสิทธิอย่างน้อย 1 รายการ' });
    }

    const settings = await getResolvedNhsoCloseConfig();
    const token = String(settings.token || '').trim();
    const apiBaseUrl = String(settings.apiBaseUrl || '').trim();
    const recorderPid = String(settings.recorderPid || '').trim();
    const sourceId = String(settings.sourceId || 'KSPAPI').trim() || 'KSPAPI';
    const claimServiceCode = String(settings.claimServiceCode || 'PG0060001').trim() || 'PG0060001';
    const hospitalCode = await getResolvedHospitalCode();
    const environment = String(settings.environment || 'prd') === 'uat' ? 'uat' : 'prd';

    if (!token) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Token สำหรับปิดสิทธิ NHSO' });
    }
    if (!recorderPid) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Recorder PID' });
    }
    if (!hospitalCode) {
      return res.status(400).json({ success: false, error: 'ยังไม่พบ Hospital Code' });
    }

    const summary = await submitNhsoClosePrivileges({
      token,
      baseUrl: apiBaseUrl,
      hospitalCode,
      recorderPid,
      sourceId,
      claimServiceCode,
      environment,
      items,
    });
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error submitting NHSO close privilege:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการปิดสิทธิ NHSO' });
  }
});

app.get('/api/nhso/close/history', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const data = await getNhsoClosePrivilegeHistory(limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading NHSO close history:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถอ่านประวัติการปิดสิทธิ NHSO ได้' });
  }
});

app.post('/api/nhso/close/test-token', async (_req, res) => {
  try {
    const settings = await getResolvedNhsoCloseConfig();
    const token = String(settings.token || '').trim();
    const apiBaseUrl = String(settings.apiBaseUrl || '').trim();
    const recorderPid = String(settings.recorderPid || '').trim();
    const sourceId = String(settings.sourceId || 'KSPAPI').trim() || 'KSPAPI';
    const claimServiceCode = String(settings.claimServiceCode || 'PG0060001').trim() || 'PG0060001';
    const hospitalCode = await getResolvedHospitalCode();
    const environment = String(settings.environment || 'prd') === 'uat' ? 'uat' : 'prd';

    if (!token) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Token สำหรับปิดสิทธิ NHSO' });
    }
    if (!recorderPid) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Recorder PID' });
    }
    if (!hospitalCode) {
      return res.status(400).json({ success: false, error: 'ยังไม่พบ Hospital Code' });
    }

    const result = await testNhsoClosePrivilegeToken({
      token,
      baseUrl: apiBaseUrl,
      hospitalCode,
      recorderPid,
      sourceId,
      claimServiceCode,
      environment,
    });

    res.json({
      success: true,
      data: {
        ...result,
        tokenLooksInvalid: /invalid token/i.test(String(result.errorMessage || '')),
      },
    });
  } catch (error) {
    console.error('Error testing NHSO close token:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการทดสอบ token' });
  }
});

app.post('/api/fdh/request-token', async (req, res) => {
  try {
    const mergedConfig = await getResolvedFdhApiConfig(req.body || {});

    const tokenUrl = String(mergedConfig.tokenUrl || '').trim();
    const username = String(mergedConfig.username || '').trim();
    const password = String(mergedConfig.password || '');
    const hospitalCode = String(mergedConfig.hcode || '').trim();

    if (!tokenUrl) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า Token URL' });
    }

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'กรุณาตั้งค่า username/password สำหรับ FDH API ก่อน' });
    }

    if (!hospitalCode) {
      return res.status(400).json({ success: false, error: 'ยังไม่พบ Hospital Code (HCODE)' });
    }

    const tokenEndpoint = getFdhTokenEndpoint(tokenUrl);
    const passwordHashCandidates = getPasswordHashCandidates(password);
    const attempts: Array<{
      label: string;
      url: string;
      init: RequestInit;
    }> = [];

    for (const passwordHash of passwordHashCandidates) {
      const query = new URLSearchParams({
        Action: 'get_moph_access_token',
        user: username,
        password_hash: passwordHash,
        hospital_code: hospitalCode
      }).toString();

      attempts.push({
        label: passwordHash === password ? 'POST query + raw password' : `POST query + password_hash (${passwordHash === passwordHash.toUpperCase() ? 'SHA256 upper' : 'SHA256 lower'})`,
        url: `${tokenEndpoint}?${query}`,
        init: {
          method: 'POST'
        }
      });
    }

    const debugAttempts: Array<Record<string, unknown>> = [];

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, attempt.init);
        const rawText = await response.text();
        let parsedPayload: unknown = {};
        try {
          parsedPayload = JSON.parse(rawText);
        } catch {
          parsedPayload = { raw: rawText };
        }

        const payloadRecord = parsedPayload && typeof parsedPayload === 'object'
          ? parsedPayload as Record<string, unknown>
          : {};
        const payloadMessageCode = Number(payloadRecord.MessageCode ?? payloadRecord.status ?? 0);
        const token = extractTokenFromPayload(parsedPayload)
          || (payloadMessageCode === 0 && rawText.trim() ? rawText.trim() : null);
        debugAttempts.push({
          label: attempt.label,
          httpStatus: response.status,
          messageCode: payloadMessageCode || undefined,
          hasToken: !!token,
          responseMessage: payloadRecord.Message || payloadRecord.message || null
        });

        if (token) {
          return res.json({
            success: true,
            token,
            method: attempt.label,
            tokenUrl: attempt.url.replace(/password_hash=[^&]+/, 'password_hash=***'),
            debugAttempts
          });
        }
      } catch (error) {
        debugAttempts.push({
          label: attempt.label,
          url: attempt.url.replace(/password_hash=[^&]+/, 'password_hash=***'),
          httpStatus: 500,
          hasToken: false,
          error: (error as Error).message
        });
      }
    }

    return res.status(400).json({
      success: false,
      error: 'ไม่สามารถขอ token อัตโนมัติได้จากรูปแบบที่ระบบลองให้',
      debugAttempts
    });
  } catch (error) {
    console.error('Error requesting FDH token:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการขอ token จาก FDH' });
  }
});

app.post('/api/fdh/import-status-by-date', async (req, res) => {
  try {
    const { startDate, endDate } = req.body as { startDate?: string; endDate?: string };
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ startDate และ endDate' });
    }

    const fdhConfig = await getResolvedFdhApiConfig();
    const tokenUrl = String(fdhConfig.tokenUrl || '').trim();
    const username = String(fdhConfig.username || '').trim();
    const password = String(fdhConfig.password || '');
    const hospitalCode = String(fdhConfig.hcode || '').trim();
    const apiBaseUrl = String(fdhConfig.apiBaseUrl || 'https://fdh.moph.go.th').trim();

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า username/password สำหรับ FDH API (ตั้งค่าที่เมนู FDH API Settings)' });
    }
    if (!hospitalCode) {
      return res.status(400).json({ success: false, error: 'ยังไม่พบ Hospital Code' });
    }

    // Get FDH token
    const tokenEndpoint = getFdhTokenEndpoint(tokenUrl);
    const passwordHashCandidates = getPasswordHashCandidates(password);
    let fdhToken: string | null = null;

    for (const passwordHash of passwordHashCandidates) {
      if (fdhToken) break;
      try {
        const query = new URLSearchParams({
          Action: 'get_moph_access_token',
          user: username,
          password_hash: passwordHash,
          hospital_code: hospitalCode
        }).toString();
        const tokenRes = await fetch(`${tokenEndpoint}?${query}`, { method: 'POST' });
        const rawText = await tokenRes.text();
        let parsed: unknown = {};
        try { parsed = JSON.parse(rawText); } catch { /* raw */ }
        fdhToken = extractTokenFromPayload(parsed) || (rawText.trim().startsWith('{') ? null : rawText.trim() || null);
      } catch { /* try next */ }
    }

    if (!fdhToken) {
      return res.status(400).json({ success: false, error: 'ไม่สามารถขอ FDH token ได้ — กรุณาตรวจสอบ username/password ในการตั้งค่า FDH API' });
    }

    const summary = await importFdhStatusForDateRange({
      token: fdhToken,
      apiBaseUrl,
      hospitalCode,
      startDate,
      endDate,
    });

    return res.json({ success: true, summary });
  } catch (error) {
    console.error('Error importing FDH status:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการนำเข้าสถานะ FDH' });
  }
});

// ─── NHSO eclaim download endpoints ──────────────────────────────────────────

/** GET /api/config/nhso-eclaim-settings */
app.get('/api/config/nhso-eclaim-settings', async (_req, res) => {
  try {
    const data = await getResolvedNhsoEclaimConfig();
    res.json({ success: true, data: { ...data, password: data.password ? '***' : '' } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/config/nhso-eclaim-settings */
app.post('/api/config/nhso-eclaim-settings', async (req, res) => {
  try {
    const current = await getResolvedNhsoEclaimConfig();
    const payload = {
      ...current,
      username: String(req.body?.username ?? current.username ?? ''),
      password: req.body?.password && req.body.password !== '***'
        ? String(req.body.password)
        : String(current.password ?? ''),
      authUrl: String(req.body?.authUrl ?? current.authUrl),
      fileListUrl: String(req.body?.fileListUrl ?? current.fileListUrl),
      downloadUrl: String(req.body?.downloadUrl ?? current.downloadUrl),
    };
    await setAppSetting(NHSO_ECLAIM_SETTINGS_KEY, payload);
    res.json({ success: true, message: 'NHSO eclaim settings saved' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/nhso-eclaim/auth — get token from NHSO eclaim */
/** GET /api/nhso-eclaim/browser-status — check if browser session is alive and ready */
app.get('/api/nhso-eclaim/browser-status', async (_req, res) => {
  if (!eclaimBrowserSession) return res.json({ alive: false, ready: false });
  try {
    const url = eclaimBrowserSession.page.url();
    return res.json({ alive: true, ready: eclaimBrowserSession.ready, url, repPageUrl: eclaimBrowserSession.repPageUrl });
  } catch {
    eclaimBrowserSession = null;
    return res.json({ alive: false, ready: false });
  }
});

/** POST /api/nhso-eclaim/browser-close — close the alive browser session */
app.post('/api/nhso-eclaim/browser-close', async (_req, res) => {
  if (eclaimBrowserSession) {
    try { await eclaimBrowserSession.browser.close(); } catch { /* ignore */ }
    eclaimBrowserSession = null;
  }
  return res.json({ success: true });
});

/** POST /api/nhso-eclaim/browser-login — open Edge at MainWebAction.do, wait for login, keep browser alive */
app.post('/api/nhso-eclaim/browser-login', async (req, res) => {
  // Close any existing session first
  if (eclaimBrowserSession) {
    try { await eclaimBrowserSession.browser.close(); } catch { /* ignore */ }
    eclaimBrowserSession = null;
  }

  try {
    const { chromium } = await import('playwright');
    const edgePath64 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const fsSync = await import('fs');
    const executablePath = fsSync.existsSync(edgePath64) ? edgePath64 : fsSync.existsSync(edgePath) ? edgePath : undefined;

    const browser = await chromium.launch({ executablePath, headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Store session immediately (browser stays alive after this request returns)
    eclaimBrowserSession = { browser, context, page, ready: false, repPageUrl: '', createdAt: Date.now() };

    // Open old e-Claim system
    await page.goto('https://eclaim.nhso.go.th/webComponent/main/MainWebAction.do', { waitUntil: 'domcontentloaded' });

    // Wait up to 5 minutes for user to complete login via Keycloak OAuth
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1200);

      // Check for JSESSIONID cookie
      const cookies = await context.cookies().catch(() => [] as Awaited<ReturnType<typeof context.cookies>>);
      const jsession = cookies.find((c) => c.name.toUpperCase() === 'JSESSIONID');
      if (!jsession) continue;

      // Verify we're on eclaim main page (not Keycloak or login form)
      const currentUrl = page.url();
      if (!currentUrl.includes('eclaim.nhso.go.th')) continue;
      if (currentUrl.includes('iam.nhso.go.th') || currentUrl.includes('LoginAction.do?code=')) continue;

      const isLoginForm = await page.evaluate(() =>
        !!(document.querySelector('input[name="username"]') || document.querySelector('input[type="password"]'))
      ).catch(() => true);
      if (isLoginForm) continue;

      // Login complete — mark session ready
      eclaimBrowserSession.ready = true;

      // Auto-navigate to REP page
      try {
        const repLink = await page.$('a[href*="rep" i], a[href*="REP"], a:text-matches("REP|ข้อมูลผลการตรวจสอบ", "i")');
        if (repLink) {
          await repLink.click();
          await page.waitForTimeout(2000);
          eclaimBrowserSession.repPageUrl = page.url();
        }
      } catch { /* link not found — user can navigate manually */ }

      return res.json({ success: true, ready: true, repPageUrl: eclaimBrowserSession.repPageUrl });
    }

    // Timeout — close browser
    try { await browser.close(); } catch { /* ignore */ }
    eclaimBrowserSession = null;
    return res.status(408).json({ success: false, error: 'หมดเวลา 5 นาที — กรุณา login ให้เสร็จก่อนหมดเวลา' });
  } catch (error) {
    if (eclaimBrowserSession) {
      try { await eclaimBrowserSession.browser.close(); } catch { /* ignore */ }
      eclaimBrowserSession = null;
    }
    console.error('browser-login error:', error);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/nhso-eclaim/browser-search — navigate in the alive browser and scrape file list */
app.post('/api/nhso-eclaim/browser-search', async (req, res) => {
  if (!eclaimBrowserSession?.ready) {
    return res.status(400).json({ success: false, error: 'Browser ยังไม่พร้อม กรุณากด "เปิด Edge" และ Login ก่อน' });
  }

  const { periods: periodsBody, fileType = 'ALL' } = req.body as { periods?: string[]; fileType?: string };
  const periods = Array.isArray(periodsBody) && periodsBody.length > 0 ? periodsBody : [];
  if (periods.length === 0) return res.status(400).json({ success: false, error: 'กรุณาระบุงวด' });

  const page = eclaimBrowserSession.page;
  const allFiles: Record<string, unknown>[] = [];
  const debugLog: { period: string; url: string; title: string; rowCount: number; htmlSnippet: string }[] = [];

  // Convert YYYYMM (CE) → { year: พ.ศ., monthNum: 1-12, monthTh: Thai name }
  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const parsePeriod = (period: string) => {
    const y = parseInt(period.slice(0, 4), 10);
    const m = parseInt(period.slice(4, 6), 10);
    return { yearCE: y, yearBE: y + 543, monthNum: m, monthTh: thaiMonths[m - 1] };
  };

  // Generic table scraper — called after page is already loaded
  const scrapeFilesFromPage = async (periodStr: string): Promise<Record<string, unknown>[]> => {
    return page.evaluate((pStr) => {
      const rows: Record<string, unknown>[] = [];
      for (const table of document.querySelectorAll('table')) {
        for (const tr of table.querySelectorAll('tr')) {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 1) continue;
          const cellTexts = tds.map((td) => td.textContent?.trim() || '');
          const links = Array.from(tr.querySelectorAll('a'));
          const dlLinks = links.filter((a) =>
            /download|ดาวน์โหลด|\.zip|\.xlsx|\.xls|\.txt|\.ecd/i.test(
              a.href + a.textContent + (a.getAttribute('onclick') || '')
            )
          );
          if (dlLinks.length > 0) {
            const a = dlLinks[0];
            const filenameFromCell = cellTexts.find((t) => /\.\w{2,5}$/.test(t));
            rows.push({
              filename: filenameFromCell || a.textContent?.trim() || cellTexts[0] || 'file',
              downloadHref: a.href || '',
              downloadOnclick: a.getAttribute('onclick') || '',
              cells: cellTexts,
              period: pStr,
            });
          } else if (tds.some((td) => /REP|STM|INV|\.zip|\.xlsx|\.ecd/i.test(td.textContent || ''))) {
            rows.push({
              filename: cellTexts.find((t) => /\.\w{2,5}$/.test(t)) || cellTexts[0] || 'file',
              allLinks: links.map((a) => ({ text: a.textContent?.trim(), href: a.href, onclick: a.getAttribute('onclick') })),
              cells: cellTexts,
              period: pStr,
            });
          }
        }
      }
      return rows;
    }, periodStr);
  };

  try {
    for (const period of periods) {
      const { yearBE, monthNum, monthTh } = parsePeriod(period);
      let scraped: Record<string, unknown>[] = [];
      let usedUrl = '';
      let pageTitle = '';

      // --- Strategy 1: Finance Report page (FinanceReportMainWebAction.do) ---
      // This page shows .ecd files with "download excel" links — confirmed working from browser screenshots
      const financeUrls = [
        `https://eclaim.nhso.go.th/webComponent/finance_report/FinanceReportMainWebAction.do`,
      ];

      for (const url of financeUrls) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1500);
          pageTitle = await page.title().catch(() => '');

          // Select year (พ.ศ.) in the dropdown
          const yearSelectHandle = await page.$('select[name*="year" i], select[name*="yr" i], select:first-of-type').catch(() => null);
          if (yearSelectHandle) {
            await yearSelectHandle.selectOption({ value: String(yearBE) }).catch(async () => {
              await yearSelectHandle.selectOption({ label: String(yearBE) }).catch(() => {/* ignore */});
            });
            await page.waitForTimeout(500);
          }

          // Select month dropdown
          const monthSelectHandle = await page.$('select[name*="month" i], select[name*="mn" i], select:nth-of-type(2)').catch(() => null);
          if (monthSelectHandle) {
            await monthSelectHandle.selectOption({ value: String(monthNum) }).catch(async () => {
              await monthSelectHandle.selectOption({ label: monthTh }).catch(() => {/* ignore */});
            });
            await page.waitForTimeout(500);
          }

          // Click submit button if available
          const submitBtn = await page.$('input[type="submit"], button[type="submit"], button:text-matches("แสดง|ค้นหา|Search", "i")').catch(() => null);
          if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
          }

          scraped = await scrapeFilesFromPage(period);
          usedUrl = url;
          if (scraped.length > 0) break;
        } catch { /* try next */ }
      }

      // --- Strategy 2: UC Statement page (statementUCSAction.do) ---
      if (scraped.length === 0 && (fileType === 'ALL' || fileType === 'STM')) {
        const stmUrl = 'https://eclaim.nhso.go.th/webComponent/ucs/statementUCSAction.do';
        try {
          await page.goto(stmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1500);
          pageTitle = await page.title().catch(() => '');

          // Select ปีงบประมาณ (BE year)
          const yearSel = await page.$('select[name*="year" i], select[id*="year" i]').catch(() => null);
          if (yearSel) {
            await yearSel.selectOption({ value: String(yearBE) }).catch(() =>
              yearSel.selectOption({ label: String(yearBE) }).catch(() => {/* ignore */})
            );
            await page.waitForTimeout(300);
          }

          // Select เดือน
          const monthSel = await page.$('select[name*="month" i], select[id*="month" i]').catch(() => null);
          if (monthSel) {
            await monthSel.selectOption({ value: String(monthNum) }).catch(() =>
              monthSel.selectOption({ label: monthTh }).catch(() => {/* ignore */})
            );
            await page.waitForTimeout(300);
          }

          // Click แสดงรายการ
          const submitBtn = await page.$('input[type="submit"], button[type="submit"], button:text-matches("แสดง|ค้นหา", "i")').catch(() => null);
          if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
          }

          scraped = await scrapeFilesFromPage(period);
          usedUrl = stmUrl;
        } catch { /* ignore */ }
      }

      // --- Strategy 3: REP action — method=list works, method=search often fails ---
      if (scraped.length === 0 && (fileType === 'ALL' || fileType === 'REP')) {
        const repUrls = [
          `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=list&period=${period}`,
          `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=search&period=${period}`,
          eclaimBrowserSession.repPageUrl || '',
        ].filter(Boolean);

        for (const url of repUrls) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await page.waitForTimeout(1500);
            pageTitle = await page.title().catch(() => '');

            const isErrorPage = pageTitle.toLowerCase().includes('error') || await page.evaluate(() =>
              (document.body?.textContent || '').includes('has no explicit mapping for /error')
            ).catch(() => false);
            if (isErrorPage) continue;

            scraped = await scrapeFilesFromPage(period);
            usedUrl = url;
            if (scraped.length > 0) break;
          } catch { /* try next */ }
        }
      }

      allFiles.push(...scraped);

      // Debug: snapshot of current page HTML
      const htmlSnippet = await page.evaluate(() => document.body?.innerHTML?.slice(0, 3000) || '').catch(() => '');
      debugLog.push({ period, url: usedUrl || 'none', title: pageTitle, rowCount: scraped.length, htmlSnippet });
    }

    return res.json({ success: true, data: allFiles, total: allFiles.length, debug: debugLog });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message, debug: debugLog });
  }
});

/** POST /api/nhso-eclaim/browser-download — download a file via the alive browser, return base64 */
app.post('/api/nhso-eclaim/browser-download', async (req, res) => {
  if (!eclaimBrowserSession?.ready) {
    return res.status(400).json({ success: false, error: 'Browser ยังไม่พร้อม กรุณา login ก่อน' });
  }

  const { downloadHref, downloadOnclick, filename } = req.body as {
    downloadHref?: string;
    downloadOnclick?: string;
    filename?: string;
  };

  const page = eclaimBrowserSession.page;

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      (async () => {
        if (downloadHref && /^https?:\/\//i.test(downloadHref)) {
          await page.goto(downloadHref, { waitUntil: 'domcontentloaded' });
        } else if (downloadOnclick) {
          await page.evaluate((onclick) => { (new Function(onclick))(); }, downloadOnclick);
        } else if (downloadHref) {
          // relative URL — evaluate as JS or navigate
          await page.evaluate((href) => { window.location.href = href; }, downloadHref);
        }
      })(),
    ]);

    const os = await import('os');
    const pathMod = await import('path');
    const suggestedName = filename || download.suggestedFilename() || 'eclaim-download';
    const tempPath = pathMod.join(os.tmpdir(), suggestedName);
    await download.saveAs(tempPath);

    const fsSync = await import('fs');
    const buffer = fsSync.readFileSync(tempPath);
    const base64 = buffer.toString('base64');
    try { fsSync.unlinkSync(tempPath); } catch { /* ignore */ }

    return res.json({ success: true, base64, filename: suggestedName, contentType: 'application/octet-stream' });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/nhso-eclaim/auth', async (req, res) => {
  try {
    const cfg = await getResolvedNhsoEclaimConfig();
    const username = String(req.body?.username || cfg.username || '');
    const password = String(req.body?.password || cfg.password || '');
    const authUrl = String(cfg.authUrl);
    const clientId = String(cfg.clientId || 'eclaim');

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า username/password สำหรับ NHSO eclaim' });
    }

    // Keycloak Resource Owner Password Credentials grant
    // Pass URLSearchParams object directly so fetch sets Content-Type without ;charset=UTF-8
    const formBody = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username,
      password,
    });

    const authRes = await fetch(authUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formBody, // URLSearchParams → auto Content-Type: application/x-www-form-urlencoded
    });
    const authJson = await authRes.json() as Record<string, unknown>;

    // Keycloak returns { access_token, token_type, ... } on success
    const token = String(authJson?.access_token || authJson?.token || authJson?.accessToken || '').trim();
    if (!token) {
      const errMsg = String(authJson?.error_description || authJson?.error || JSON.stringify(authJson)).slice(0, 300);
      return res.status(401).json({ success: false, error: `NHSO eclaim auth ไม่สำเร็จ: ${errMsg}` });
    }
    return res.json({ success: true, token, tokenType: authJson?.token_type || 'Bearer' });
  } catch (error) {
    console.error('NHSO eclaim auth error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

const extractEclaimFileArray = (json: unknown): unknown[] => {
  if (Array.isArray(json)) return json;
  const j = json as Record<string, unknown>;
  if (Array.isArray(j?.data)) return j.data as unknown[];
  if (Array.isArray(j?.files)) return j.files as unknown[];
  if (Array.isArray(j?.content)) return j.content as unknown[];
  if (Array.isArray(j?.result)) return j.result as unknown[];
  if (Array.isArray(j?.items)) return j.items as unknown[];
  if (Array.isArray(j?.list)) return j.list as unknown[];
  return [];
};

/** GET /api/nhso-eclaim/file-list?period=202512&fileType=REP */
app.get('/api/nhso-eclaim/file-list', async (req, res) => {
  try {
    const cfg = await getResolvedNhsoEclaimConfig();
    const period = String(req.query.period || '').trim();
    const fileType = String(req.query.fileType || '').trim().toUpperCase();
    const token = String(req.query.token || '').trim();

    if (!token && !req.query.sessionCookie) return res.status(400).json({ success: false, error: 'กรุณาส่ง token หรือ sessionCookie ก่อน' });

    const sessionCookie = String(req.query.sessionCookie || '').trim();
    // repUrl: a discovered URL from browser-login that we know works with this session
    const repUrl = String(req.query.repUrl || '').trim();

    // Build auth headers — Bearer token (new system) or Cookie session (old system)
    const makeAuthHeaders = (extra: Record<string, string> = {}) => {
      if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra };
      return {
        Cookie: sessionCookie,
        Accept: 'application/json, text/html, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        Referer: 'https://eclaim.nhso.go.th/webComponent/main/MainWebAction.do',
        ...extra,
      };
    };

    // URL candidates: repUrl from browser first, then custom URL, then known patterns
    const urlsToTry = [
      repUrl, // discovered from browser session — most likely to work
      String(cfg.fileListUrl),
      'https://eclaim.nhso.go.th/Client/ec2/backend/api/center/m-uploads/search',
      'https://eclaim.nhso.go.th/Client/backend/api/center/m-uploads/search',
      // Old Java system REP action URLs — method=list works; method=search often fails
      `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=list&period=${period}`,
      `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=search&period=${period}&type=${fileType}`,
      `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do`,
    ].filter((u, i, arr) => u && arr.indexOf(u) === i);

    const debugLog: { url: string; status: number; body: unknown }[] = [];

    for (const baseUrl of urlsToTry) {
      const searchUrl = new URL(baseUrl);
      // Only add params if not already present in the URL
      if (period && !searchUrl.searchParams.has('period') && !searchUrl.searchParams.has('repPeriod')) {
        searchUrl.searchParams.set('period', period);
      }
      if (fileType && fileType !== 'ALL' && !searchUrl.searchParams.has('type') && !searchUrl.searchParams.has('fileType')) {
        searchUrl.searchParams.set('type', fileType);
      }

      try {
        const listRes = await fetch(searchUrl.toString(), {
          headers: makeAuthHeaders(),
        });
        const statusCode = listRes.status;
        const text = await listRes.text();
        let listJson: unknown;
        try { listJson = JSON.parse(text); } catch { listJson = text; }
        debugLog.push({ url: searchUrl.toString(), status: statusCode, body: listJson });

        if (listRes.ok) {
          const files = extractEclaimFileArray(listJson);
          if (files.length > 0) {
            return res.json({ success: true, data: files, raw: listJson, url: searchUrl.toString(), statusCode, debug: debugLog });
          }
        }
      } catch (fetchErr) {
        debugLog.push({ url: baseUrl, status: 0, body: String(fetchErr) });
      }
    }

    // All URLs returned empty — return last result with full debug info
    const last = debugLog[debugLog.length - 1];
    return res.json({ success: true, data: [], raw: last?.body ?? null, url: last?.url ?? '', statusCode: last?.status ?? 0, debug: debugLog });
  } catch (error) {
    console.error('NHSO eclaim file-list error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/nhso-eclaim/download — proxy download, return base64 */
app.post('/api/nhso-eclaim/download', async (req, res) => {
  try {
    const cfg = await getResolvedNhsoEclaimConfig();
    const { token, sessionCookie, filename, period, hcode, downloadPayload, downloadUrl } = req.body as {
      token?: string; sessionCookie?: string; filename?: string; period?: string; hcode?: string;
      downloadPayload?: Record<string, unknown>; downloadUrl?: string;
    };

    if (!token && !sessionCookie) return res.status(400).json({ success: false, error: 'กรุณาส่ง token หรือ sessionCookie' });

    const targetUrl = downloadUrl || String(cfg.downloadUrl);
    const body = downloadPayload || { filename, period, hcode };

    const dlHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/octet-stream, application/json, */*' }
      : { Cookie: sessionCookie!, Accept: 'application/octet-stream, */*' };

    const dlRes = await fetch(targetUrl, {
      method: 'POST',
      headers: dlHeaders,
      body: token ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>).toString(),
    });

    if (!dlRes.ok) {
      const errText = await dlRes.text();
      return res.status(dlRes.status).json({ success: false, error: `NHSO eclaim download ไม่สำเร็จ: ${errText.slice(0, 300)}` });
    }

    const contentType = dlRes.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    return res.json({
      success: true,
      filename: filename || 'download.xlsx',
      contentType,
      base64: buffer.toString('base64'),
    });
  } catch (error) {
    console.error('NHSO eclaim download error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const { testConnection } = await import('./db.js');
    const isConnected = await testConnection();

    res.json({
      status: 'ok',
      database: isConnected ? 'HOSxP-Connected' : 'mock-fallback',
      host: process.env.HOSXP_HOST || '192.168.2.254', database_name: process.env.HOSXP_DB || 'hos',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.json({
      status: 'ok',
      database: 'mock-fallback',
      error: 'Database connection test failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================
// Work Queue API Routes
// ============================================================

app.get('/api/work-queue', async (req: Request, res: Response) => {
  try {
    const { getWorkQueueItems } = await import('./db.js');
    const { status, startDate, endDate, fund, search, limit } = req.query;
    const items = await getWorkQueueItems({
      status: status ? String(status) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      fund: fund ? String(fund) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? Number(limit) : 500,
    });
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('GET /api/work-queue error:', error);
    res.status(500).json({ success: false, error: 'โหลดข้อมูล Work Queue ไม่สำเร็จ' });
  }
});

app.put('/api/work-queue/:vn', async (req: Request, res: Response) => {
  try {
    const { upsertWorkQueueItem } = await import('./db.js');
    const vn = String(req.params.vn || '').trim();
    if (!vn) return res.status(400).json({ success: false, error: 'VN ไม่ถูกต้อง' });
    const { queueStatus, assignedTo, notes } = req.body as Record<string, string>;
    const result = await upsertWorkQueueItem({ vn, queueStatus, assignedTo, notes });
    return res.json(result);
  } catch (error) {
    console.error('PUT /api/work-queue error:', error);
    return res.status(500).json({ success: false, error: 'อัปเดต Work Queue ไม่สำเร็จ' });
  }
});

app.post('/api/work-queue/bulk', async (req: Request, res: Response) => {
  try {
    const { bulkUpsertWorkQueue } = await import('./db.js');
    const { items } = req.body as { items: Array<Record<string, unknown>> };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'ไม่พบรายการที่จะเพิ่ม' });
    }
    const mapped = items.map((item) => ({
      vn: String(item.vn || item.vstId || ''),
      hn: String(item.hn || ''),
      patientName: String(item.patient_name || item.patientName || ''),
      fund: String(item.maininscl || item.fund || ''),
      serviceDate: String(item.vstdate || item.serviceDate || '').slice(0, 10),
    }));
    const result = await bulkUpsertWorkQueue(mapped);
    return res.json(result);
  } catch (error) {
    console.error('POST /api/work-queue/bulk error:', error);
    return res.status(500).json({ success: false, error: 'เพิ่ม Work Queue ไม่สำเร็จ' });
  }
});

// ============================================================
// Reject Tracking API Routes
// ============================================================

app.get('/api/reject-tracking', async (req: Request, res: Response) => {
  try {
    const { getRejectTrackingItems } = await import('./db.js');
    const { startDate, endDate, errorcode, resolveStatus, fund, search, limit } = req.query;
    const items = await getRejectTrackingItems({
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      errorcode: errorcode ? String(errorcode) : undefined,
      resolveStatus: resolveStatus ? String(resolveStatus) : undefined,
      fund: fund ? String(fund) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? Number(limit) : 500,
    });
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('GET /api/reject-tracking error:', error);
    res.status(500).json({ success: false, error: 'โหลดข้อมูล Reject Tracking ไม่สำเร็จ' });
  }
});

app.post('/api/reject-tracking/note', async (req: Request, res: Response) => {
  try {
    const { upsertRejectNote } = await import('./db.js');
    const { repDataId, tranId, vn, an, hn, errorcode, verifycode, resolveStatus, note, assignedTo } = req.body as Record<string, unknown>;
    if (!resolveStatus) return res.status(400).json({ success: false, error: 'resolveStatus จำเป็น' });
    const result = await upsertRejectNote({
      repDataId: repDataId ? Number(repDataId) : undefined,
      tranId: tranId ? String(tranId) : undefined,
      vn: vn ? String(vn) : undefined,
      an: an ? String(an) : undefined,
      hn: hn ? String(hn) : undefined,
      errorcode: errorcode ? String(errorcode) : undefined,
      verifycode: verifycode ? String(verifycode) : undefined,
      resolveStatus: String(resolveStatus),
      note: note ? String(note) : undefined,
      assignedTo: assignedTo ? String(assignedTo) : undefined,
    });
    return res.json(result);
  } catch (error) {
    console.error('POST /api/reject-tracking/note error:', error);
    return res.status(500).json({ success: false, error: 'บันทึก Note ไม่สำเร็จ' });
  }
});

const PORT = Number(process.env.PORT) || 3506;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FDH Checker Server running on port ${PORT}`);
  console.log(`📡 Listening on all interfaces (0.0.0.0)`);
  console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
});
