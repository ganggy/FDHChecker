import { Router } from 'express';
import {
  getSsjRawServReportFromDb,
  generateSsjRawServExcelBuffer,
} from '../ssjRawServService.js';

export const ssjRawServRouter = Router();

// GET report data as JSON
ssjRawServRouter.get('/', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').slice(0, 10);
    const endDate = String(req.query.endDate || startDate || '').slice(0, 10);

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุ startDate และ endDate (YYYY-MM-DD)',
      });
    }

    const report = await getSsjRawServReportFromDb({ startDate, endDate });
    return res.json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    console.error('[SSJ RawServ Report Error]', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'เกิดข้อผิดพลาดในการดึงข้อมูลรายงาน สสจ. RawServ',
    });
  }
});

// GET export Excel file
ssjRawServRouter.get('/export-excel', async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '').slice(0, 10);
    const endDate = String(req.query.endDate || startDate || '').slice(0, 10);
    const requestedFilename = String(req.query.filename || 'template_ข้อมูลบริการ.xlsx');

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุ startDate และ endDate (YYYY-MM-DD)',
      });
    }

    const report = await getSsjRawServReportFromDb({ startDate, endDate });
    const buffer = generateSsjRawServExcelBuffer(report.rows);

    const filename = requestedFilename.endsWith('.xlsx')
      ? requestedFilename
      : `${requestedFilename}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    return res.send(buffer);
  } catch (error: any) {
    console.error('[SSJ RawServ Export Error]', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'เกิดข้อผิดพลาดในการส่งออกไฟล์ Excel สสจ.',
    });
  }
});
