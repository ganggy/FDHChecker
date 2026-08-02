import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  answerGeneralConversation,
  answerGroundedQuestion,
  getAiStatus,
  getKnowledgeVault,
  summarizeReport,
  type ReportSummaryInput,
} from './aiService.js';
import {
  aiLoginRateLimit,
  aiAuditTrail,
  aiRequestRateLimit,
  clearAiSession,
  createAiSession,
  createTrustedAiSession,
  getAiAuthStatus,
  requireAiAuth,
} from './aiAuth.js';
import {
  answerPatientReportQuestion,
  parsePatientReportIntent,
} from './aiReportTools.js';
import { answerOperationalQuestion, parseOperationalIntent } from './aiOperationalTools.js';
import {
  answerConversationalDataQuestion,
  getConversationExchange,
  rememberConversationExchange,
} from './aiConversationalAgent.js';
import {
  listAiLearningExamples,
  recordAiFeedback,
  setAiLearningExampleStatus,
  type AiFeedbackRating,
} from './aiLearningStore.js';

export const aiRouter = Router();

type AppAuthenticatedRequest = Request & {
  authUser?: { id?: number; username?: string; is_admin?: number | boolean; group_is_admin?: number | boolean };
};

const suppliedConversationId = (req: Request) => {
  const supplied = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  return /^[a-zA-Z0-9_-]{8,80}$/.test(supplied) ? supplied : 'default';
};

const conversationKey = (req: Request, res: Response) => (
  `${String(res.locals.aiAccessIdentity || 'unknown')}:${suppliedConversationId(req)}`
);

const requireLearningAdmin = (req: AppAuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.authUser?.is_admin || req.authUser?.group_is_admin) return next();
  return res.status(403).json({ error: 'ต้องเป็นผู้ดูแลระบบจึงจะอนุมัติชุดเรียนรู้ได้' });
};

aiRouter.get('/status', async (_req, res) => {
  const ai = await getAiStatus();
  const vault = getKnowledgeVault().status();
  res.json({ ai, vault, auth: getAiAuthStatus(_req) });
});

aiRouter.post('/session', aiLoginRateLimit, createAiSession);
aiRouter.post('/session/auto', createTrustedAiSession);
aiRouter.delete('/session', clearAiSession);

aiRouter.post('/feedback', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req: AppAuthenticatedRequest, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const rating = String(req.body?.rating || '') as AiFeedbackRating;
  const correction = typeof req.body?.correction === 'string' ? req.body.correction.trim() : '';
  if (!question || !['correct', 'incorrect', 'remember'].includes(rating)) {
    return res.status(400).json({ error: 'question และ rating ไม่ถูกต้อง' });
  }
  if (correction.length > 4_000) return res.status(400).json({ error: 'คำแก้ไขยาวเกิน 4,000 ตัวอักษร' });
  const entry = getConversationExchange(conversationKey(req, res), question);
  if (!entry) return res.status(404).json({ error: 'ไม่พบคำถามนี้ในบทสนทนาปัจจุบัน' });
  try {
    const result = await recordAiFeedback({
      question: entry.question, answer: entry.answer, sql: entry.sql, title: entry.title,
      rating, correction, actor: req.authUser?.username || String(res.locals.aiAccessIdentity || ''),
    });
    return res.json({
      saved: true, learned: result.learned, status: result.status,
      positiveCount: result.positiveCount, negativeCount: result.negativeCount,
      message: result.learned
        ? 'บันทึกเป็นตัวอย่างเรียนรู้แล้ว และจะใช้กับคำถามที่คล้ายกันครั้งถัดไป'
        : 'บันทึก feedback แล้ว ตัวอย่างจะถูกใช้เมื่อผ่านเกณฑ์หรือผู้ดูแลอนุมัติ',
    });
  } catch (error) {
    console.error('Cannot save AI feedback:', error);
    return res.status(503).json({ error: 'บันทึก feedback ไม่สำเร็จ' });
  }
});

aiRouter.get('/learning/examples', requireAiAuth, requireLearningAdmin, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  return res.json({ examples: await listAiLearningExamples(status, Number(req.query.limit) || 100) });
});

aiRouter.patch('/learning/examples/:id', requireAiAuth, requireLearningAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!Number.isInteger(id) || id < 1 || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'id หรือ status ไม่ถูกต้อง' });
  }
  const updated = await setAiLearningExampleStatus(id, status as 'approved' | 'rejected');
  return res.status(updated ? 200 : 404).json({ updated, id, status });
});

aiRouter.post('/chat', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const currentConversationKey = conversationKey(req, res);
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 2_000) return res.status(400).json({ error: 'question is too long' });

  try {
    const operationalIntent = parseOperationalIntent(question);
    if (operationalIntent) {
      const result = await answerOperationalQuestion(operationalIntent);
      rememberConversationExchange(currentConversationKey, question, result.answer);
      return res.json(result);
    }
    const reportIntent = parsePatientReportIntent(question);
    if (reportIntent) {
      const result = await answerPatientReportQuestion(reportIntent);
      rememberConversationExchange(currentConversationKey, question, result.answer);
      return res.json(result);
    }

    const dynamicResult = await answerConversationalDataQuestion(question, currentConversationKey);
    if (dynamicResult) return res.json(dynamicResult);

    const matches = await getKnowledgeVault().search(
      question,
      Math.min(8, Math.max(1, Number(process.env.VAULT_TOP_K) || 5)),
    );
    if (!matches.length) {
      const answer = await answerGeneralConversation(question);
      rememberConversationExchange(currentConversationKey, question, answer);
      return res.json({ answer });
    }
    const answer = await answerGroundedQuestion(question, matches);
    rememberConversationExchange(currentConversationKey, question, answer);
    return res.json({
      answer,
      sources: matches.map((match, index) => ({
        id: index + 1,
        source: match.source,
        heading: match.heading,
      })),
    });
  } catch (error) {
    console.error('Local AI chat error:', error);
    return res.status(503).json({ error: (error as Error).message });
  }
});

aiRouter.post('/summarize-report', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req, res) => {
  try {
    const summary = await summarizeReport(req.body as ReportSummaryInput);
    return res.json({ summary });
  } catch (error) {
    const message = (error as Error).message;
    const isValidationError = /required|must|limit|large|sensitive|not allowed/i.test(message);
    return res.status(isValidationError ? 400 : 503).json({ error: message });
  }
});
