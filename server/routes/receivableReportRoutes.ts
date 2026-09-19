import { Router } from 'express';
import {
  getHospitalInfo,
  getDebtorOpdSummary,
  getPttypeOpdSummary,
  getPttypeIpdSummary,
  getDetailedOpd,
  getDetailedIpd,
} from '../receivableReportService.js';
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
        reportType: '2',
        title: 'รายงานบัญชีลูกหนี้ แยกตามสิทธิการรักษา ผู้ป่วยนอก',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '3') {
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
        reportType: '3',
        title: 'รายงานบัญชีลูกหนี้ แยกตามสิทธิการรักษา ผู้ป่วยใน',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '4') {
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
        reportType: '4',
        title: 'รายงานค่ารักษาพยาบาลลูกหนี้ผู้ป่วยนอก แบบแจกแจงรายละเอียด',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    if (reportType === '5') {
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
        reportType: '5',
        title: 'รายงานค่ารักษาพยาบาลลูกหนี้ผู้ป่วยใน แบบแจกแจงรายละเอียด',
        hospital,
        signers,
        startDate,
        endDate,
        data,
        totals,
      });
    }

    return res.status(400).json({ success: false, error: 'ไม่พบประเภทรายงานที่ระบุ (รองรับ 1-5)' });
  } catch (error) {
    console.error('Error generating receivable print report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการสร้างรายงานลูกหนี้',
    });
  }
});
