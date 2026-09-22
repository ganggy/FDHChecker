import { Router } from 'express';
import {
  getAvailableStatements,
  getStatementSettlementCandidates,
  executeSettlement,
  getSettlementHistory,
  getSettlementVoucher,
} from '../receivableSettlementService.js';

export const receivableSettlementRouter = Router();

// GET /api/receivables/settlement/statements
receivableSettlementRouter.get('/statements', async (req, res) => {
  try {
    const payerType = req.query.payerType ? String(req.query.payerType) : undefined;
    const statements = await getAvailableStatements(payerType);
    return res.json({ success: true, data: statements });
  } catch (error) {
    console.error('Error fetching settlement statements:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูล Statement ได้',
    });
  }
});

// GET /api/receivables/settlement/candidates
receivableSettlementRouter.get('/candidates', async (req, res) => {
  try {
    const statementNo = String(req.query.statementNo || '').trim();
    if (!statementNo) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ Statement No.' });
    }
    const result = await getStatementSettlementCandidates(statementNo);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching settlement candidates:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถคำนวณข้อมูลตัดลูกหนี้ได้',
    });
  }
});

// POST /api/receivables/settlement/execute
receivableSettlementRouter.post('/execute', async (req, res) => {
  try {
    const result = await executeSettlement(req.body || {});
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error executing settlement:', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'บันทึกตัดลูกหนี้ไม่สำเร็จ',
    });
  }
});

// GET /api/receivables/settlement/history
receivableSettlementRouter.get('/history', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const history = await getSettlementHistory(limit);
    return res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error fetching settlement history:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงประวัติการตัดลูกหนี้ได้',
    });
  }
});

// GET /api/receivables/settlement/voucher/:id
receivableSettlementRouter.get('/voucher/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'รหัสใบสำคัญไม่ถูกต้อง' });
    }
    const voucher = await getSettlementVoucher(id);
    return res.json({ success: true, data: voucher });
  } catch (error) {
    console.error('Error fetching settlement voucher:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'ไม่สามารถดึงข้อมูลใบสำคัญได้',
    });
  }
});
