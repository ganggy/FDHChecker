import { Router } from 'express';
import * as XLSX from 'xlsx';
import {
  getHospitalInfo,
  getDebtorOpdSummary,
  getDebtorIpdSummary,
  getPttypeOpdSummary,
  getPttypeIpdSummary,
  getDetailedOpd,
  getDetailedIpd,
} from '../receivableReportService.js';
import {
  getOfficialReceivableAgingReport,
  getOfficialClaimControlLedger,
  getOfficialOpdControlRegister,
  getOfficialIpdControlRegister,
  buildOfficialExcelWorkbook,
} from '../officialReceivableReportService.js';
import { OFFICIAL_CHART_OF_ACCOUNTS_54 } from '../officialReceivableConstants.js';
import { getAppSetting } from '../db.js';

export const receivableReportRouter = Router();

receivableReportRouter.get('/print-report', async (req, res) => {
  try {
    const reportType = String(req.query.reportType || '1');
    const startDate = String(req.query.startDate || '').slice(0, 10);
    const endDate = String(req.query.endDate || startDate || '').slice(0, 10);
    const pttype = req.query.pttype ? String(req.query.pttype) : undefined;
    const debtorCode = req.query.debtorCode ? String(req.query.debtorCode) : undefined;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุช่วงวันที่เริ่มต้นและสิ้นสุด' });
    }

    const hospital = await getHospitalInfo();
    const siteSettings = await getAppSetting<Record<string, unknown>>('site_settings').catch(() => null);
    const signers = (siteSettings?.receivable_signers || null) as Record<string, { name?: string; position?: string }> | null;

    if (reportType === '1') {
      const data = await getDebtorOpdSummary(startDate, endDate);
      const totals = data.reduce(
        (acc, item) => {
          acc.patientCount += item.patientCount;
          acc.visitCount += item.visitCount;
          acc.newCount += item.newCount;
          acc.oldCount += item.oldCount;
          acc.inCupCount += item.inCupCount;
          acc.outCupCount += item.outCupCount;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          patientCount: 0,
          visitCount: 0,
          newCount: 0,
          oldCount: 0,
          inCupCount: 0,
          outCupCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '1',
        title: 'รายงานบัญชีลูกหนี้ สรุปรวมสิทธิการรักษา ผู้ป่วยนอก',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '2') {
      const data = await getDebtorIpdSummary(startDate, endDate);
      const totals = data.reduce(
        (acc, item) => {
          acc.patientCount += item.patientCount;
          acc.visitCount += item.visitCount;
          acc.losDays += item.losDays;
          acc.newCount += item.newCount;
          acc.oldCount += item.oldCount;
          acc.inCupCount += item.inCupCount;
          acc.outCupCount += item.outCupCount;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          patientCount: 0,
          visitCount: 0,
          losDays: 0,
          newCount: 0,
          oldCount: 0,
          inCupCount: 0,
          outCupCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '2',
        title: 'รายงานบัญชีลูกหนี้ สรุปรวมสิทธิการรักษา ผู้ป่วยใน',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '3') {
      const data = await getPttypeOpdSummary(startDate, endDate);
      const totals = data.reduce(
        (acc, item) => {
          acc.patientCount += item.patientCount;
          acc.visitCount += item.visitCount;
          acc.newCount += item.newCount;
          acc.oldCount += item.oldCount;
          acc.inCupCount += item.inCupCount;
          acc.outCupCount += item.outCupCount;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          patientCount: 0,
          visitCount: 0,
          newCount: 0,
          oldCount: 0,
          inCupCount: 0,
          outCupCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '3',
        title: 'รายงานบัญชีลูกหนี้ แยกตามสิทธิการรักษา ผู้ป่วยนอก',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '4') {
      const data = await getPttypeIpdSummary(startDate, endDate);
      const totals = data.reduce(
        (acc, item) => {
          acc.patientCount += item.patientCount;
          acc.visitCount += item.visitCount;
          acc.newCount += item.newCount;
          acc.oldCount += item.oldCount;
          acc.inCupCount += item.inCupCount;
          acc.outCupCount += item.outCupCount;
          acc.losDays += item.losDays;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          patientCount: 0,
          visitCount: 0,
          newCount: 0,
          oldCount: 0,
          inCupCount: 0,
          outCupCount: 0,
          losDays: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '4',
        title: 'รายงานบัญชีลูกหนี้ แยกตามสิทธิการรักษา ผู้ป่วยใน',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '5') {
      const data = await getDetailedOpd(startDate, endDate, pttype, debtorCode);
      const totals = data.reduce(
        (acc, item) => {
          acc.incProsthesis += item.incProsthesis;
          acc.incMedicine += item.incMedicine;
          acc.incLab += item.incLab;
          acc.incXray += item.incXray;
          acc.incSpecialDiag += item.incSpecialDiag;
          acc.incEquipment += item.incEquipment;
          acc.incOperation += item.incOperation;
          acc.incNursing += item.incNursing;
          acc.incDental += item.incDental;
          acc.incPhysical += item.incPhysical;
          acc.incTraditional += item.incTraditional;
          acc.incOther += item.incOther;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          incProsthesis: 0,
          incMedicine: 0,
          incLab: 0,
          incXray: 0,
          incSpecialDiag: 0,
          incEquipment: 0,
          incOperation: 0,
          incNursing: 0,
          incDental: 0,
          incPhysical: 0,
          incTraditional: 0,
          incOther: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '5',
        title: 'รายงานค่ารักษาพยาบาลลูกหนี้ผู้ป่วยนอก แบบแจกแจงรายละเอียด',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '6') {
      const data = await getDetailedIpd(startDate, endDate, pttype, debtorCode);
      const totals = data.reduce(
        (acc, item) => {
          acc.incRoomBoard += item.incRoomBoard;
          acc.incProsthesis += item.incProsthesis;
          acc.incMedicine += item.incMedicine;
          acc.incLab += item.incLab;
          acc.incXray += item.incXray;
          acc.incSpecialDiag += item.incSpecialDiag;
          acc.incEquipment += item.incEquipment;
          acc.incOperation += item.incOperation;
          acc.incNursing += item.incNursing;
          acc.incDental += item.incDental;
          acc.incPhysical += item.incPhysical;
          acc.incTraditional += item.incTraditional;
          acc.incOther += item.incOther;
          acc.totalAmount += item.totalAmount;
          acc.paidAmount += item.paidAmount;
          acc.remainAmount += item.remainAmount;
          return acc;
        },
        {
          incRoomBoard: 0,
          incProsthesis: 0,
          incMedicine: 0,
          incLab: 0,
          incXray: 0,
          incSpecialDiag: 0,
          incEquipment: 0,
          incOperation: 0,
          incNursing: 0,
          incDental: 0,
          incPhysical: 0,
          incTraditional: 0,
          incOther: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainAmount: 0,
        }
      );

      return res.json({
        success: true,
        reportType: '6',
        title: 'รายงานค่ารักษาพยาบาลลูกหนี้ผู้ป่วยใน แบบแจกแจงรายละเอียด',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    return res.status(400).json({ success: false, error: 'ไม่พบประเภทรายงานที่ระบุ (รองรับ 1-6)' });
  } catch (error) {
    console.error('Error generating receivable print report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้างรายงานลูกหนี้',
    });
  }
});

// รายการผังบัญชีมาตรฐาน 54 ผัง
receivableReportRouter.get('/official-accounts', (_req, res) => {
  return res.json({
    success: true,
    data: OFFICIAL_CHART_OF_ACCOUNTS_54,
  });
});

// ข้อมูล 4 ฟอร์มทางการ
receivableReportRouter.get('/official-forms', async (req, res) => {
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
receivableReportRouter.get('/official-excel', async (req, res) => {
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

