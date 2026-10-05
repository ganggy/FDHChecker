import { Router } from 'express';
import * as XLSX from 'xlsx';
import {
  getOfficialReceivableAgingReport,
  getOfficialClaimControlLedger,
  getOfficialOpdControlRegister,
  getOfficialIpdControlRegister,
  buildOfficialExcelWorkbook,
} from '../officialReceivableReportService.js';
import { OFFICIAL_CHART_OF_ACCOUNTS_54 } from '../officialReceivableConstants.js';

export const officialReceivableRouter = Router();

// รายการผังบัญชีมาตรฐาน 54 ผัง
officialReceivableRouter.get('/accounts', (_req, res) => {
  return res.json({
    success: true,
    data: OFFICIAL_CHART_OF_ACCOUNTS_54,
  });
});

// แบบที่ 1: สรุปลูกหนี้ค่ารักษาพยาบาลแยกตามอายุหนี้ (54 ผังบัญชี)
officialReceivableRouter.get('/aging', async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const data = await getOfficialReceivableAgingReport(month, yearBE);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading official receivable aging report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงานอายุลูกหนี้',
    });
  }
});

// แบบที่ 2: ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล (เรียกเก็บ/ชดเชย/รอผล)
officialReceivableRouter.get('/claim-control', async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;
    const data = await getOfficialClaimControlLedger(month, yearBE, accountCode);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading official claim control ledger:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลทะเบียนคุมลูกหนี้',
    });
  }
});

// แบบที่ 3: ทะเบียนคุมบัญชีลูกหนี้ผู้ป่วยนอก (OP)
officialReceivableRouter.get('/opd-control', async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;
    const data = await getOfficialOpdControlRegister(month, yearBE, accountCode);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading official OPD control register:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลทะเบียนคุมบัญชี OP',
    });
  }
});

// แบบที่ 4: ทะเบียนคุมบัญชีลูกหนี้ผู้ป่วยใน (IP)
officialReceivableRouter.get('/ipd-control', async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;
    const data = await getOfficialIpdControlRegister(month, yearBE, accountCode);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading official IPD control register:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลทะเบียนคุมบัญชี IP',
    });
  }
});

// รวมทุกฟอร์ม
officialReceivableRouter.get('/forms', async (req, res) => {
  try {
    const formType = String(req.query.formType || 'all');
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;

    let f1: any = null;
    let f2: any = null;
    let f3: any = null;
    let f4: any = null;

    if (formType === '1' || formType === 'all') {
      f1 = await getOfficialReceivableAgingReport(month, yearBE);
    }
    if (formType === '2' || formType === 'all') {
      f2 = await getOfficialClaimControlLedger(month, yearBE, accountCode);
    }
    if (formType === '3' || formType === 'all') {
      f3 = await getOfficialOpdControlRegister(month, yearBE, accountCode);
    }
    if (formType === '4' || formType === 'all') {
      f4 = await getOfficialIpdControlRegister(month, yearBE, accountCode);
    }

    return res.json({
      success: true,
      formType,
      data: {
        form1: f1,
        form2: f2,
        form3: f3,
        form4: f4,
      },
    });
  } catch (error) {
    console.error('Error loading official receivable forms:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการดึงข้อมูลแบบฟอร์มทางการ',
    });
  }
});

// ส่งออก Excel รวม 4 ชีต
officialReceivableRouter.get('/export-all-excel', async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const yearBE = req.query.yearBE ? Number(req.query.yearBE) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;

    const [f1, f2, f3, f4] = await Promise.all([
      getOfficialReceivableAgingReport(month, yearBE),
      getOfficialClaimControlLedger(month, yearBE, accountCode),
      getOfficialOpdControlRegister(month, yearBE, accountCode),
      getOfficialIpdControlRegister(month, yearBE, accountCode),
    ]);

    const wb = buildOfficialExcelWorkbook(f1, f2, f3, f4);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeMonth = String(f1.period.month).padStart(2, '0');
    const filename = `receivable_control_official_${f1.period.yearBE}_${safeMonth}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error) {
    console.error('Error generating official receivable excel:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้างไฟล์ Excel แบบฟอร์มทางการ',
    });
  }
});
