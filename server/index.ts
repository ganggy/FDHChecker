// Backend API Server สำหรับเชื่อมต่อ HOSxP
// ใช้ Node.js + Express

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { getVisitsCached } from './cacheManager.js';
import {
  getCheckData,
  testDatabaseConnection,
  getExportData,
  getReceiptItems,
  getDrugPrices,
  getPatientData,
  getVisitChargeItems,
  getServiceADPCodes,
  getKidneyMonitorDetailed,
  getFsMonitor,
  getUTFConnection,
  getAppSetting,
  setAppSetting,
  setAppSettingsBundle,
  ensureAuthTables,
  getAuthUserByToken,
  getMemberAdminData,
  loginAppUser,
  logoutAppUser,
  changeAppUserPassword,
  registerAppUser,
  saveMemberGroup,
  updateMemberUser,
  saveFdhStatusImportLog,
  saveFdhSubmissionLog,
  getFdhSubmissionLogs,
  getFdhStatusImportLogs,
  ensureRepstmTables,
  importRepstmRows,
  importFdhClaimDetailRows,
  getFdhClaimDetailBatches,
  getFdhClaimDetailSummary,
  getFdhClaimDetailRows,
  getRepstmImportBatches,
  getRepstmImportBatchDetail,
  searchRepstmManagedBatches,
  deleteRepstmManagedBatch,
  preflightRepstmImportFiles,
  getRepstmImportedRows,
  getRepDataRows,
  getStatementVisitRows,
  getReceivableCandidates,
  getReceivableBatches,
  getReceivableFilterOptions,
  getMophDmhtCandidates,
  getMophVaccineCandidates,
  getMophClaimDashboardSummary,
  getInsuranceOverview,
  getValeImportStatus,
  getVisitRepStmComparison,
  getUcOutsideCupDashboard,
  getUuc1RepStmTracking,
  getRepDailyClaimSummary,
  getRepDailyVisitsForDate,
  getRepDailyVisitDetail,
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
import { getPpfsNhsoReport } from './ppfsReport.js';
import { fetchWithTimeout } from './httpClient.js';
import { evaluateOpdPreAudit, formatOpdPreAuditIssue } from './opdPreAuditRules.js';
import {
  anonymousApiWriteGuard,
  apiErrorHandler,
  apiNotFoundHandler,
  dateRangeGuard,
  jsonBodyParserMiddleware,
  requestTracingMiddleware,
} from './requestSafety.js';
import { claimTrackingRouter } from './routes/claimTrackingRoutes.js';
import { buildRevenueOpportunityMonitor } from './revenueOpportunityMonitor.js';
import { validateApVaccineEligibility } from './mophVaccineRules.js';
import {
  buildFdhFiles,
  normalizeFdhProfile,
  projectFdhData,
  selectFdhUploadFiles,
  uploadFdhFiles,
  validateFdhData,
} from './fdhExport.js';
import { analyzeRepstmArchive } from './repstmArchive.js';
import {
  normalizeRepstmSearchFilters,
  validateRepstmBatchDeletion,
} from './repstmManagement.js';
import {
  getLineIdCommandReply,
  getLineWebhookTarget,
  parseLineWebhookPayload,
  pushLineMessages,
  replyLineMessages,
  verifyLineWebhookSignature,
} from './lineMessaging.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.disable('x-powered-by');
if (String(process.env.TRUST_PROXY || '') === '1') app.set('trust proxy', 1);

const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const developmentCorsOrigins = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
  ? []
  : ['http://localhost:3507', 'http://127.0.0.1:3507'];
const allowedCorsOrigins = new Set([...configuredCorsOrigins, ...developmentCorsOrigins]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(requestTracingMiddleware);

type LastLineWebhookTarget = {
  targetId: string;
  sourceType: 'user' | 'group' | 'room';
  receivedAt: string;
};

let lastLineWebhookTarget: LastLineWebhookTarget | null = null;

// LINE signatures must be checked against the exact, unparsed request bytes.
// Keep this route before the global JSON parser and outside /api authentication.
app.post('/webhooks/line', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const channelSecret = String(process.env.LINE_CHANNEL_SECRET || '').trim();
  if (!channelSecret) {
    return res.status(503).json({ success: false, error: 'LINE webhook is not configured' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = String(req.headers['x-line-signature'] || '');
  if (!verifyLineWebhookSignature(rawBody, signature, channelSecret)) {
    return res.status(401).json({ success: false, error: 'Invalid LINE webhook signature' });
  }

  try {
    const payload = parseLineWebhookPayload(rawBody);
    for (const event of payload.events || []) {
      const target = getLineWebhookTarget(event.source);
      if (target) {
        lastLineWebhookTarget = { ...target, receivedAt: new Date().toISOString() };
      }
      const idCommand = getLineIdCommandReply(event);
      if (idCommand && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        void replyLineMessages(idCommand.replyToken, [{
          type: 'text',
          text: `FDH Target ID: ${idCommand.target.targetId}\nตั้งค่านี้เป็น LINE_TARGET_ID บนเซิร์ฟเวอร์`,
        }]).catch((error) => console.error('LINE command reply failed:', (error as Error).message));
      }
    }
    return res.status(200).json({ success: true });
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid LINE webhook payload' });
  }
});

// Separate LINE bot used by the daily operational overview report.
app.post('/webhooks/line-overview', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const channelSecret = String(process.env.LINE_OVERVIEW_CHANNEL_SECRET || '').trim();
  const accessToken = String(process.env.LINE_OVERVIEW_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!channelSecret) {
    return res.status(503).json({ success: false, error: 'LINE overview webhook is not configured' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = String(req.headers['x-line-signature'] || '');
  if (!verifyLineWebhookSignature(rawBody, signature, channelSecret)) {
    return res.status(401).json({ success: false, error: 'Invalid LINE overview webhook signature' });
  }
  try {
    const payload = parseLineWebhookPayload(rawBody);
    for (const event of payload.events || []) {
      const idCommand = getLineIdCommandReply(event);
      if (idCommand && accessToken) {
        void replyLineMessages(idCommand.replyToken, [{
          type: 'text',
          text: `Daily Overview Target ID: ${idCommand.target.targetId}\nตั้งค่านี้เป็น LINE_OVERVIEW_TARGET_ID บนเซิร์ฟเวอร์`,
        }], accessToken).catch((error) => console.error('LINE overview command reply failed:', (error as Error).message));
      }
    }
    return res.status(200).json({ success: true });
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid LINE overview webhook payload' });
  }
});

// Reject anonymous write payloads before parsing them. Full token validation still happens below.
app.use('/api', anonymousApiWriteGuard);
app.use(jsonBodyParserMiddleware);

type AuthenticatedRequest = Request & {
  authUser?: Awaited<ReturnType<typeof getAuthUserByToken>>;
  authToken?: string;
};

const extractBearerToken = (req: Request) => {
  const header = String(req.headers.authorization || '').trim();
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return '';
};

const publicUserPayload = (user: NonNullable<Awaited<ReturnType<typeof getAuthUserByToken>>>) => ({
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  group_id: user.group_id,
  group_key: user.group_key,
  group_name: user.group_name,
  approved: Boolean(user.approved),
  is_active: Boolean(user.is_active),
  is_admin: Boolean(user.is_admin || user.group_is_admin),
  menu_permissions: user.menu_permissions,
  last_login_at: user.last_login_at,
});

const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    const user = await getAuthUserByToken(token);
    if (!user || !user.approved || !user.is_active) {
      return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
    }
    req.authToken = token;
    req.authUser = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Cannot verify session' });
  }
};

const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const verifyAdmin = () => {
    const user = req.authUser;
    if (!user || !(user.is_admin || user.group_is_admin)) {
      return res.status(403).json({ success: false, error: 'ต้องเป็นผู้ดูแลระบบ' });
    }
    next();
  };
  if (req.authUser) {
    verifyAdmin();
    return;
  }
  await requireAuth(req, res, verifyAdmin);
};

type RateLimitEntry = { count: number; resetAt: number };
const createRateLimiter = (options: { windowMs: number; max: number; message: string }) => {
  const entries = new Map<string, RateLimitEntry>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = String(req.ip || req.socket.remoteAddress || 'unknown');
    const current = entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;
    entry.count += 1;
    entries.set(key, entry);
    if (entries.size > 5000) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= now) entries.delete(entryKey);
      }
    }
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: options.message });
    }
    next();
  };
};

const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณารอ 15 นาที',
});
const registerRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'สมัครสมาชิกหลายครั้งเกินไป กรุณารอ 1 ชั่วโมง',
});

const CONFIG_SETTING_KEY = 'business_rules';
const APP_SETTINGS_KEY = 'site_settings';
const FDH_API_SETTINGS_KEY = 'fdh_api_settings';
const SYSTEM_SETTINGS_META_KEY = 'system_settings_meta';
const NHSO_AUTHEN_SETTINGS_KEY = 'nhso_authen_settings';
const NHSO_CLOSE_SETTINGS_KEY = 'nhso_close_settings';
const NHSO_ECLAIM_SETTINGS_KEY = 'nhso_eclaim_settings';
const MOPH_CLAIM_SETTINGS_KEY = 'moph_claim_settings';
const MOPH_DMHT_ACTION_LIMIT = 20000;

ensureAuthTables().catch((error) => {
  console.error('Cannot prepare member auth tables:', error);
});

// Global Playwright browser session for NHSO eclaim — kept alive between requests so
// the JSESSIONID session cookie is never sent via server-side fetch (IP-binding workaround).
type EclaimBrowserSession = {
  browser: import('playwright').Browser;
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
  ready: boolean;
  phase: 'opening' | 'waiting_thaid' | 'ready' | 'expired' | 'error';
  message: string;
  lastError?: string;
  repPageUrl: string;
  createdAt: number;
};
let eclaimBrowserSession: EclaimBrowserSession | null = null;

const tryOpenThaIdLogin = async (page: import('playwright').Page) => {
  const patterns = [/ThaID/i, /Thai\s*ID/i, /ดิจิทัลไอดี/i, /เข้าสู่ระบบ.*ไทยดี/i];
  for (const frame of page.frames()) {
    for (const pattern of patterns) {
      const candidates = [
        frame.getByRole('button', { name: pattern }),
        frame.getByRole('link', { name: pattern }),
        frame.getByText(pattern, { exact: false }),
      ];
      for (const candidate of candidates) {
        try {
          if (await candidate.first().isVisible({ timeout: 500 })) {
            await candidate.first().click({ timeout: 3000 });
            await page.waitForTimeout(1200);
            return true;
          }
        } catch { /* try another selector */ }
      }
    }
  }
  return false;
};

const monitorEclaimThaIdLogin = async (session: EclaimBrowserSession) => {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline && eclaimBrowserSession === session) {
    try {
      await session.page.waitForTimeout(1200);
      const cookies = await session.context.cookies();
      const hasSession = cookies.some((cookie) => cookie.name.toUpperCase() === 'JSESSIONID');
      const currentUrl = session.page.url();
      const isEclaimPage = currentUrl.includes('eclaim.nhso.go.th');
      const isLoginPage = currentUrl.includes('iam.nhso.go.th')
        || currentUrl.includes('LoginAction.do?code=')
        || await session.page.locator('input[type="password"], input[name="username"]').count().catch(() => 0) > 0;

      if (hasSession && isEclaimPage && !isLoginPage) {
        session.ready = true;
        session.phase = 'ready';
        session.message = 'ยืนยัน ThaID สำเร็จ พร้อมค้นหาและดาวน์โหลดไฟล์';
        session.repPageUrl = currentUrl;
        return;
      }

      session.phase = 'waiting_thaid';
      session.message = 'สแกน QR และยืนยันตัวตนในแอป ThaID';
    } catch (error) {
      session.ready = false;
      session.phase = 'error';
      session.lastError = (error as Error).message;
      session.message = 'Browser สำหรับ ThaID หยุดทำงาน';
      return;
    }
  }
  if (eclaimBrowserSession === session && !session.ready) {
    session.phase = 'expired';
    session.message = 'QR/Session หมดเวลา กรุณาเริ่ม Login ThaID ใหม่';
  }
};

const isTruthyFlag= (value: unknown) => (
  value === true ||
  value === 1 ||
  value === '1' ||
  String(value ?? '').trim().toUpperCase() === 'Y'
);

const hasDrugpWithoutDrugItems = (record: Record<string, unknown>) => (
  isTruthyFlag(record.has_drugp) && Number(record.drug_count ?? 0) <= 0
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

const getDefaultMophClaimConfig = () => ({
  environment: 'prd',
  tokenUrl: 'https://cvp1.moph.go.th/token',
  apiBaseUrl: 'https://claim-nhso.moph.go.th',
  uatApiBaseUrl: 'https://uat-moph-nhso.inet.co.th',
  username: '',
  password: '',
  hcode: '',
});

const SECRET_PLACEHOLDER = '***';
const maskConfigSecrets = (config: Record<string, unknown>, fields: string[]) => {
  const masked = { ...config };
  fields.forEach((field) => {
    masked[field] = String(config[field] || '') ? SECRET_PLACEHOLDER : '';
  });
  return masked;
};

const preserveSecret = (incoming: unknown, current: unknown) => {
  if (incoming == null || incoming === '' || incoming === SECRET_PLACEHOLDER) return String(current || '');
  return String(incoming);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const validateNonNegativeCostTree = (value: unknown, path: string): string | null => {
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const error = validateNonNegativeCostTree(child, `${path}.${key}`);
      if (error) return error;
    }
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? null
    : `ต้นทุน ${path} ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`;
};

const validateBusinessRulesConfig = (value: unknown) => {
  if (!isPlainRecord(value)) return 'Business rules ต้องเป็น JSON object';
  if (value.costs != null && !isPlainRecord(value.costs)) return 'ข้อมูลต้นทุนไม่ถูกต้อง';
  if (isPlainRecord(value.costs)) {
    for (const [key, raw] of Object.entries(value.costs)) {
      const error = validateNonNegativeCostTree(raw, key);
      if (error) return error;
    }
  }
  return null;
};

const validateSiteSettings = (value: unknown) => {
  if (!isPlainRecord(value)) return 'Site settings ต้องเป็น JSON object';
  const hospitalCode = String(value.hospital_code || '').trim();
  if (hospitalCode && !/^\d{5}$/.test(hospitalCode)) return 'รหัสหน่วยบริการต้องเป็นตัวเลข 5 หลัก';
  return null;
};

const validateConfiguredUrl = (value: unknown, label: string, requireHttps: boolean) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} ห้ามเป็นค่าว่าง`);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} ไม่ใช่ URL ที่ถูกต้อง`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} ต้องใช้ http หรือ https เท่านั้น`);
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error(`${label} ของ Production ต้องใช้ https`);
  }
  return parsed.toString();
};

const buildFdhApiSettingsPayload = async (incoming: Record<string, unknown>) => {
  const resolvedHospitalCode = await getResolvedHospitalCode();
  const current = await getResolvedFdhApiConfig();
  const environment = incoming.environment === 'uat' ? 'uat' : 'prd';
  const merged = {
    ...getDefaultFdhApiConfig(),
    ...current,
    ...incoming,
    environment,
    password: preserveSecret(incoming.password, current.password),
    hcode: resolvedHospitalCode || String(incoming.hcode || ''),
  } as Record<string, unknown>;
  const requireHttps = environment === 'prd';
  merged.tokenUrl = validateConfiguredUrl(merged.tokenUrl, 'URL Token', requireHttps);
  merged.apiBaseUrl = validateConfiguredUrl(merged.apiBaseUrl, 'API Base URL', requireHttps);
  merged.upload16Url = validateConfiguredUrl(merged.upload16Url, 'URL ส่งข้อมูล 16 แฟ้ม', requireHttps);
  merged.preScreenUrl = validateConfiguredUrl(merged.preScreenUrl, 'URL PreScreen', requireHttps);
  merged.username = String(merged.username || '').trim().slice(0, 191);
  return merged;
};

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  try {
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    const result = await loginAppUser(username, password);
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    if (!result.user || !result.token) {
      return res.status(500).json({ success: false, error: 'Login result is incomplete' });
    }
    res.json({ success: true, token: result.token, user: publicUserPayload(result.user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Cannot login' });
  }
});

app.post('/api/auth/register', registerRateLimit, async (req, res) => {
  try {
    const result = await registerAppUser({
      username: String(req.body?.username || ''),
      password: String(req.body?.password || ''),
      displayName: String(req.body?.displayName || ''),
    });
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    res.json({ success: true, message: 'สมัครสมาชิกแล้ว กรุณารอ admin อนุมัติ' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Cannot register user' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  res.json({ success: true, user: publicUserPayload(req.authUser!) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await logoutAppUser(extractBearerToken(req));
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Cannot logout' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await changeAppUserPassword(
      Number(req.authUser?.id || 0),
      String(req.body?.currentPassword || ''),
      String(req.body?.newPassword || ''),
    );
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Cannot change password' });
  }
});

app.get('/api/admin/members', requireAdmin, async (_req, res) => {
  try {
    const data = await getMemberAdminData();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Member admin data error:', error);
    res.status(500).json({ success: false, error: 'Cannot read member data' });
  }
});

app.patch('/api/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id || 0);
    if (!userId) return res.status(400).json({ success: false, error: 'Invalid user id' });
    const user = await updateMemberUser(userId, {
      approved: typeof req.body?.approved === 'boolean' ? req.body.approved : undefined,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
      isAdmin: typeof req.body?.isAdmin === 'boolean' ? req.body.isAdmin : undefined,
      groupId: Object.prototype.hasOwnProperty.call(req.body || {}, 'groupId') ? Number(req.body.groupId || 0) || null : undefined,
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : undefined,
    });
    res.json({ success: true, user: user ? publicUserPayload(user) : null });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ success: false, error: 'Cannot update member' });
  }
});

app.post('/api/admin/groups', requireAdmin, async (req, res) => {
  try {
    const result = await saveMemberGroup({
      id: req.body?.id ? Number(req.body.id) : null,
      groupName: String(req.body?.groupName || ''),
      isAdmin: Boolean(req.body?.isAdmin),
      menuPermissions: Array.isArray(req.body?.menuPermissions) ? req.body.menuPermissions : [],
    });
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    const data = await getMemberAdminData();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Save group error:', error);
    res.status(500).json({ success: false, error: 'Cannot save group' });
  }
});

app.get('/api/admin/line/status', requireAdmin, (_req, res) => {
  const targetId = String(process.env.LINE_TARGET_ID || '').trim();
  res.json({
    success: true,
    data: {
      channelId: String(process.env.LINE_CHANNEL_ID || '').trim(),
      channelSecretConfigured: Boolean(String(process.env.LINE_CHANNEL_SECRET || '').trim()),
      channelAccessTokenConfigured: Boolean(String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()),
      targetId: targetId || null,
      lastWebhookTarget: lastLineWebhookTarget,
      webhookPath: '/webhooks/line',
    },
  });
});

app.post('/api/admin/line/test', requireAdmin, async (req, res) => {
  try {
    const targetId = String(req.body?.targetId || process.env.LINE_TARGET_ID || '').trim();
    if (!targetId) {
      return res.status(400).json({ success: false, error: 'ยังไม่ได้ตั้งค่า LINE_TARGET_ID' });
    }
    await pushLineMessages(targetId, [{
      type: 'text',
      text: String(req.body?.message || 'ทดสอบการเชื่อมต่อ FDH Checker กับ LINE สำเร็จ').slice(0, 5000),
    }]);
    return res.json({ success: true, message: 'ส่งข้อความทดสอบไป LINE แล้ว' });
  } catch (error) {
    console.error('LINE test message failed:', (error as Error).message);
    return res.status(502).json({ success: false, error: (error as Error).message });
  }
});

// All API routes declared below this point require an approved, active user.
// Health remains public for PM2/reverse-proxy readiness checks and contains no infrastructure details.
app.use('/api', (req: AuthenticatedRequest, res, next) => {
  if (req.path === '/health') return next();
  return void requireAuth(req, res, next);
});

// Configuration may be read by authenticated workflow pages, but only admins may change it.
app.use('/api/config', (req: AuthenticatedRequest, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return void requireAdmin(req, res, next);
});

type ApiPageRule = { pattern: RegExp; pages?: string[]; adminOnly?: boolean };
const apiPageRules: ApiPageRule[] = [
  { pattern: /^\/(test|debug)(\/|$)/, adminOnly: true },
  { pattern: /^\/settings\/fdh-api\/test-connection$/, pages: ['settings'] },
  { pattern: /^\/config\/system-settings(\/|$)/, pages: ['settings'] },
  { pattern: /^\/config\/business-rules(\/|$)/, pages: ['settings'] },
  { pattern: /^\/config\/fdh-api-settings(\/|$)/, pages: ['settings', 'fdhImport'] },
  { pattern: /^\/config\/nhso-authen-settings(\/|$)/, pages: ['settings', 'authenSync'] },
  { pattern: /^\/config\/nhso-close-settings(\/|$)/, pages: ['settings', 'nhsoClose'] },
  { pattern: /^\/config\/nhso-eclaim-settings(\/|$)/, pages: ['settings', 'repstm'] },
  { pattern: /^\/nhso\/authen(\/|$)/, pages: ['authenSync'] },
  { pattern: /^\/nhso\/close(\/|$)/, pages: ['nhsoClose'] },
  { pattern: /^\/nhso-eclaim(\/|$)/, pages: ['repstm'] },
  { pattern: /^\/uc-outside-cup(\/|$)/, pages: ['ucOutsideCup'] },
  { pattern: /^\/reconciliation(\/|$)/, pages: ['reconciliation', 'ucOutsideCup'] },
  { pattern: /^\/receivable(\/|$)/, pages: ['receivable', 'ucOutsideCup'] },
  { pattern: /^\/repstm(\/|$)/, pages: ['repstm', 'repstmManage', 'reconciliation', 'repDeny', 'ucOutsideCup', 'repDailySummary', 'uuc1Tracking'] },
  { pattern: /^\/rep-(daily|deny)(\/|$)/, pages: ['repDailySummary', 'repDeny'] },
  { pattern: /^\/uuc1(\/|$)/, pages: ['uuc1Tracking'] },
  { pattern: /^\/ppfs(\/|$)/, pages: ['ppfsBenchmark', 'ppfsVisitMatch'] },
  { pattern: /^\/work-queue(\/|$)/, pages: ['workQueue'] },
  { pattern: /^\/reject-tracking(\/|$)/, pages: ['rejectTracking'] },
  { pattern: /^\/moph\/dmht(\/|$)/, pages: ['mophDmht'] },
  { pattern: /^\/moph\/vaccine(\/|$)/, pages: ['mophVaccine'] },
  { pattern: /^\/insurance(\/|$)/, pages: ['insuranceOverview', 'receivable'] },
  { pattern: /^\/fdh\/claim-detail(\/|$)/, pages: ['fdhClaimDetail', 'reconciliation', 'ucOutsideCup'] },
  { pattern: /^\/fdh\/import-status(\/|$)/, pages: ['fdhImport', 'fdh', 'reconciliation', 'ucOutsideCup'] },
  { pattern: /^\/fdh(\/|$)/, pages: ['fdh', 'fundFdh', 'fdhImport', 'staff', 'ipd'] },
  { pattern: /^\/hosxp\/ipd(\/|$)/, pages: ['ipd', 'ipdClaimMonitor'] },
  { pattern: /^\/hosxp(\/|$)/, pages: ['staff', 'fdh', 'specific', 'fundFdh', 'fund43', 'fundKtb', 'fundOther', 'monitor', 'fsMonitor', 'ipd', 'ipdClaimMonitor', 'ucOutsideCup'] },
];

app.use('/api', (req: AuthenticatedRequest, res, next) => {
  if (req.path === '/health') return next();
  const user = req.authUser;
  if (!user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
  if (user.is_admin || user.group_is_admin) return next();
  const rule = apiPageRules.find((item) => item.pattern.test(req.path));
  if (!rule) return next();
  if (rule.adminOnly) return res.status(403).json({ success: false, error: 'ต้องเป็นผู้ดูแลระบบ' });
  const permissions = new Set(Array.isArray(user.menu_permissions) ? user.menu_permissions.map(String) : []);
  if (rule.pages?.some((page) => permissions.has(page))) return next();
  return res.status(403).json({ success: false, error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้' });
});

// Protect HOSxP from accidental multi-year scans while retaining fiscal-year reports elsewhere.
app.use('/api', dateRangeGuard);

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

const getResolvedMophClaimConfig = async (overrides?: Record<string, unknown>) => {
  const savedConfig = await getAppSetting<Record<string, unknown>>(MOPH_CLAIM_SETTINGS_KEY);
  const resolvedHospitalCode = await getResolvedHospitalCode();
  const config = {
    ...getDefaultMophClaimConfig(),
    ...(savedConfig || {}),
    ...(overrides || {}),
  } as Record<string, unknown>;

  if (!String(config.hcode || '').trim()) {
    config.hcode = resolvedHospitalCode;
  }

  if (!String(config.username || '').trim() || !String(config.password || '').trim()) {
    try {
      const connection = await getUTFConnection();
      try {
        const [rows] = await connection.query(
          `SELECT sys_name, sys_value
           FROM sys_var
           WHERE sys_name IN ('MOPH_Claim_User', 'MOPH_Claim_Password')`
        );
        for (const row of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
          if (row.sys_name === 'MOPH_Claim_User' && !String(config.username || '').trim()) {
            config.username = String(row.sys_value || '').trim();
          }
          if (row.sys_name === 'MOPH_Claim_Password' && !String(config.password || '').trim()) {
            config.password = String(row.sys_value || '').trim();
          }
        }
      } finally {
        connection.release();
      }
    } catch {
      // sys_var may not exist on some installs. The UI can still pass settings later.
    }
  }

  return config;
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
  ]));
};

type FdhConnectionTestResult = {
  token: string;
  responseTimeMs: number;
};

const requestFdhAccessTokenForConnectionTest = async (
  config: Record<string, unknown>,
): Promise<FdhConnectionTestResult> => {
  const tokenUrl = String(config.tokenUrl || '').trim();
  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  const hospitalCode = String(config.hcode || '').trim();

  if (!tokenUrl) throw new Error('ยังไม่ได้บันทึก URL Token ของ FDH');
  if (!username || !password) throw new Error('ยังไม่ได้บันทึก username/password สำหรับ FDH API');
  if (!hospitalCode) throw new Error('ยังไม่ได้บันทึกรหัสหน่วยบริการ (HCODE)');

  const tokenEndpoint = getFdhTokenEndpoint(tokenUrl);
  const startedAt = Date.now();
  let reachedFdh = false;
  let rejectedCredentials = false;
  let serviceUnavailable = false;
  let timedOut = false;

  for (const passwordHash of getPasswordHashCandidates(password)) {
    const query = new URLSearchParams({
      Action: 'get_moph_access_token',
      user: username,
      password_hash: passwordHash,
      hospital_code: hospitalCode,
    }).toString();

    try {
      const response = await fetchWithTimeout(`${tokenEndpoint}?${query}`, { method: 'POST' }, 30_000);
      reachedFdh = true;
      if (response.status === 401 || response.status === 403) rejectedCredentials = true;
      if (response.status >= 500) serviceUnavailable = true;

      const rawText = await response.text();
      let parsedPayload: unknown = {};
      try {
        parsedPayload = JSON.parse(rawText);
      } catch {
        parsedPayload = { raw: rawText };
      }

      const payloadRecord = isPlainRecord(parsedPayload) ? parsedPayload : {};
      const messageCode = Number(payloadRecord.MessageCode ?? payloadRecord.status ?? 0);
      if (messageCode !== 0) rejectedCredentials = true;
      const token = extractTokenFromPayload(parsedPayload)
        || (response.ok && messageCode === 0 && rawText.trim() && !rawText.trim().startsWith('{')
          ? rawText.trim()
          : null);
      if (response.ok && token) {
        return { token, responseTimeMs: Date.now() - startedAt };
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorName === 'TimeoutError' || /timeout/i.test(errorMessage)) timedOut = true;
    }
  }

  if (timedOut && !reachedFdh) {
    throw new Error('FDH API ไม่ตอบกลับภายในเวลาที่กำหนด กรุณาตรวจสอบเครือข่ายหรือทดลองใหม่');
  }
  if (rejectedCredentials) {
    throw new Error('FDH ไม่ยอมรับข้อมูลเข้าสู่ระบบ กรุณาตรวจสอบ username/password และ HCODE');
  }
  if (serviceUnavailable) {
    throw new Error('บริการ FDH API ขัดข้องชั่วคราว กรุณาทดลองใหม่ภายหลัง');
  }
  if (reachedFdh) {
    throw new Error('เชื่อมต่อถึง FDH API ได้ แต่ไม่ได้รับ access token กรุณาตรวจสอบค่าที่บันทึกไว้');
  }
  throw new Error('เชื่อมต่อ FDH API ไม่สำเร็จ กรุณาตรวจสอบ URL และเครือข่ายของเซิร์ฟเวอร์');
};

const getMophClaimToken = async (config: Record<string, unknown>) => {
  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  const hcode = String(config.hcode || '').trim();
  if (!username || !password || !hcode) {
    throw new Error('ยังไม่ได้ตั้งค่า MOPH Claim user/password/hcode');
  }

  const passwordHash = crypto
    .createHmac('sha256', '$jwt@moph#')
    .update(password, 'utf8')
    .digest('hex');
  const tokenUrl = new URL(String(config.tokenUrl || 'https://cvp1.moph.go.th/token'));
  tokenUrl.searchParams.set('Action', 'get_moph_access_token');
  tokenUrl.searchParams.set('user', username);
  tokenUrl.searchParams.set('password_hash', passwordHash);
  tokenUrl.searchParams.set('hospital_code', hcode);

  const response = await fetchWithTimeout(tokenUrl.toString(), { method: 'POST' });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MOPH token ไม่สำเร็จ: ${text.slice(0, 300)}`);
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed);
    const token = String(json.access_token || json.token || json.jwt || json.data?.token || '').trim();
    if (token) return token;
    throw new Error(String(json.message_th || json.message || 'MOPH token ไม่สำเร็จ'));
  }
  return trimmed;
};

const getMophClaimApiBaseUrl = (config: Record<string, unknown>, testZone?: boolean) => {
  const env = String(config.environment || '').toLowerCase();
  if (testZone || env === 'uat' || env === 'test') {
    return String(config.uatApiBaseUrl || 'https://uat-moph-nhso.inet.co.th').replace(/\/+$/, '');
  }
  return String(config.apiBaseUrl || 'https://claim-nhso.moph.go.th').replace(/\/+$/, '');
};

const postMophClaimJson = async (
  url: string,
  token: string,
  payload: Record<string, unknown>,
) => {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }
  return { ok: response.ok, status: response.status, json };
};

const normalizeMophRowType = (row: Record<string, unknown>) => {
  const diag = String(row.diag || '').trim().toUpperCase();
  return diag === 'HT' ? 'ht' : 'dm';
};

const normalizeMophVaccineType = (row: Record<string, unknown>) => {
  const type = String(row.type || '').trim().toLowerCase();
  return type === 'dt' ? 'dt' : 'epi';
};

const findInvalidApVaccineRow = (rows: Array<Record<string, unknown>>) => {
  for (const row of rows) {
    const error = validateApVaccineEligibility({
      vaccineCode: row.vaccine_code,
      serviceDate: row.service_date || row.visit_datetime,
      pregNo: row.preg_no,
      ga: row.ga,
    });
    if (error) return { row, error };
  }
  return null;
};

const sendApVaccineValidationError = (
  res: Response,
  invalid: ReturnType<typeof findInvalidApVaccineRow>,
) => {
  if (!invalid) return false;
  const vn = String(invalid.row.vn || '').trim();
  const message = invalid.error.replace(/^Error:/, '');
  res.status(400).json({
    success: false,
    error: `${vn ? `VN ${vn}: ` : ''}${message}`,
    code: 'AP_VACCINE_ELIGIBILITY_FAILED',
  });
  return true;
};

const parseMophDiagnosis = (row: Record<string, unknown>) => {
  const visitDateTime = formatMophVisitDateTime(row.visit_datetime || row.service_date);
  return String(row.diag || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([A-Z0-9.]+)(?:\(([^)]+)\))?/i);
      return {
        dx_date_time: visitDateTime,
        icd10: match?.[1] || item,
        dx_type: match?.[2] || '1',
      };
    });
};

const formatMophVisitDateTime = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace('T', ' ');
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (match) {
    return `${match[1]} ${match[2] || '00:00'}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
  return normalized.slice(0, 16);
};

const shouldPersistMophResult = (statusNo: number, message: string) => {
  const normalizedMessage = message.toLowerCase();
  return (
    statusNo === 200 ||
    normalizedMessage.includes("don't have authen_code") ||
    normalizedMessage.includes('dm patient unable to claim') ||
    normalizedMessage.includes('dm patient received service less than 3 months') ||
    normalizedMessage.includes('ht patient unable to claim') ||
    normalizedMessage.includes('vaccine patient unable to claim') ||
    normalizedMessage.includes('dt patient unable to claim') ||
    normalizedMessage.includes('patient not new ht')
  );
};

const extractTokenFromPayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;

  const directPayload = payload as Record<string, unknown>;
  const directCandidates = [
    directPayload.access_token,
    directPayload.token,
    directPayload.jwt,
    directPayload.JWT,
    directPayload.jwt_token,
    directPayload.id_token,
    directPayload.Token,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedData = directPayload.data;
  if (typeof nestedData === 'string' && nestedData.trim()) return nestedData.trim();
  if (nestedData && typeof nestedData === 'object') {
    return extractTokenFromPayload(nestedData);
  }

  return null;
};

const requestFdhAccessToken = async (config: Record<string, unknown>) => {
  const tokenEndpoint = getFdhTokenEndpoint(String(config.tokenUrl || ''));
  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  const hospitalCode = String(config.hcode || '').trim();
  if (!tokenEndpoint) throw new Error('ยังไม่ได้ตั้งค่า Token URL');
  if (!username || !password) throw new Error('ยังไม่ได้ตั้งค่า username/password สำหรับ FDH API');
  if (!/^\d{5}$/.test(hospitalCode)) throw new Error('Hospital Code (HCODE) ต้องเป็นตัวเลข 5 หลัก');

  const failures: string[] = [];
  for (const passwordHash of getPasswordHashCandidates(password)) {
    const query = new URLSearchParams({
      Action: 'get_moph_access_token',
      user: username,
      password_hash: passwordHash,
      hospital_code: hospitalCode,
    });
    try {
      const response = await fetchWithTimeout(`${tokenEndpoint}?${query}`, { method: 'POST' });
      const rawText = await response.text();
      let payload: unknown = {};
      try { payload = rawText ? JSON.parse(rawText) : {}; } catch { payload = {}; }
      const token = extractTokenFromPayload(payload)
        || (!rawText.trim().startsWith('{') && rawText.trim() ? rawText.trim() : null);
      if (response.ok && token) return token;
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      failures.push(String(record.Message || record.message || `HTTP ${response.status}`));
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  throw new Error(`ไม่สามารถขอ FDH token ได้: ${failures.filter(Boolean).join('; ').slice(0, 300)}`);
};

// Enhanced connection test on startup
testDatabaseConnection().then(result => {
  if (result.isConnected) {
    console.log('✅ HOSxP Database Connected Successfully');
    console.log(`📊 Tables: ${result.tableCount}, Recent records: ${result.sampleRecordCount}`);
    console.log(`🔄 Using REAL DATABASE DATA as primary source`);
  } else {
    console.error('❌ HOSxP Database Connection Failed:', result.error);
    console.error('⛔ HOSxP-dependent APIs will report service unavailable until the connection recovers');
  }
});

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

    // ตรวจสอบว่าได้ข้อมูลจริงหรือไม่
    if (Array.isArray(data) && data.length > 0) {
      console.log(`✅ SUCCESS: Got ${data.length} REAL records from HOSxP database`);
    } else {
      console.log(`⚠️ No real data available - trying database connection test...`);

      // ตรวจสอบการเชื่อมต่อฐานข้อมูล
      const dbStatus = await testDatabaseConnection();

      if (dbStatus.isConnected && dbStatus.hasData) {
        console.log('✅ Database connected with data - empty result likely due to date/fund filters');
        // ถ้าฐานข้อมูลเชื่อมต่อได้แต่ไม่มีข้อมูลในช่วงที่กรอง ให้ return array ว่าง
        data = [];
      } else {
        console.error(`❌ Database connection failed: ${dbStatus.error || 'Unknown error'}`);
        return res.status(503).json({
          success: false,
          dataSource: 'HOSxP-Database',
          totalRecords: 0,
          data: [],
          error: 'ไม่สามารถเชื่อมต่อฐานข้อมูล HOSxP ได้ กรุณาลองใหม่ภายหลัง',
        });
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
      if (hasDrugpWithoutDrugItems(rec)) {
        issues.push('ส่งยาไปรษณีย์ (DRUGP) ต้องมีรายการยา');
      }
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

      const opdPreAuditFindings = isIPD ? [] : evaluateOpdPreAudit(rec);
      issues.push(...opdPreAuditFindings.map(formatOpdPreAuditIssue));
      const opdBlockingCount = opdPreAuditFindings.filter((finding) => finding.severity === 'blocking').length;
      const opdReviewCount = opdPreAuditFindings.filter((finding) => finding.severity === 'warning').length;

      const isComplete = issues.length === 0;

      return {
        ...record,
        status: isComplete ? 'ready' : 'pending',
        isBillable,
        issues: issues,
        opd_pre_audit: isIPD ? null : {
          status: opdBlockingCount > 0 ? 'blocking' : opdReviewCount > 0 ? 'review' : 'clear',
          findingCount: opdPreAuditFindings.length,
          blockingCount: opdBlockingCount,
          reviewCount: opdReviewCount,
          findings: opdPreAuditFindings,
        },
        has_authen: hasAuthenPp ? 1 : 0,
        has_close: hasCloseEp ? 1 : 0,
        fdh_status_label: hasCloseEp
          ? 'ปิดสิทธิแล้ว (EP)'
          : hasAuthenPp
            ? 'มี Authen (PP)'
            : 'ยังไม่มีสถานะ FDH',
        _dataSource: 'HOSxP-Database'
      };
    });

    // ===== ขั้นตอนที่ 4: ส่งผลลัพธ์พร้อมข้อมูลการทำงาน =====
    const responseData = {
      success: true,
      dataSource: 'HOSxP-Database',
      totalRecords: dataWithStatus.length,
      filters: {
        fund: fund || 'ทั้งหมด',
        startDate: startDate || null,
        endDate: endDate || null
      },
      data: dataWithStatus,
      timestamp: new Date().toISOString()
    }; console.log(`✅ RESPONSE: ${dataWithStatus.length} records from HOSxP database`);
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching checks:', error);
    res.status(503).json({
      success: false,
      dataSource: 'HOSxP-Database',
      totalRecords: 0,
      data: [],
      error: 'ไม่สามารถอ่านข้อมูล HOSxP ได้ กรุณาลองใหม่ภายหลัง',
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

app.get('/api/hosxp/visit-items/:vn', async (req, res) => {
  try {
    const { vn } = req.params;
    const items = await getVisitChargeItems(vn);
    res.json(items);
  } catch (error) {
    console.error('Error fetching visit charge items:', error);
    res.status(500).json({ error: 'ไม่สามารถอ่านรายการค่าใช้จ่ายของ visit ได้' });
  }
});

// API สำหรับดึงข้อมูลค่าบริการ ADP Code
app.get('/api/hosxp/services/:vn', async (req, res) => {
  try {
    const { vn } = req.params;
    console.log(`🏥 Fetching REAL ADP services for VN: ${vn}`);

    // Always try to fetch from database first
    const services = await getServiceADPCodes(vn);

    console.log(`✅ Returning ${services.length} ADP service items`);
    res.json(services);
  } catch (error) {
    console.error('Error fetching ADP services:', error);
    res.json([]);
  }
});

// API สำหรับดึงข้อมูลผู้ป่วย
app.get('/api/hosxp/patients/:hn', async (req, res) => {
  try {
    const { hn } = req.params;
    const patient = await getPatientData(hn);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      ...patient,
    });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(503).json({ success: false, error: 'ไม่สามารถอ่านข้อมูลผู้ป่วยจาก HOSxP ได้' });
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

// มอนิเตอร์โอกาสรายได้: แยกยอดค่าบริการ ยอดเคลม และยอดรับจริง
// พร้อมชี้รายการที่ต้องตรวจเวชระเบียน โดยไม่สรุปว่า "ยอดต่ำ = ลงข้อมูลผิด"
app.get('/api/hosxp/revenue-opportunity-monitor', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ startDate และ endDate รูปแบบ YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด' });
    }
    const { getRevenueOpportunitySourceRows, getSpecificFundData } = await import('./db.js');
    const [palliativeRows, instrumentRows, focusedRows] = await Promise.all([
      getSpecificFundData('palliative', startDate, endDate),
      getSpecificFundData('instrument', startDate, endDate),
      getRevenueOpportunitySourceRows(startDate, endDate),
    ]);
    const data = buildRevenueOpportunityMonitor({
      startDate,
      endDate,
      palliativeRows,
      instrumentRows,
      opdRows: focusedRows.opdRows,
      ipdRows: focusedRows.ipdRows,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error building revenue opportunity monitor:', error);
    res.status(500).json({ success: false, error: 'ไม่สามารถวิเคราะห์โอกาสรายได้จากฐานข้อมูลได้' });
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

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`⚠️ No eligible visits found for the given criteria.`);
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
      if (hasDrugpWithoutDrugItems(item)) issues.push('ER214: ส่งยาไปรษณีย์ (DRUGP) ต้องมีรายการยา');

      // OPD medical-record and charge evidence layer. These codes are kept
      // separate from ER1xx/ER2xx so 16-file structure and clinical audit are
      // visible independently on the pre-submit screen.
      const opdAuditIssues = evaluateOpdPreAudit(item);
      issues.push(...opdAuditIssues.map(formatOpdPreAuditIssue));

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
        if (criticalErrors.length > 0 || opdAuditIssues.length > 0) {
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
        if (status === 'ready') status = 'pending';
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
        _dataSource: 'HOSxP-Database'
      };
    });

    res.json({
      success: true,
      dataSource: 'HOSxP-Database',
      totalRecords: enrichedData.length,
      data: enrichedData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching eligible visits:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});


const MAX_FDH_VISITS_PER_REQUEST = 1_000;
const MAX_FDH_UPLOAD_BYTES = 50 * 1024 * 1024;

const normalizeFdhExportRequest = (body: Record<string, unknown>) => {
  const rawVns = Array.isArray(body.vns) ? body.vns : [];
  const vns = Array.from(new Set(rawVns.map((item) => String(item || '').trim()).filter(Boolean)));
  if (!vns.length) throw new Error('กรุณาระบุรายการที่ต้องการส่งออก');
  if (vns.length > MAX_FDH_VISITS_PER_REQUEST) throw new Error(`ส่งได้ครั้งละไม่เกิน ${MAX_FDH_VISITS_PER_REQUEST.toLocaleString('th-TH')} visits`);
  if (vns.some((vn) => !/^[A-Za-z0-9._/-]{1,25}$/.test(vn))) throw new Error('พบ VN ที่มีรูปแบบไม่ถูกต้อง');
  const stringMap = (input: unknown, maxLength: number) => Object.fromEntries(
    Object.entries(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {})
      .slice(0, MAX_FDH_VISITS_PER_REQUEST)
      .map(([key, value]) => [String(key).slice(0, 25), String(value || '').trim().slice(0, maxLength)]),
  );
  const rawProfile = String(body.profile || 'standard').trim().toLowerCase();
  if (!['standard', 'fwf-migrants'].includes(rawProfile)) throw new Error('profile ต้องเป็น standard หรือ fwf-migrants');
  return {
    vns,
    profile: normalizeFdhProfile(rawProfile),
    fcodeByHn: stringMap(body.fcodeByHn, 16),
    uucByVn: stringMap(body.uucByVn, 1),
  };
};

const prepareFdhExport = async (body: Record<string, unknown>) => {
  const request = normalizeFdhExportRequest(body);
  const config = await getResolvedFdhApiConfig();
  const hcode = String(config.hcode || '').trim();
  const rawData = await getExportData(request.vns, request);
  if (!rawData) throw new Error('ไม่สามารถดึงข้อมูล 16 แฟ้มจากฐานข้อมูลได้');
  const data = projectFdhData(rawData, request.profile);
  const validation = validateFdhData(data, request.profile, hcode);
  const estimatedBytes = buildFdhFiles(data, request.profile, true, process.env.FDH_EXPORT_ENCODING)
    .reduce((sum, file) => sum + file.content.length, 0);
  if (estimatedBytes > MAX_FDH_UPLOAD_BYTES) {
    validation.errors.push({
      severity: 'error',
      code: 'MAX_UPLOAD_SIZE',
      message: `ข้อมูลรวม ${(estimatedBytes / 1024 / 1024).toFixed(2)} MB เกินขนาดสูงสุด 50 MB`,
    });
    validation.valid = false;
  }
  return { ...request, config, hcode, data, validation };
};

const fdhPayloadSucceeded = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return true;
  const record = payload as Record<string, unknown>;
  if (record.success === false) return false;
  const rawStatus = record.MessageCode ?? record.messageCode ?? record.statusCode ?? record.status;
  if (rawStatus == null || rawStatus === '') return true;
  if (typeof rawStatus === 'string' && ['success', 'ok'].includes(rawStatus.toLowerCase())) return true;
  const numeric = Number(rawStatus);
  return Number.isFinite(numeric) ? numeric === 0 || (numeric >= 200 && numeric < 300) : true;
};

// Preflight และ Preview ใช้ schema/validator เดียวกับการส่ง API จริง
app.post('/api/fdh/preflight', async (req, res) => {
  try {
    const prepared = await prepareFdhExport(req.body || {});
    res.status(prepared.validation.valid ? 200 : 422).json({
      success: prepared.validation.valid,
      profile: prepared.profile,
      validation: prepared.validation,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/fdh/view-data', async (req, res) => {
  try {
    const prepared = await prepareFdhExport(req.body || {});
    res.json({ success: true, profile: prepared.profile, data: prepared.data, validation: prepared.validation });
  } catch (error) {
    console.error('Error viewing FDH data:', error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/fdh/export-zip', async (req, res) => {
  try {
    const prepared = await prepareFdhExport(req.body || {});
    if (!prepared.validation.valid) {
      return res.status(422).json({ success: false, error: 'ข้อมูลยังไม่ผ่าน Preflight', validation: prepared.validation });
    }
    const includeHeader = req.body?.includeHeader !== false;
    const files = buildFdhFiles(prepared.data, prepared.profile, includeHeader, process.env.FDH_EXPORT_ENCODING);
    const zip = new AdmZip();
    files.forEach((file) => zip.addFile(file.filename, file.content));
    const zipBuffer = zip.toBuffer();
    const filename = `FDH_${prepared.profile}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Error exporting FDH ZIP:', error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// ส่ง multipart/form-data: type=txt และ file ซ้ำตามจำนวนแฟ้ม ไป FDH v1/v2 จริง
app.post('/api/fdh/submit', async (req, res) => {
  const batchUid = crypto.randomUUID();
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ success: false, error: 'ต้องยืนยันการส่งข้อมูลก่อน (confirm=true)' });
    }
    const prepared = await prepareFdhExport(req.body || {});
    if (!prepared.validation.valid) {
      return res.status(422).json({ success: false, error: 'ข้อมูลยังไม่ผ่าน Preflight จึงไม่ถูกส่งไป FDH', validation: prepared.validation });
    }

    const environment = String(prepared.config.environment || 'prd').toLowerCase() === 'uat' ? 'uat' : 'prd';
    const uploadUrl = validateConfiguredUrl(prepared.config.upload16Url, 'URL ส่งข้อมูล 16 แฟ้ม', true);
    const uploadHost = new URL(uploadUrl).hostname.toLowerCase();
    const allowedHosts = environment === 'prd' ? ['fdh.moph.go.th'] : ['uat-fdh.inet.co.th'];
    if (!allowedHosts.includes(uploadHost)) throw new Error(`URL ส่งข้อมูลไม่ตรงกับ environment ${environment.toUpperCase()}`);

    // คู่มือกำหนด v1 ไม่มี header และ v2 มี header
    const includeHeader = /\/api\/v1\//i.test(uploadUrl) ? false : true;
    const files = selectFdhUploadFiles(buildFdhFiles(
      prepared.data,
      prepared.profile,
      includeHeader,
      process.env.FDH_EXPORT_ENCODING,
    ));
    const totalBytes = files.reduce((sum, file) => sum + file.content.length, 0);
    if (files.length > 16) throw new Error('จำนวนแฟ้มเกิน 16 แฟ้ม');
    if (totalBytes > MAX_FDH_UPLOAD_BYTES) throw new Error('ขนาดข้อมูลรวมเกิน 50 MB');

    const token = await requestFdhAccessToken(prepared.config);
    const upstream = await uploadFdhFiles(uploadUrl, token, files);
    const success = upstream.ok && fdhPayloadSucceeded(upstream.payload);
    const requestDigest = crypto.createHash('sha256').update(JSON.stringify({
      vns: [...prepared.vns].sort(),
      profile: prepared.profile,
      counts: prepared.validation.counts,
    })).digest('hex');
    await saveFdhSubmissionLog({
      batchUid,
      profile: prepared.profile,
      hcode: prepared.hcode,
      environment,
      requestCount: prepared.vns.length,
      recordCount: prepared.validation.totalRows,
      requestDigest,
      responseStatus: upstream.status,
      success,
      responsePayload: upstream.payload,
    });
    return res.status(success ? 200 : 502).json({
      success,
      batchUid,
      profile: prepared.profile,
      submittedVisits: prepared.vns.length,
      submittedFiles: files.map((file) => ({ name: file.filename, rows: file.rowCount, bytes: file.content.length })),
      validation: prepared.validation,
      upstreamStatus: upstream.status,
      upstream: upstream.payload,
      message: success ? 'FDH รับคำขอแล้ว' : 'FDH ปฏิเสธคำขอหรือส่งผลลัพธ์ผิดพลาด',
    });
  } catch (error) {
    console.error('Error submitting data to FDH:', { batchUid, error: (error as Error).message });
    res.status(400).json({ success: false, batchUid, error: (error as Error).message });
  }
});

app.get('/api/fdh/submission-logs', async (req, res) => {
  try {
    const logs = await getFdhSubmissionLogs(Number(req.query.limit || 50));
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
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
      res.json([]);
    }
  } catch (error) {
    console.error('Error fetching funds:', error);
    res.status(503).json({ success: false, error: 'ไม่สามารถอ่านรายการกองทุนจาก HOSxP ได้' });
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

// API ตรวจความพร้อมก่อนส่งเคลม (อ้างอิง checklist จาก PDF NHSO e-Claim + IPD audit)
app.post('/api/hosxp/pre-submit-check', (req, res) => {
  try {
    const payload = (req.body || {}) as Record<string, unknown>;
    const eclaim = (payload.eclaim || {}) as Record<string, unknown>;
    const documents = (payload.documents || {}) as Record<string, unknown>;

    const toText = (value: unknown) => String(value ?? '').trim();
    const toBool = (value: unknown) => (
      value === true
      || value === 1
      || value === '1'
      || String(value ?? '').trim().toLowerCase() === 'true'
      || String(value ?? '').trim().toUpperCase() === 'Y'
    );

    const checks: Array<{
      code: string;
      category: string;
      severity: 'block' | 'warn';
      passed: boolean;
      message: string;
      expected: string;
      actual: unknown;
    }> = [];

    const addCheck = (
      code: string,
      category: string,
      severity: 'block' | 'warn',
      passed: boolean,
      message: string,
      expected: string,
      actual: unknown,
    ) => {
      checks.push({ code, category, severity, passed, message, expected, actual });
    };

    const fileType = toText(eclaim.fileType).toLowerCase();
    addCheck(
      'EC001',
      'eclaim',
      'block',
      fileType === 'txt' || fileType === 'dbf',
      'ต้องระบุ fileType ให้ถูกต้อง',
      'txt หรือ dbf',
      eclaim.fileType,
    );

    const maininscl = toText(eclaim.maininscl).toUpperCase();
    const allowedMaininscl = ['UCS', 'OFC', 'LGO', 'SSS'];
    addCheck(
      'EC002',
      'eclaim',
      'block',
      allowedMaininscl.includes(maininscl),
      'ต้องระบุ maininscl ตามสิทธิที่รองรับ',
      'UCS/OFC/LGO/SSS',
      eclaim.maininscl,
    );

    const dataTypes = Array.isArray(eclaim.dataTypes)
      ? eclaim.dataTypes.map((item) => toText(item).toUpperCase()).filter(Boolean)
      : [];
    addCheck(
      'EC003',
      'eclaim',
      'block',
      dataTypes.length > 0 && dataTypes.every((item) => item === 'IP' || item === 'OP'),
      'ต้องระบุ dataTypes อย่างน้อย 1 ค่า',
      "array ของ 'IP' หรือ 'OP'",
      eclaim.dataTypes,
    );

    addCheck(
      'EC004',
      'eclaim',
      'block',
      typeof eclaim.opRefer === 'boolean',
      'ต้องระบุ opRefer',
      'boolean',
      eclaim.opRefer,
    );

    addCheck(
      'EC005',
      'eclaim',
      'block',
      typeof eclaim.importDup === 'boolean',
      'ต้องระบุ importDup',
      'boolean',
      eclaim.importDup,
    );

    addCheck(
      'EC006',
      'eclaim',
      'block',
      typeof eclaim.assignToMe === 'boolean',
      'ต้องระบุ assignToMe',
      'boolean',
      eclaim.assignToMe,
    );

    const hasAuthToken = toBool(eclaim.hasToken) || toText(eclaim.token).length > 0;
    addCheck(
      'EC007',
      'eclaim',
      'block',
      hasAuthToken,
      'ต้องมี token สำหรับ Authorization: Bearer <token>',
      'hasToken=true หรือ token ไม่ว่าง',
      eclaim.hasToken || eclaim.token || null,
    );

    const shouldCheckIpdDocs = dataTypes.includes('IP') || toBool(payload.ipdCase);
    if (shouldCheckIpdDocs) {
      addCheck(
        'IPD001',
        'ipd_document',
        'warn',
        toBool(documents.hasDischargeSummary),
        'ควรมี Discharge Summary ก่อนส่งเคลม IPD',
        'hasDischargeSummary=true',
        documents.hasDischargeSummary,
      );

      addCheck(
        'IPD002',
        'ipd_document',
        'warn',
        toBool(documents.hasDiagnosisCoding),
        'ควรระบุรหัสวินิจฉัยตาม ICD-10',
        'hasDiagnosisCoding=true',
        documents.hasDiagnosisCoding,
      );

      addCheck(
        'IPD003',
        'ipd_document',
        'warn',
        toBool(documents.hasProcedureCoding),
        'กรณีมีหัตถการ ควรระบุรหัสตาม ICD-9-CM',
        'hasProcedureCoding=true',
        documents.hasProcedureCoding,
      );

      addCheck(
        'IPD004',
        'ipd_document',
        'warn',
        toBool(documents.hasKeyInvestigation),
        'ควรมีผล Investigation สำคัญประกอบการรักษา',
        'hasKeyInvestigation=true',
        documents.hasKeyInvestigation,
      );

      addCheck(
        'IPD005',
        'ipd_document',
        'warn',
        toBool(documents.hasConsultOrOperativeReport),
        'เคสซับซ้อนควรมี Consultation/Operative report',
        'hasConsultOrOperativeReport=true',
        documents.hasConsultOrOperativeReport,
      );
    }

    const blockFailed = checks.filter((item) => item.severity === 'block' && !item.passed);
    const warnFailed = checks.filter((item) => item.severity === 'warn' && !item.passed);
    const passed = checks.filter((item) => item.passed).length;

    res.json({
      success: true,
      readyToSubmit: blockFailed.length === 0,
      summary: {
        total: checks.length,
        passed,
        blockFailed: blockFailed.length,
        warnFailed: warnFailed.length,
      },
      checks,
      guidance: {
        blocking: 'ต้องแก้ก่อนส่งเคลม',
        warning: 'ควรทบทวนเพื่อลดความเสี่ยงถูกตีกลับ',
      },
    });
  } catch (error) {
    console.error('Error pre-submit check:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการตรวจ pre-submit',
    });
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
        status: dbStatus.isConnected ? 'running' : 'degraded',
        mode: dbStatus.isConnected ? 'real-data' : 'database-unavailable',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    res.status(500).json({
      database: { connected: false, error: 'Connection test failed' },
      server: { status: 'error', mode: 'database-unavailable' },
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
      host: process.env.HOSXP_HOST,
      user: process.env.HOSXP_USER,
      password: process.env.HOSXP_PASSWORD,
      database: process.env.HOSXP_DB,
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
        candidateTotal: result.candidateCount,
        excludedWithoutEvidence: result.excludedCount,
        trackingSummary: result.trackingSummary,
        trackingIssues: result.trackingIssues,
      }
    });
  } catch (error) {
    console.error('Error fetching kidney monitor data:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// API สำหรับมอนิเตอร์กองทุน FS จากรายการค่าใช้จ่ายจริง
app.get('/api/hosxp/fs-monitor', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing date parameters' });
    }

    console.log(`💰 Fetching FS monitor data from ${startDate} to ${endDate}`);
    const result = await getFsMonitor(startDate as string, endDate as string);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error fetching FS monitor data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: (error as Error).message,
    });
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
        const response = await fetchWithTimeout(endpoint, {
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

app.post(
  '/api/repstm/analyze-archive',
  express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '50mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลไฟล์ ZIP' });
      }
      const encodedName = String(req.headers['x-source-filename'] || 'archive.zip');
      let sourceFilename = 'archive.zip';
      try {
        sourceFilename = decodeURIComponent(encodedName).trim() || 'archive.zip';
      } catch {
        sourceFilename = encodedName.trim() || 'archive.zip';
      }
      if (!/\.zip$/i.test(sourceFilename)) {
        return res.status(400).json({ success: false, error: 'รองรับเฉพาะไฟล์ ZIP' });
      }
      const analysis = analyzeRepstmArchive(req.body, sourceFilename);
      res.json({ success: true, data: analysis });
    } catch (error) {
      console.error('Error analyzing REP/STM ZIP:', error);
      res.status(422).json({ success: false, error: (error as Error).message || 'อ่าน ZIP ไม่สำเร็จ' });
    }
  },
);

app.post('/api/repstm/import', async (req, res) => {
  try {
    const { dataType, sourceFilename, fileSize, fileHash, sheetName, isSubfile, importedBy, notes, rows, forceReimport } = req.body as {
      dataType?: 'REP' | 'STM' | 'INV';
      sourceFilename?: string;
      fileSize?: number;
      fileHash?: string;
      sheetName?: string;
      isSubfile?: boolean;
      importedBy?: string;
      notes?: string;
      rows?: Record<string, unknown>[];
      forceReimport?: boolean;
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
      fileSize: Number.isFinite(fileSize) ? Number(fileSize) : undefined,
      fileHash: /^[a-f0-9]{64}$/i.test(String(fileHash || '')) ? String(fileHash).toLowerCase() : undefined,
      sheetName: sheetName ? String(sheetName).trim() : undefined,
      isSubfile: isSubfile === true,
      importedBy: importedBy ? String(importedBy).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      rows: sanitizedRows,
      forceReimport: forceReimport === true,
    });

    if (!result.success) {
      throw result.error || new Error('Import failed');
    }

    res.json({
      success: true,
      duplicate: Boolean((result as Record<string, unknown>).duplicate),
      skipped: Boolean((result as Record<string, unknown>).skipped),
      replaced: Boolean((result as Record<string, unknown>).replaced),
      replacedBatchId: (result as Record<string, unknown>).replacedBatchId || null,
      forced: Boolean((result as Record<string, unknown>).forced),
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

app.post('/api/repstm/preflight', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0 || files.length > 1000) {
      return res.status(400).json({ success: false, error: 'กรุณาส่งรายการไฟล์ 1-1,000 ไฟล์' });
    }
    const data = await preflightRepstmImportFiles(files.map((file: Record<string, unknown>) => ({
      filename: String(file?.filename || ''),
      size: Number(file?.size),
      hash: String(file?.hash || ''),
    })));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error checking REP/STM/INV import files:', error);
    res.status(500).json({ success: false, error: 'ตรวจสอบไฟล์ที่เคยนำเข้าไม่สำเร็จ' });
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

app.get('/api/repstm/batches/:batchId', async (req, res) => {
  try {
    const batchId = Number(req.params.batchId);
    if (!Number.isInteger(batchId) || batchId <= 0) {
      return res.status(400).json({ success: false, error: 'หมายเลข batch ไม่ถูกต้อง' });
    }
    const data = await getRepstmImportBatchDetail(batchId, Number(req.query.limit || 2000));
    if (!data) return res.status(404).json({ success: false, error: 'ไม่พบ batch ที่ต้องการ' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching REP/STM batch detail:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านรายละเอียด batch' });
  }
});

app.get('/api/repstm/manage/search', async (req, res) => {
  try {
    const filters = normalizeRepstmSearchFilters(req.query as Record<string, unknown>);
    const data = await searchRepstmManagedBatches(filters);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error searching REP/STM/INV management rows:', error);
    res.status(500).json({ success: false, error: 'ค้นหาข้อมูล REP/STM/INV ไม่สำเร็จ' });
  }
});

app.delete('/api/repstm/manage/batches/:batchId', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const validation = validateRepstmBatchDeletion(req.params.batchId, req.body as Record<string, unknown>);
    if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });
    const result = await deleteRepstmManagedBatch({
      batchId: validation.batchId,
      reason: validation.reason,
      deletedBy: String(req.authUser?.display_name || req.authUser?.username || 'admin'),
    });
    res.json({ success: true, data: result, message: `ลบ batch #${result.batchId} แล้ว` });
  } catch (error) {
    console.error('Error deleting REP/STM/INV batch:', error);
    res.status(500).json({ success: false, error: (error as Error).message || 'ลบ batch ไม่สำเร็จ' });
  }
});

app.get('/api/repstm/:dataType', async (req, res) => {
  try {
    const dataType = String(req.params.dataType || '').toUpperCase() as 'REP' | 'STM' | 'INV';
    if (!['REP', 'STM', 'INV'].includes(dataType)) {
      return res.status(400).json({ success: false, error: 'dataType ต้องเป็น REP, STM หรือ INV' });
    }

    const limit = Number(req.query.limit || 200);
    const visit = {
      vn: String(req.query.vn || '').trim() || undefined,
      an: String(req.query.an || '').trim() || undefined,
      hn: String(req.query.hn || '').trim() || undefined,
    };
    if (String(req.query.visitOnly || '') === 'true' && !visit.vn && !visit.an) {
      return res.json({ success: true, data: [] });
    }
    const data = dataType === 'REP'
      ? await getRepDataRows(limit, visit)
      : String(req.query.visitOnly || '') === 'true'
        ? await getStatementVisitRows(dataType, limit, visit)
        : await getRepstmImportedRows(dataType, limit, visit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching REP/STM/INV rows:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านข้อมูล REP/STM/INV' });
  }
});

app.post('/api/fdh/claim-detail/import', async (req, res) => {
  try {
    const { sourceFilename, sheetName, importedBy, notes, rows } = req.body as {
      sourceFilename?: string;
      sheetName?: string;
      importedBy?: string;
      notes?: string;
      rows?: Record<string, unknown>[];
    };

    if (!sourceFilename || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาเลือกไฟล์ FDH ClaimDetail ที่มีข้อมูล' });
    }

    const result = await importFdhClaimDetailRows({
      sourceFilename: String(sourceFilename).trim(),
      sheetName: sheetName ? String(sheetName).trim() : undefined,
      importedBy: importedBy ? String(importedBy).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      rows,
    });

    if (!result.success) {
      throw result.error || new Error('Import FDH ClaimDetail failed');
    }

    return res.json({
      success: true,
      duplicate: result.duplicate,
      batchId: result.batchId,
      rowCount: result.rowCount,
      opCount: result.opCount || 0,
      ipCount: result.ipCount || 0,
      message: result.message,
    });
  } catch (error) {
    console.error('Error importing FDH ClaimDetail:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการนำเข้า FDH ClaimDetail' });
  }
});

app.get('/api/fdh/claim-detail/batches', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const data = await getFdhClaimDetailBatches(limit);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching FDH ClaimDetail batches:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านประวัตินำเข้า FDH ClaimDetail' });
  }
});

app.get('/api/fdh/claim-detail/summary', async (_req, res) => {
  try {
    const data = await getFdhClaimDetailSummary();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching FDH ClaimDetail summary:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านยอดรวมนำเข้า FDH ClaimDetail' });
  }
});

app.get('/api/fdh/claim-detail/rows', async (req, res) => {
  try {
    const data = await getFdhClaimDetailRows({
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching FDH ClaimDetail rows:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการอ่านข้อมูล FDH ClaimDetail' });
  }
});

app.get('/api/receivables/reconciliation', async (req, res) => {
  try {
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const pageSize = req.query.pageSize ? Math.min(500, Math.max(10, Number(req.query.pageSize))) : 100;
    const result = await getVisitRepStmComparison({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      claimStatus: req.query.claimStatus ? String(req.query.claimStatus) : undefined,
      patientRight: req.query.patientRight ? String(req.query.patientRight) : undefined,
      hosxpRight: req.query.hosxpRight ? String(req.query.hosxpRight) : undefined,
      financeRight: req.query.financeRight ? String(req.query.financeRight) : undefined,
      compareStatus: req.query.compareStatus ? String(req.query.compareStatus) : undefined,
      page,
      pageSize,
    });
    res.json({ success: true, ...result, page, pageSize });
  } catch (error) {
    console.error('Error fetching reconciliation data:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดข้อมูลกระทบยอด REP/STM' });
  }
});

app.get('/api/uc-outside-cup/dashboard', async (req, res) => {
  try {
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const pageSize = req.query.pageSize ? Math.min(500, Math.max(10, Number(req.query.pageSize))) : 100;
    const result = await getUcOutsideCupDashboard({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      compareStatus: req.query.compareStatus ? String(req.query.compareStatus) : undefined,
      hmain: req.query.hmain ? String(req.query.hmain) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      page,
      pageSize,
    });
    res.json({ success: true, ...result, page, pageSize });
  } catch (error) {
    console.error('Error fetching UC outside CUP dashboard:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล UC นอก CUP ในจังหวัด' });
  }
});

app.get('/api/ppfs/nhso-report', async (req, res) => {
  try {
    const data = await getPpfsNhsoReport({
      hcode: req.query.hcode ? String(req.query.hcode) : undefined,
      metric: req.query.metric ? String(req.query.metric) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching NHSO PPFS report:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดรายงาน PPFS จาก สปสช.' });
  }
});

app.get('/api/ppfs/visit-match', async (req, res) => {
  try {
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const pageSize = req.query.pageSize ? Math.min(500, Math.max(10, Number(req.query.pageSize))) : 100;
    const result = await getVisitRepStmComparison({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      hosxpRight: req.query.hosxpRight ? String(req.query.hosxpRight) : undefined,
      compareStatus: req.query.compareStatus ? String(req.query.compareStatus) : undefined,
      paymentSource: 'PPFS',
      page,
      pageSize,
    });
    res.json({ success: true, ...result, page, pageSize });
  } catch (error) {
    console.error('Error fetching PPFS visit match data:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการ match PPFS กับข้อมูล HOSxP' });
  }
});

app.get('/api/uuc1-tracking', async (req, res) => {
  try {
    const result = await getUuc1RepStmTracking({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      patientRight: req.query.patientRight ? String(req.query.patientRight) : undefined,
      hosxpRight: req.query.hosxpRight ? String(req.query.hosxpRight) : undefined,
      financeRight: req.query.financeRight ? String(req.query.financeRight) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching UUC1 tracking data:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดข้อมูลติดตาม UUC1 REP/STM' });
  }
});

app.get('/api/rep-daily-summary', async (req, res) => {
  try {
    const result = await getRepDailyClaimSummary({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching daily REP summary:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดสรุป REP รายวัน' });
  }
});

app.get('/api/rep-daily-summary/visits', async (req, res) => {
  try {
    const result = await getRepDailyVisitsForDate({
      claimDate: req.query.claimDate ? String(req.query.claimDate) : '',
      patientType: req.query.patientType ? String(req.query.patientType) : undefined,
      claimStatus: req.query.claimStatus ? String(req.query.claimStatus) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching REP daily visits:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดรายการ visit ของวัน' });
  }
});

app.get('/api/rep-daily-summary/visit-detail', async (req, res) => {
  try {
    const data = await getRepDailyVisitDetail({
      patientType: req.query.patientType ? String(req.query.patientType) : '',
      visitCode: req.query.visitCode ? String(req.query.visitCode) : '',
    });
    if (!data) {
      return res.status(404).json({ success: false, error: 'ไม่พบรายละเอียด visit' });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching REP daily visit detail:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการโหลดรายละเอียด visit' });
  }
});

app.get('/api/receivables/candidates', async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).slice(0, 10) : '';
    const endDate = req.query.endDate ? String(req.query.endDate).slice(0, 10) : '';
    const patientType = req.query.patientType ? String(req.query.patientType).toUpperCase() : 'ALL';
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isValidIsoDate = (value: string) => {
      if (!isoDatePattern.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return res.status(400).json({ success: false, error: 'ช่วงวันที่ไม่ถูกต้อง' });
    }
    if (!['ALL', 'OPD', 'IPD'].includes(patientType)) {
      return res.status(400).json({ success: false, error: 'ประเภทผู้ป่วยไม่ถูกต้อง' });
    }
    const data = await getReceivableCandidates({
      startDate,
      endDate,
      patientType,
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

app.get('/api/moph-claim/dmht/candidates', async (req, res) => {
  try {
    const data = await getMophDmhtCandidates({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      diag: req.query.diag ? String(req.query.diag) : undefined,
      ucOnly: isTruthyFlag(req.query.ucOnly),
      authenOnly: isTruthyFlag(req.query.authenOnly),
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    console.error('Error loading MOPH DMHT candidates:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/moph-claim/dmht/check', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>).slice(0, MOPH_DMHT_ACTION_LIMIT)
      : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบรายการที่เลือก' });

    const config = await getResolvedMophClaimConfig(req.body?.config || {});
    const token = await getMophClaimToken(config);
    const apiBaseUrl = getMophClaimApiBaseUrl(config, isTruthyFlag(req.body?.testZone));
    const hcode = String(config.hcode || '').trim();
    const connection = await getUTFConnection();
    const results: Record<string, unknown>[] = [];
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS mophclaim_send (
        vn VARCHAR(25) NOT NULL,
        type VARCHAR(10) NOT NULL,
        senddate DATE NULL,
        flag CHAR(1) NULL,
        transaction_uid VARCHAR(100) NULL,
        note VARCHAR(200) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (vn, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      for (const row of rows) {
        const type = normalizeMophRowType(row);
        const payload = {
          pid: String(row.cid || ''),
          id_type: '1',
          hcode,
          visit_date_time: formatMophVisitDateTime(row.visit_datetime || row.service_date),
        };
        const result = await postMophClaimJson(`${apiBaseUrl}/api/v1/opd/${type}`, token, payload);
        const json = result.json;
        const statusNo = Number(json.code || json.status || result.status || 0);
        const messageTh = String(json.message_th || '');
        const messageEn = String(json.message || '');
        const message = `${messageTh}${messageTh && messageEn ? '(' : ''}${messageEn}${messageTh && messageEn ? ')' : ''}`;
        const transactionUid = String((json.data as Record<string, unknown> | undefined)?.transaction_uid || '');
        let flag = '';
        if (shouldPersistMophResult(statusNo, `${messageTh} ${messageEn}`)) {
          flag = `${messageTh} ${messageEn}`.toLowerCase().includes('patient not new ht') ? 'C' : 'Y';
          await connection.query(
            `REPLACE INTO mophclaim_send (vn, type, senddate, flag, transaction_uid, note)
             VALUES (?, ?, CURDATE(), ?, ?, ?)`,
            [String(row.vn || ''), type.toUpperCase(), flag, transactionUid, flag === 'C' ? messageEn.slice(0, 200) : '']
          );
        }
        results.push({ vn: row.vn, diag: type.toUpperCase(), statusNo, message, transaction_uid: transactionUid, flag });
      }
    } finally {
      connection.release();
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('MOPH DMHT check error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/moph-claim/dmht/send', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>).slice(0, MOPH_DMHT_ACTION_LIMIT)
      : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบรายการที่เลือก' });

    const config = await getResolvedMophClaimConfig(req.body?.config || {});
    const token = await getMophClaimToken(config);
    const apiBaseUrl = getMophClaimApiBaseUrl(config, isTruthyFlag(req.body?.testZone));
    const hcode = String(config.hcode || '').trim();
    const appSettings = await getAppSetting<Record<string, unknown>>(APP_SETTINGS_KEY);
    const hospitalName = String(appSettings?.hospital_name || '');
    const connection = await getUTFConnection();
    const results: Record<string, unknown>[] = [];
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS mophclaim_send (
        vn VARCHAR(25) NOT NULL,
        type VARCHAR(10) NOT NULL,
        senddate DATE NULL,
        flag CHAR(1) NULL,
        transaction_uid VARCHAR(100) NULL,
        note VARCHAR(200) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (vn, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      for (const row of rows) {
        const type = normalizeMophRowType(row);
        const dx = type === 'dm' ? 'E119' : 'I10';
        const claimServices: Record<string, unknown>[] = [];
        if (type === 'dm' && String(row.result_hba1c || '').trim()) {
          claimServices.push({ name: 'HbA1C', code: '32401', lab_result: String(row.result_hba1c) });
        }
        if (type === 'ht' && String(row.result_creatinine || '').trim()) {
          claimServices.push({ name: 'Creatinine (Cr)', code: '32202', lab_result: String(row.result_creatinine) });
        }
        if (type === 'ht' && String(row.result_potassium || '').trim()) {
          claimServices.push({ name: 'Potassium (K)', code: '32103', lab_result: String(row.result_potassium) });
        }
        if (claimServices.length === 0) {
          results.push({ vn: row.vn, diag: type.toUpperCase(), statusNo: 0, message: 'ไม่มีผล Lab สำหรับส่ง', flag: '' });
          continue;
        }

        const payload = {
          seq: String(row.vn || ''),
          hn: String(row.hn || ''),
          pid: String(row.cid || ''),
          id_type: '1',
          title: String(row.pname || ''),
          fname: String(row.fname || ''),
          lname: String(row.lname || ''),
          occupa: String(row.occupation || ''),
          marriage: String(row.marrystatus || ''),
          dob: String(row.dob || '').slice(0, 10),
          sex: String(row.sex || ''),
          nation: String(row.nation || ''),
          uuc: '1',
          hcode,
          hospital_name: hospitalName,
          visit_date_time: formatMophVisitDateTime(row.visit_datetime || row.service_date),
          is_used_dm: type === 'dm' ? '1' : '0',
          is_used_ht: type === 'ht' ? '1' : '0',
          diagnosis: [{ dx_date_time: formatMophVisitDateTime(row.visit_datetime || row.service_date), icd10: dx, dx_type: '1' }],
          claim_services: claimServices,
        };

        const result = await postMophClaimJson(`${apiBaseUrl}/api/v1/opd/service-admissions/dmht`, token, payload);
        const json = result.json;
        const statusNo = Number(json.code || json.status || result.status || 0);
        const messageTh = String(json.message_th || '');
        const messageEn = String(json.message || '');
        const message = `${messageTh}${messageTh && messageEn ? '(' : ''}${messageEn}${messageTh && messageEn ? ')' : ''}`;
        const transactionUid = String((json.data as Record<string, unknown> | undefined)?.transaction_uid || '');
        let flag = '';
        if (shouldPersistMophResult(statusNo, `${messageTh} ${messageEn}`)) {
          flag = `${messageTh} ${messageEn}`.toLowerCase().includes('patient not new ht') ? 'C' : 'Y';
          await connection.query(
            `REPLACE INTO mophclaim_send (vn, type, senddate, flag, transaction_uid, note)
             VALUES (?, ?, CURDATE(), ?, ?, ?)`,
            [String(row.vn || ''), type.toUpperCase(), flag, transactionUid, flag === 'C' ? messageEn.slice(0, 200) : '']
          );
        }
        results.push({ vn: row.vn, diag: type.toUpperCase(), statusNo, message, transaction_uid: transactionUid, flag });
      }
    } finally {
      connection.release();
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('MOPH DMHT send error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/moph-claim/vaccine/candidates', async (req, res) => {
  try {
    const types = String(req.query.types || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const data = await getMophVaccineCandidates({
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      types,
      ucOnly: isTruthyFlag(req.query.ucOnly),
      authenOnly: isTruthyFlag(req.query.authenOnly),
      errorFilter: req.query.errorFilter ? String(req.query.errorFilter) : undefined,
      sendFilter: req.query.sendFilter ? String(req.query.sendFilter) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    console.error('Error loading MOPH vaccine candidates:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/moph-claim/vaccine/check', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>).slice(0, MOPH_DMHT_ACTION_LIMIT)
      : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบรายการที่เลือก' });
    if (sendApVaccineValidationError(res, findInvalidApVaccineRow(rows))) return;

    const config = await getResolvedMophClaimConfig(req.body?.config || {});
    const token = await getMophClaimToken(config);
    const apiBaseUrl = getMophClaimApiBaseUrl(config, isTruthyFlag(req.body?.testZone));
    const hcode = String(config.hcode || '').trim();
    const connection = await getUTFConnection();
    const results: Record<string, unknown>[] = [];
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS mophclaim_send (
        vn VARCHAR(25) NOT NULL,
        type VARCHAR(10) NOT NULL,
        senddate DATE NULL,
        flag CHAR(1) NULL,
        transaction_uid VARCHAR(100) NULL,
        note VARCHAR(200) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (vn, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      for (const row of rows) {
        const endpointType = normalizeMophVaccineType(row);
        const vaccineCode = String(row.vaccine_code || '').trim();
        const payload = {
          pid: String(row.cid || ''),
          id_type: '1',
          hcode,
          visit_date_time: formatMophVisitDateTime(row.visit_datetime || row.service_date),
          vaccine_code: vaccineCode,
          dob: String(row.dob || '').slice(0, 10),
        };
        const result = await postMophClaimJson(`${apiBaseUrl}/api/v1/opd/${endpointType}`, token, payload);
        const json = result.json;
        const statusNo = Number(json.code || json.status || result.status || 0);
        const messageTh = String(json.message_th || '');
        const messageEn = String(json.message || '');
        const message = `${messageTh}${messageTh && messageEn ? '(' : ''}${messageEn}${messageTh && messageEn ? ')' : ''}`;
        const transactionUid = String((json.data as Record<string, unknown> | undefined)?.transaction_uid || '');
        let flag = '';
        if (shouldPersistMophResult(statusNo, `${messageTh} ${messageEn}`)) {
          flag = 'Y';
          await connection.query(
            `REPLACE INTO mophclaim_send (vn, type, senddate, flag, transaction_uid, note)
             VALUES (?, ?, CURDATE(), ?, ?, ?)`,
            [String(row.vn || ''), vaccineCode, flag, transactionUid, '']
          );
        }
        results.push({ vn: row.vn, vaccine_code: vaccineCode, type: row.type, statusNo, message, transaction_uid: transactionUid, flag });
      }
    } finally {
      connection.release();
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('MOPH vaccine check error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/moph-claim/vaccine/send', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>).slice(0, MOPH_DMHT_ACTION_LIMIT)
      : [];
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบรายการที่เลือก' });
    if (sendApVaccineValidationError(res, findInvalidApVaccineRow(rows))) return;

    const config = await getResolvedMophClaimConfig(req.body?.config || {});
    const token = await getMophClaimToken(config);
    const apiBaseUrl = getMophClaimApiBaseUrl(config, isTruthyFlag(req.body?.testZone));
    const hcode = String(config.hcode || '').trim();
    const appSettings = await getAppSetting<Record<string, unknown>>(APP_SETTINGS_KEY);
    const hospitalName = String(appSettings?.hospital_name || '');
    const connection = await getUTFConnection();
    const results: Record<string, unknown>[] = [];
    try {
      await connection.query(`CREATE TABLE IF NOT EXISTS mophclaim_send (
        vn VARCHAR(25) NOT NULL,
        type VARCHAR(10) NOT NULL,
        senddate DATE NULL,
        flag CHAR(1) NULL,
        transaction_uid VARCHAR(100) NULL,
        note VARCHAR(200) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (vn, type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      for (const row of rows) {
        const endpointType = normalizeMophVaccineType(row);
        const vaccineCode = String(row.vaccine_code || '').trim();
        const noteParts = String(row.vaccine_note || '').split('#');
        const diagnosis = parseMophDiagnosis(row);
        const payload: Record<string, unknown> = {
          seq: String(row.vn || ''),
          hn: String(row.hn || ''),
          pid: String(row.cid || ''),
          id_type: '1',
          title: String(row.pname || ''),
          fname: String(row.fname || ''),
          lname: String(row.lname || ''),
          occupa: String(row.occupation || ''),
          marriage: String(row.marrystatus || ''),
          dob: String(row.dob || '').slice(0, 10),
          sex: String(row.sex || ''),
          nation: String(row.nation || ''),
          uuc: '1',
          hcode,
          hospital_name: hospitalName,
          visit_date_time: formatMophVisitDateTime(row.visit_datetime || row.service_date),
          vaccine: [{
            code: noteParts[0] || vaccineCode,
            lot_number: noteParts[1] || String(row.lot || ''),
            dose_quantity: noteParts[2] || String(row.dose || ''),
            manufacturer: noteParts[3] || String(row.company || ''),
            expiration_date: noteParts[4] || String(row.dateexp || '').slice(0, 10),
            occurence_date_time: noteParts[5] || formatMophVisitDateTime(row.visit_datetime || row.service_date),
            site_code: noteParts[6] || String(row.site || 'LA'),
            route_code: noteParts[7] || String(row.drugusage || 'IM'),
            license_no: noteParts[8] || String(row.doctorlicense || ''),
            name: noteParts[9] || String(row.doctorname || ''),
            note: '',
          }],
        };
        if (vaccineCode.toUpperCase() === 'P41') {
          payload.prenatal = {
            gravida: String(row.preg_no || ''),
            ga_week: String(row.ga || ''),
          };
        }
        if (diagnosis.length > 0) {
          payload.diagnosis = diagnosis;
        }

        const result = await postMophClaimJson(`${apiBaseUrl}/api/v1/opd/service-admissions/${endpointType}`, token, payload);
        const json = result.json;
        const statusNo = Number(json.code || json.status || result.status || 0);
        const messageTh = String(json.message_th || '');
        const messageEn = String(json.message || '');
        const message = `${messageTh}${messageTh && messageEn ? '(' : ''}${messageEn}${messageTh && messageEn ? ')' : ''}`;
        const transactionUid = String((json.data as Record<string, unknown> | undefined)?.transaction_uid || '');
        let flag = '';
        if (shouldPersistMophResult(statusNo, `${messageTh} ${messageEn}`)) {
          flag = 'Y';
          await connection.query(
            `REPLACE INTO mophclaim_send (vn, type, senddate, flag, transaction_uid, note)
             VALUES (?, ?, CURDATE(), ?, ?, ?)`,
            [String(row.vn || ''), vaccineCode, flag, transactionUid, '']
          );
        }
        results.push({ vn: row.vn, vaccine_code: vaccineCode, type: row.type, statusNo, message, transaction_uid: transactionUid, flag });
      }
    } finally {
      connection.release();
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('MOPH vaccine send error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
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
    const parsedLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, Math.floor(parsedLimit))) : 50;
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
      valeTargetFilename: String(req.query.valeTargetFilename || ''),
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

app.get('/api/insurance/vale-status', async (req, res) => {
  try {
    const data = await getValeImportStatus({
      valeTargetFilename: String(req.query.valeTargetFilename || ''),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error refreshing Vale import status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถอัปเดทข้อมูล Vale ได้',
    });
  }
});

app.get('/api/dashboard/moph-claim-summary', async (req, res) => {
  try {
    const data = await getMophClaimDashboardSummary({
      startDate: String(req.query.startDate || ''),
      endDate: String(req.query.endDate || ''),
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching MOPH claim dashboard summary:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถโหลดสรุป MOPH Claim ได้',
    });
  }
});

app.post('/api/receivables/batches', async (req, res) => {
  try {
    const result = await saveReceivableBatch(req.body || {});
    if (!result.success) {
      const statusCode = Number(result.statusCode || 500);
      return res.status(statusCode).json({ success: false, error: result.error });
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
    const validationError = validateBusinessRulesConfig(newConfig);
    if (validationError) return res.status(400).json({ success: false, error: validationError });
    await setAppSetting(CONFIG_SETTING_KEY, newConfig);
    console.log('✅ Business rules updated in database via backend compatibility endpoint');
    res.json({ success: true, message: 'Business rules updated successfully', source: 'database' });
  } catch (error) {
    console.error('Error updating backend config:', error);
    res.status(500).json({ success: false, error: 'Cannot update backend configuration' });
  }
});

// POST: บันทึกการตั้งค่าธุรกิจ (Frontend)
app.post('/api/config/business-rules/frontend', async (req, res) => {
  try {
    const newConfig = req.body;
    const validationError = validateBusinessRulesConfig(newConfig);
    if (validationError) return res.status(400).json({ success: false, error: validationError });
    await setAppSetting(CONFIG_SETTING_KEY, newConfig);
    console.log('✅ Business rules updated in database via frontend compatibility endpoint');
    res.json({ success: true, message: 'Business rules updated successfully', source: 'database' });
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
    const validationError = validateSiteSettings(newSettings);
    if (validationError) return res.status(400).json({ success: false, error: validationError });
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
      data: maskConfigSecrets(resolvedConfig, ['password']),
      source: config ? 'database' : 'default'
    });
  } catch (error) {
    console.error('Error reading FDH API settings:', error);
    res.status(500).json({ success: false, error: 'Cannot read FDH API settings' });
  }
});

app.post('/api/config/fdh-api-settings', async (req, res) => {
  try {
    if (!isPlainRecord(req.body)) return res.status(400).json({ success: false, error: 'FDH API settings ต้องเป็น JSON object' });
    const payload = await buildFdhApiSettingsPayload(req.body);
    await setAppSetting(FDH_API_SETTINGS_KEY, payload);
    res.json({ success: true, message: 'FDH API settings updated successfully' });
  } catch (error) {
    console.error('Error updating FDH API settings:', error);
    const message = error instanceof Error ? error.message : 'Cannot update FDH API settings';
    const status = message.includes('URL') || message.includes('Production') ? 400 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

app.get('/api/config/system-settings/status', async (_req, res) => {
  try {
    const meta = await getAppSetting<Record<string, unknown>>(SYSTEM_SETTINGS_META_KEY);
    res.json({ success: true, data: meta || null });
  } catch (error) {
    console.error('Error reading system settings status:', error);
    res.status(500).json({ success: false, error: 'Cannot read system settings status' });
  }
});

app.post('/api/config/system-settings', async (req: AuthenticatedRequest, res) => {
  try {
    const businessRulesConfig = req.body?.businessRules;
    const siteSettings = req.body?.siteSettings;
    const fdhApiInput = req.body?.fdhApiSettings;
    const businessRulesError = validateBusinessRulesConfig(businessRulesConfig);
    if (businessRulesError) return res.status(400).json({ success: false, error: businessRulesError });
    const siteSettingsError = validateSiteSettings(siteSettings);
    if (siteSettingsError) return res.status(400).json({ success: false, error: siteSettingsError });
    if (!isPlainRecord(fdhApiInput)) {
      return res.status(400).json({ success: false, error: 'FDH API settings ต้องเป็น JSON object' });
    }

    const fdhApiSettingsPayload = await buildFdhApiSettingsPayload(fdhApiInput);
    const sanitizedBusinessRules = { ...businessRulesConfig };
    delete sanitizedBusinessRules._source;
    const canonicalBusinessRules = {
      ...sanitizedBusinessRules,
      site_settings: siteSettings,
    };
    const changedAt = new Date().toISOString();
    const meta = {
      updatedAt: changedAt,
      updatedBy: {
        id: Number(req.authUser?.id || 0),
        username: String(req.authUser?.username || ''),
      },
    };
    await setAppSettingsBundle([
      { settingKey: CONFIG_SETTING_KEY, settingValue: canonicalBusinessRules },
      { settingKey: APP_SETTINGS_KEY, settingValue: siteSettings },
      { settingKey: FDH_API_SETTINGS_KEY, settingValue: fdhApiSettingsPayload },
      { settingKey: SYSTEM_SETTINGS_META_KEY, settingValue: meta },
    ]);
    res.json({ success: true, message: 'System settings updated successfully', data: meta });
  } catch (error) {
    console.error('Error updating system settings:', error);
    const message = error instanceof Error ? error.message : 'Cannot update system settings';
    const status = message.includes('URL') || message.includes('Production') ? 400 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

app.post('/api/settings/fdh-api/test-connection', async (_req, res) => {
  try {
    // Deliberately load credentials from server-side storage. This endpoint accepts
    // no username/password and never returns the access token to the browser.
    const savedConfig = await getResolvedFdhApiConfig();
    const result = await requestFdhAccessTokenForConnectionTest(savedConfig);
    res.json({
      success: true,
      message: 'เชื่อมต่อ FDH API สำเร็จ และได้รับ access token แล้ว',
      data: { responseTimeMs: result.responseTimeMs },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการทดสอบการเชื่อมต่อ FDH API';
    const status = message.includes('ยังไม่ได้บันทึก') || message.includes('ไม่ยอมรับ') || message.includes('ไม่ได้รับ access token')
      ? 400
      : message.includes('ไม่ตอบกลับ')
        ? 504
        : 502;
    console.error('FDH API connection test failed:', message);
    res.status(status).json({ success: false, error: message });
  }
});

app.get('/api/config/nhso-authen-settings', async (_req, res) => {
  try {
    const data = await getResolvedNhsoAuthenConfig();
    res.json({ success: true, data: maskConfigSecrets(data, ['token']) });
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
      token: preserveSecret(req.body?.token, current.token),
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
    const { startDate, endDate, mode, fundCodes } = req.body as {
      startDate?: string;
      endDate?: string;
      mode?: 'missing' | 'close-status';
      fundCodes?: string[];
    };
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
      mode: mode === 'close-status' ? 'close-status' : 'missing',
      fundCodes: Array.isArray(fundCodes) ? fundCodes : undefined,
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
    res.json({ success: true, data: maskConfigSecrets(data, ['token', 'recorderPid']) });
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
      token: preserveSecret(req.body?.token, current.token),
      apiBaseUrl: String(req.body?.apiBaseUrl || current.apiBaseUrl || ''),
      sourceId: String(req.body?.sourceId || current.sourceId || 'KSPAPI'),
      claimServiceCode: String(req.body?.claimServiceCode || current.claimServiceCode || 'PG0060001'),
      recorderPid: preserveSecret(req.body?.recorderPid, current.recorderPid),
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
        const response = await fetchWithTimeout(attempt.url, attempt.init);
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
        const tokenRes = await fetchWithTimeout(`${tokenEndpoint}?${query}`, { method: 'POST' });
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

// ─── FDH track-vns (on-demand single/bulk VN tracking) ───────────────────────

/** POST /api/fdh/track-vns — check FDH claim status for given list of VNs */
app.post('/api/fdh/track-vns', async (req, res) => {
  try {
    const { vns } = req.body as { vns?: string[] };
    if (!Array.isArray(vns) || vns.length === 0) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุรายการ VN (vns[])' });
    }
    if (vns.length > 500) {
      return res.status(400).json({ success: false, error: 'ตรวจสอบได้ครั้งละไม่เกิน 500 รายการ' });
    }

    const fdhConfig = await getResolvedFdhApiConfig();
    const tokenUrl = String(fdhConfig.tokenUrl || '').trim();
    const username = String(fdhConfig.username || '').trim();
    const password = String(fdhConfig.password || '');
    const hospitalCode = String(fdhConfig.hcode || '').trim();
    const apiBaseUrl = String(fdhConfig.apiBaseUrl || 'https://fdh.moph.go.th').trim();

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'ยังไม่ได้ตั้งค่า username/password สำหรับ FDH API (ตั้งค่าที่เมนู FDH API Settings)',
      });
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
          hospital_code: hospitalCode,
        }).toString();
        const tokenRes = await fetchWithTimeout(`${tokenEndpoint}?${query}`, { method: 'POST' });
        const rawText = await tokenRes.text();
        let parsed: unknown = {};
        try { parsed = JSON.parse(rawText); } catch { /* raw */ }
        fdhToken = extractTokenFromPayload(parsed) ||
          (rawText.trim().startsWith('{') ? null : rawText.trim() || null);
      } catch { /* try next */ }
    }

    if (!fdhToken) {
      return res.status(400).json({
        success: false,
        error: 'ไม่สามารถขอ FDH token ได้ — กรุณาตรวจสอบ username/password ในการตั้งค่า FDH API',
      });
    }

    const { trackFdhStatusForVns } = await import('./db.js');
    const summary = await trackFdhStatusForVns({ token: fdhToken, apiBaseUrl, hospitalCode, vns });

    return res.json({ success: true, summary });
  } catch (error) {
    console.error('Error in /api/fdh/track-vns:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ FDH',
    });
  }
});

// ─── NHSO eclaim download endpoints ──────────────────────────────────────────

/** GET /api/config/nhso-eclaim-settings */
app.get('/api/config/nhso-eclaim-settings', async (_req, res) => {
  try {
    const data = await getResolvedNhsoEclaimConfig();
    res.json({ success: true, data: maskConfigSecrets(data, ['password']) });
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
      password: preserveSecret(req.body?.password, current.password),
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
  if (!eclaimBrowserSession) return res.json({ alive: false, ready: false, phase: 'closed', message: 'ยังไม่ได้เริ่ม Login ThaID' });
  try {
    const url = eclaimBrowserSession.page.url();
    const title = await eclaimBrowserSession.page.title().catch(() => '');
    return res.json({
      alive: eclaimBrowserSession.browser.isConnected(),
      ready: eclaimBrowserSession.ready,
      phase: eclaimBrowserSession.phase,
      message: eclaimBrowserSession.message,
      error: eclaimBrowserSession.lastError || null,
      url,
      title,
      repPageUrl: eclaimBrowserSession.repPageUrl,
      createdAt: eclaimBrowserSession.createdAt,
    });
  } catch {
    eclaimBrowserSession = null;
    return res.json({ alive: false, ready: false, phase: 'closed', message: 'Browser ถูกปิดแล้ว' });
  }
});

/** GET /api/nhso-eclaim/browser-screenshot — QR/login screen rendered by Alma browser */
app.get('/api/nhso-eclaim/browser-screenshot', async (_req, res) => {
  if (!eclaimBrowserSession) return res.status(404).json({ success: false, error: 'ยังไม่ได้เริ่ม Login ThaID' });
  try {
    const png = await eclaimBrowserSession.page.screenshot({ type: 'png', fullPage: false });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(png);
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/nhso-eclaim/browser-thaid — click the ThaID option in the remote login page */
app.post('/api/nhso-eclaim/browser-thaid', async (_req, res) => {
  if (!eclaimBrowserSession) return res.status(400).json({ success: false, error: 'ยังไม่ได้เริ่ม Browser' });
  try {
    const clicked = await tryOpenThaIdLogin(eclaimBrowserSession.page);
    eclaimBrowserSession.phase = 'waiting_thaid';
    eclaimBrowserSession.message = clicked
      ? 'เปิดหน้า ThaID แล้ว กรุณาสแกน QR'
      : 'ยังไม่พบปุ่ม ThaID โปรดตรวจภาพ Login แล้วลองอีกครั้ง';
    return res.json({ success: clicked, message: eclaimBrowserSession.message });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
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

/** POST /api/nhso-eclaim/browser-login — start a non-blocking ThaID browser session */
app.post('/api/nhso-eclaim/browser-login', async (_req, res) => {
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
    const configuredExecutable = String(process.env.ECLAIM_BROWSER_EXECUTABLE || '').trim();
    const executablePath = configuredExecutable && fsSync.existsSync(configuredExecutable)
      ? configuredExecutable
      : fsSync.existsSync(edgePath64)
        ? edgePath64
        : fsSync.existsSync(edgePath)
          ? edgePath
          : undefined;
    const forceHeadless = String(process.env.ECLAIM_BROWSER_HEADLESS || '').trim().toLowerCase();
    const headless = forceHeadless
      ? !['0', 'false', 'no'].includes(forceHeadless)
      : process.platform !== 'win32';

    const browser = await chromium.launch({
      executablePath,
      headless,
      args: headless ? ['--no-sandbox', '--disable-dev-shm-usage'] : ['--start-maximized'],
    });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: 'th-TH' });
    const page = await context.newPage();

    // Store session immediately (browser stays alive after this request returns)
    const session: EclaimBrowserSession = {
      browser,
      context,
      page,
      ready: false,
      phase: 'opening',
      message: 'กำลังเปิดหน้า Login eClaim',
      repPageUrl: '',
      createdAt: Date.now(),
    };
    eclaimBrowserSession = session;

    // Open old e-Claim system
    await page.goto('https://eclaim.nhso.go.th/webComponent/main/MainWebAction.do', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    session.phase = 'waiting_thaid';
    session.message = 'กำลังเปิดตัวเลือก ThaID';
    await page.waitForTimeout(800);
    const clicked = await tryOpenThaIdLogin(page);
    session.message = clicked
      ? 'สแกน QR และยืนยันตัวตนในแอป ThaID'
      : 'กรุณากด “เลือก ThaID” แล้วสแกน QR';
    void monitorEclaimThaIdLogin(session);
    return res.status(202).json({ success: true, ready: false, phase: session.phase, message: session.message });
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
    return res.status(400).json({ success: false, error: 'Browser ยังไม่พร้อม กรุณา Login และยืนยันตัวตนด้วย ThaID ก่อน' });
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
      for (const table of Array.from(document.querySelectorAll<HTMLTableElement>('table'))) {
        for (const tr of Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))) {
          const tds = Array.from(tr.querySelectorAll<HTMLTableCellElement>('td'));
          if (tds.length < 1) continue;
          const cellTexts = tds.map((td) => td.textContent?.trim() || '');
          const links = Array.from(tr.querySelectorAll<HTMLAnchorElement>('a'));
          const dlLinks = links.filter((a) =>
            /download|ดาวน์โหลด|\.zip|\.xlsx|\.xls|\.txt|\.ecd/i.test(
              a.href + a.textContent + (a.getAttribute('onclick') || '')
            )
          );
          if (dlLinks.length > 0) {
            // Validation pages contain two links in the same row: the REP .ecd
            // payload and the human-readable "download excel" link. Always pick
            // the Excel action; selecting the first link only refreshes/downloads
            // the .ecd payload and never produces an importable workbook.
            const excelLink = dlLinks.find((link) =>
              /download\s*excel|excel\s*file|ดาวน์โหลด\s*excel/i.test(
                `${link.textContent || ''} ${link.getAttribute('title') || ''} ${link.getAttribute('aria-label') || ''}`
              )
            ) || dlLinks.find((link) =>
              /excel|xlsx?|export/i.test(`${link.href} ${link.getAttribute('onclick') || ''}`)
              && !/\.ecd(?:$|[?#])/i.test(link.href)
            );
            const a = excelLink || dlLinks.find((link) => !/\.ecd(?:$|[?#])/i.test(link.href)) || dlLinks[0];
            const filenameFromCell = cellTexts.find((t) => /\.\w{2,5}$/.test(t));
            rows.push({
              filename: filenameFromCell || a.textContent?.trim() || cellTexts[0] || 'file',
              downloadHref: a.href || '',
              downloadOnclick: a.getAttribute('onclick') || '',
              downloadLabel: a.textContent?.trim() || '',
              downloadKind: excelLink ? 'EXCEL' : 'FILE',
              sourcePage: window.location.href,
              cells: cellTexts,
              period: pStr,
            });
          } else if (tds.some((td) => /REP|STM|INV|\.zip|\.xlsx|\.ecd/i.test(td.textContent || ''))) {
            // Some eClaim themes use an icon/empty link whose label does not say
            // "download". Keep the row only when there is still a clickable link;
            // otherwise Auto Download would queue a display-only table row.
            const candidate = links.find((a) => Boolean(a.getAttribute('onclick')))
              || links.find((a) => Boolean(a.getAttribute('href')));
            if (candidate) {
              rows.push({
                filename: cellTexts.find((t) => /\.\w{2,5}$/.test(t)) || cellTexts[0] || 'file',
                downloadHref: candidate.href || '',
                downloadOnclick: candidate.getAttribute('onclick') || '',
                sourcePage: window.location.href,
                cells: cellTexts,
                period: pStr,
              });
            }
          }
        }
      }
      return rows;
    }, periodStr);
  };

  try {
    for (const period of periods) {
      const { yearBE, monthNum, monthTh } = parsePeriod(period);
      const periodFiles: Record<string, unknown>[] = [];
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
      if (fileType === 'ALL' || fileType === 'INV') {
        periodFiles.push(...scraped.map((file) => ({ ...file, detectedType: 'INV' })));
      }
      scraped = [];

      // --- Strategy 2: UC + ข้าราชการ Statement pages ---
      if (fileType === 'ALL' || fileType === 'STM') {
        const statementUrls = [
          'https://eclaim.nhso.go.th/webComponent/ucs/statementUCSAction.do?dynamicMenuFunctionUnitId=1578',
          'https://eclaim.nhso.go.th/webComponent/nch/StatementReportWebAction.do?dynamicMenuFunctionUnitId=995',
        ];
        for (const stmUrl of statementUrls) {
          try {
            await page.goto(stmUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(1500);
            pageTitle = await page.title().catch(() => '');
            const yearSel = await page.$('select[name*="year" i], select[id*="year" i], select:first-of-type').catch(() => null);
            if (yearSel) {
              await yearSel.selectOption({ value: String(yearBE) }).catch(() =>
                yearSel.selectOption({ label: String(yearBE) }).catch(() => {/* ignore */})
              );
              await page.waitForTimeout(300);
            }
            const monthSel = await page.$('select[name*="month" i], select[id*="month" i], select:nth-of-type(2)').catch(() => null);
            if (monthSel) {
              await monthSel.selectOption({ value: String(monthNum) }).catch(() =>
                monthSel.selectOption({ label: monthTh }).catch(() => {/* ignore */})
              );
              await page.waitForTimeout(300);
            }
            const submitBtn = await page.$('input[type="submit"], button[type="submit"], button:text-matches("แสดง|ค้นหา", "i")').catch(() => null);
            if (submitBtn) {
              await submitBtn.click();
              await page.waitForTimeout(2000);
            }
            const statementFiles = await scrapeFilesFromPage(period);
            periodFiles.push(...statementFiles.map((file) => ({ ...file, detectedType: 'STM' })));
            usedUrl = stmUrl;
          } catch { /* try the next statement page */ }
        }
      }

      // --- Strategy 3: INV ทุกสิทธิที่พบในหน้า validation ของ eClaim ---
      // หน้าตรวจสอบแยกสิทธิใช้ maininscl ต่างกัน จึงต้องเปิดครบทุกหน้า
      // ห้ามหยุดที่หน้าที่พบไฟล์หน้าแรก มิฉะนั้นไฟล์ของสิทธิอื่นจะตกหล่น
      if (fileType === 'ALL' || fileType === 'INV') {
        const insuranceCodes = ['ucs', 'ofc', 'lgo', 'bkk'];
        const repSources = [
          ...insuranceCodes.map((fund) => ({
            fund: fund.toUpperCase(),
            needsPeriodSelection: true,
            url: `https://eclaim.nhso.go.th/webComponent/validation/ValidationMainAction.do?maininscl=${fund}`,
          })),
          {
            fund: 'REP',
            needsPeriodSelection: false,
            url: `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=list&period=${period}`,
          },
          {
            fund: 'REP',
            needsPeriodSelection: false,
            url: `https://eclaim.nhso.go.th/webComponent/rep/RepAction.do?method=search&period=${period}`,
          },
          ...(eclaimBrowserSession.repPageUrl ? [{
            fund: 'REP',
            needsPeriodSelection: false,
            url: eclaimBrowserSession.repPageUrl,
          }] : []),
        ];

        for (const source of repSources) {
          try {
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await page.waitForTimeout(1500);
            pageTitle = await page.title().catch(() => '');

            const isErrorPage = pageTitle.toLowerCase().includes('error') || await page.evaluate(() =>
              (document.body?.textContent || '').includes('has no explicit mapping for /error')
            ).catch(() => false);
            if (isErrorPage) continue;

            if (source.needsPeriodSelection) {
              const yearSel = await page.$('select[name*="year" i], select[id*="year" i], select:first-of-type').catch(() => null);
              if (yearSel) {
                await yearSel.selectOption({ value: String(yearBE) }).catch(() =>
                  yearSel.selectOption({ label: String(yearBE) }).catch(() => {/* ignore */})
                );
                await page.waitForTimeout(300);
              }
              const monthSel = await page.$('select[name*="month" i], select[id*="month" i], select:nth-of-type(2)').catch(() => null);
              if (monthSel) {
                await monthSel.selectOption({ value: String(monthNum) }).catch(() =>
                  monthSel.selectOption({ label: monthTh }).catch(() => {/* ignore */})
                );
                await page.waitForTimeout(300);
              }
              const submitBtn = await page.$('input[type="submit"], button[type="submit"], button:text-matches("แสดง|ค้นหา", "i")').catch(() => null);
              if (submitBtn) {
                await submitBtn.click();
                await page.waitForTimeout(2000);
              }
            }

            const sourceFiles = await scrapeFilesFromPage(period);
            periodFiles.push(...sourceFiles.map((file) => ({
              ...file,
              detectedType: 'INV',
              fund: source.fund,
              sourcePage: file.sourcePage || source.url,
            })));
            usedUrl = source.url;
          } catch { /* try next */ }
        }
      }

      allFiles.push(...periodFiles);

      // Debug: snapshot of current page HTML
      const htmlSnippet = await page.evaluate(() => document.body?.innerHTML?.slice(0, 3000) || '').catch(() => '');
      debugLog.push({ period, url: usedUrl || 'none', title: pageTitle, rowCount: periodFiles.length, htmlSnippet });
    }

    const uniqueFiles = Array.from(new Map(allFiles.map((file) => {
       const key = [file.period, file.detectedType, file.fund, file.filename, file.downloadHref, file.downloadOnclick]
         .map((value) => String(value || '')).join('|');
      return [key, file] as const;
    })).values());
    return res.json({ success: true, data: uniqueFiles, total: uniqueFiles.length, debug: debugLog });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message, debug: debugLog });
  }
});

/** POST /api/nhso-eclaim/browser-download — download a file via the alive browser, return base64 */
app.post('/api/nhso-eclaim/browser-download', async (req, res) => {
  if (!eclaimBrowserSession?.ready) {
    return res.status(400).json({ success: false, error: 'Browser ยังไม่พร้อม กรุณา login ก่อน' });
  }

  const { downloadHref, downloadOnclick, downloadLabel, filename, sourcePage } = req.body as {
    downloadHref?: string;
    downloadOnclick?: string;
    downloadLabel?: string;
    filename?: string;
    sourcePage?: string;
  };

  const page = eclaimBrowserSession.page;
  const context = eclaimBrowserSession.context;

  const isAllowedEclaimUrl = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'https:' && (parsed.hostname === 'nhso.go.th' || parsed.hostname.endsWith('.nhso.go.th'));
    } catch {
      return false;
    }
  };

  const filenameFromDisposition = (disposition: string) => {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try { return decodeURIComponent(utf8Match[1].replace(/["']/g, '')); } catch { /* use normal filename */ }
    }
    return disposition.match(/filename\s*=\s*["']?([^;"']+)/i)?.[1]?.trim() || '';
  };

  const normalizeDownloadedFilename = (rawName: string, buffer: Buffer, contentType: string) => {
    const baseName = String(rawName || filename || 'eclaim-download').split(/[\\/]/).pop() || 'eclaim-download';
    const safeName = Array.from(baseName)
      .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
      .join('')
      .replace(/[<>:"|?*]/g, '_');
    const oleExcel = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const zipFile = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    const excelMime = /spreadsheet|excel|ms-excel/i.test(contentType);
    const replaceExtension = (extension: string) => /\.[a-z0-9]{1,6}$/i.test(safeName)
      ? safeName.replace(/\.[a-z0-9]{1,6}$/i, extension)
      : `${safeName}${extension}`;

    if (oleExcel) return replaceExtension('.xls');
    if (zipFile) {
      try {
        const archive = new AdmZip(buffer);
        if (archive.getEntry('xl/workbook.xml')) return replaceExtension('.xlsx');
      } catch { /* keep the server filename */ }
    }
    if (excelMime && !/\.(xlsx?|csv)$/i.test(safeName)) return replaceExtension('.xls');
    return safeName;
  };

  const sendBuffer = (buffer: Buffer, responseFilename: string, contentType = 'application/octet-stream') => (
    res.json({
      success: true,
      base64: buffer.toString('base64'),
      filename: normalizeDownloadedFilename(responseFilename, buffer, contentType),
      contentType,
    })
  );

  try {
    // Most eClaim links are normal HTTP downloads. Calling them through the
    // Playwright request context keeps the same ThaID/JSESSIONID cookies and is
    // more reliable than waiting for a browser download event on a headless server.
    if (downloadHref && /^https?:\/\//i.test(downloadHref) && isAllowedEclaimUrl(downloadHref)) {
      const directResponse = await context.request.get(downloadHref, {
        failOnStatusCode: false,
        timeout: 60000,
        headers: { Referer: sourcePage && isAllowedEclaimUrl(sourcePage) ? sourcePage : page.url() },
      }).catch(() => null);

      if (directResponse) {
        const contentType = String(directResponse.headers()['content-type'] || '').toLowerCase();
        const disposition = String(directResponse.headers()['content-disposition'] || '');
        const buffer = await directResponse.body().catch(() => Buffer.alloc(0));
        const prefix = buffer.subarray(0, 200).toString('utf8').trim().toLowerCase();
        const looksLikeLoginOrError = contentType.includes('text/html')
          || contentType.includes('application/json')
          || prefix.startsWith('<!doctype html')
          || prefix.startsWith('<html');
        const downloadable = directResponse.ok() && buffer.length > 0
          && (!looksLikeLoginOrError || /attachment|filename=/i.test(disposition));

        if (downloadable) {
          const responseName = filenameFromDisposition(disposition) || filename || 'eclaim-download';
          await directResponse.dispose().catch(() => undefined);
          return sendBuffer(buffer, responseName, contentType || 'application/octet-stream');
        }
        await directResponse.dispose().catch(() => undefined);
      }
    }

    // onclick/javascript links depend on functions and form state from the page
    // where the result was found. Return to that page and click the real anchor.
    if (sourcePage && isAllowedEclaimUrl(sourcePage) && page.url() !== sourcePage) {
      await page.goto(sourcePage, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(800);
    }

    const downloadWaiters = context.pages().map((candidatePage) =>
      candidatePage.waitForEvent('download', { timeout: 60000 }).catch(() => null)
    );
    downloadWaiters.push(
      context.waitForEvent('page', { timeout: 60000 })
        .then((popup) => popup.waitForEvent('download', { timeout: 60000 }))
        .catch(() => null)
    );

    let clicked = false;
    const anchors = page.locator('a');
    const anchorCount = await anchors.count();
    let bestAnchorIndex = -1;
    let bestAnchorScore = 0;
    for (let index = 0; index < anchorCount; index += 1) {
      const anchor = anchors.nth(index);
      const info = await anchor.evaluate((element) => ({
        href: (element as HTMLAnchorElement).href || '',
        onclick: element.getAttribute('onclick') || '',
        text: element.textContent?.trim() || '',
        rowText: element.closest('tr')?.textContent?.trim() || '',
      })).catch(() => null);
      if (!info) continue;
      const sameHref = Boolean(downloadHref) && info.href === downloadHref;
      const sameOnclick = Boolean(downloadOnclick) && info.onclick === downloadOnclick;
      const sameLabel = Boolean(downloadLabel) && info.text.trim().toLowerCase() === String(downloadLabel).trim().toLowerCase();
      const sameFilename = Boolean(filename) && info.text.includes(String(filename));
      const sameRow = Boolean(filename) && info.rowText.includes(String(filename));
      const genericHref = /(?:#|javascript:\s*(?:void\(0\))?)$/i.test(info.href);
      const score = (sameOnclick ? 100 : 0)
        + (sameLabel ? 80 : 0)
        + (sameHref && !genericHref ? 60 : 0)
        + (sameHref ? 5 : 0)
        + (sameRow ? 40 : 0)
        + (sameFilename ? 10 : 0);
      if (score > bestAnchorScore) {
        bestAnchorScore = score;
        bestAnchorIndex = index;
      }
    }
    if (bestAnchorIndex >= 0) {
      await anchors.nth(bestAnchorIndex).click({ force: true, timeout: 10000 });
      clicked = true;
    }

    if (!clicked && downloadOnclick) {
      await page.evaluate((onclick) => { (new Function(onclick))(); }, downloadOnclick);
      clicked = true;
    } else if (!clicked && downloadHref && isAllowedEclaimUrl(downloadHref)) {
      await page.goto(downloadHref, { waitUntil: 'commit', timeout: 30000 }).catch((error) => {
        if (!String((error as Error).message || error).toLowerCase().includes('download is starting')) throw error;
      });
      clicked = true;
    }

    if (!clicked) throw new Error('ไม่พบลิงก์ดาวน์โหลดของไฟล์นี้บนหน้า eClaim');

    const download = await Promise.race(downloadWaiters);
    if (!download) throw new Error('eClaim ไม่ได้ส่งไฟล์กลับมาภายใน 60 วินาที กรุณาค้นหาไฟล์ใหม่แล้วลองอีกครั้ง');
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('Browser รับไฟล์แล้วแต่ไม่พบไฟล์ชั่วคราว');
    const buffer = await fs.readFile(downloadPath);
    const suggestedName = download.suggestedFilename() || filename || 'eclaim-download';
    return sendBuffer(buffer, suggestedName);
  } catch (error) {
    console.error('eClaim browser download error:', {
      filename,
      downloadHref,
      sourcePage,
      error: (error as Error).message,
    });
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

    const authRes = await fetchWithTimeout(authUrl, {
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
        const listRes = await fetchWithTimeout(searchUrl.toString(), {
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

    const dlRes = await fetchWithTimeout(targetUrl, {
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
      database: isConnected ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.json({
      status: 'ok',
      database: 'unavailable',
      error: 'Database connection test failed',
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api', claimTrackingRouter);

app.use('/api', apiNotFoundHandler);
app.use(apiErrorHandler);

const PORT = Number(process.env.PORT) || 3506;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FDH Checker Server running on port ${PORT}`);
  console.log(`📡 Listening on all interfaces (0.0.0.0)`);
  console.log(`🌐 API Endpoint: http://localhost:${PORT}/api`);
});
