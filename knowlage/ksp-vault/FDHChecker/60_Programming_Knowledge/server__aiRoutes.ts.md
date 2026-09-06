---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/aiRoutes.ts"
source_hash: "fc613e6f8d080085b78e6fee676270136962d01e5aecd53d7639b83e42f1f4c5"
managed_by: "sync-ksp-vault"
---
# aiRoutes.ts

> Source: `server/aiRoutes.ts`
> SHA-256: `fc613e6f8d080085b78e6fee676270136962d01e5aecd53d7639b83e42f1f4c5`

````typescript
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
  parsePatientTopicFollowup,
  type PatientReportIntent,
} from './aiReportTools.js';
import { answerOperationalQuestion, parseOperationalIntent, type OperationalIntent } from './aiOperationalTools.js';
import {
  answerConversationalDataQuestion,
  clearConversationState,
  exportLastDynamicQuery,
  getConversationExchange,
  getConversationHistory,
  getConversationLastAction,
  getConversationPatientContext,
  getConversationUiContext,
  parseFormatOnlyFollowup,
  rememberConversationExchange,
  setConversationLastAction,
  setConversationPatientContext,
} from './aiConversationalAgent.js';
import {
  listAiLearningExamples,
  recordAiFeedback,
  setAiLearningExampleStatus,
  type AiFeedbackRating,
} from './aiLearningStore.js';
import { answerVaultManagementQuestion, isVaultManagementQuestion } from './aiVaultAgent.js';
import {
  buildKspVaultExport,
  getKspVaultStatus,
  saveManagedVaultNote,
  type KspVaultCategory,
} from './kspVaultManager.js';
import { answerAiCapabilityQuestion, parseAiCapabilityQuestion } from './aiCapabilityHelp.js';
import { answerErrorAnalysisQuestion, parseErrorAnalysisIntent } from './aiErrorTools.js';
import {
  parseHospitalReportIntent,
  runHospitalReport,
  type HospitalReportRequest,
} from './hospitalReportTools.js';

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
  const kspVault = await getKspVaultStatus().catch(() => null);
  res.json({ ai, vault, kspVault, auth: getAiAuthStatus(_req) });
});

aiRouter.post('/session', aiLoginRateLimit, createAiSession);
aiRouter.post('/session/auto', createTrustedAiSession);
aiRouter.delete('/session', clearAiSession);

aiRouter.post('/conversation/reset', requireAiAuth, (req, res) => {
  clearConversationState(conversationKey(req, res));
  return res.json({ reset: true, context: {} });
});

aiRouter.get('/vault/search', requireAiAuth, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.status(400).json({ error: 'q is required' });
  return res.json({ matches: await getKnowledgeVault().search(query, Math.min(20, Number(req.query.limit) || 5)) });
});

aiRouter.post('/vault/note', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req: AppAuthenticatedRequest, res) => {
  try {
    const saved = await saveManagedVaultNote({
      title: String(req.body?.title || ''),
      content: String(req.body?.content || ''),
      category: String(req.body?.category || 'general') as KspVaultCategory,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [],
      actor: req.authUser?.username || String(res.locals.aiAccessIdentity || ''),
      source: 'api',
      stableId: typeof req.body?.stableId === 'string' ? req.body.stableId : undefined,
    });
    await getKnowledgeVault().reindex(true);
    return res.json({ saved: true, note: saved });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

aiRouter.post('/vault/reindex', requireAiAuth, async (_req, res) => (
  res.json({ vault: await getKnowledgeVault().reindex(true) })
));

aiRouter.get('/vault/export', requireAiAuth, async (_req, res) => {
  const buffer = await buildKspVaultExport();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="FDHChecker-ksp-vault.zip"');
  return res.send(buffer);
});

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

aiRouter.post('/chat', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req: AppAuthenticatedRequest, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const currentConversationKey = conversationKey(req, res);
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 2_000) return res.status(400).json({ error: 'question is too long' });
  const reply = (payload: Record<string, unknown>) => res.json({
    ...payload,
    context: getConversationUiContext(currentConversationKey),
  });

  try {
    const capabilityTopic = parseAiCapabilityQuestion(question);
    if (capabilityTopic) {
      const answer = answerAiCapabilityQuestion(capabilityTopic);
      rememberConversationExchange(currentConversationKey, question, answer);
      return reply({ answer });
    }
    if (isVaultManagementQuestion(question)) {
      const result = await answerVaultManagementQuestion(
        question,
        req.authUser?.username || String(res.locals.aiAccessIdentity || ''),
      );
      await getKnowledgeVault().reindex(true);
      rememberConversationExchange(currentConversationKey, question, result.answer);
      return reply(result);
    }
    const formatOnly = parseFormatOnlyFollowup(question);
    if (formatOnly) {
      const lastAction = getConversationLastAction(currentConversationKey);
      if (!lastAction) {
        const answer = 'ยังไม่มีรายงานล่าสุดสำหรับส่งออก กรุณาขอข้อมูลหรือรายงานก่อน แล้วพิมพ์ “เอาเป็น Excel” ได้ทันที';
        rememberConversationExchange(currentConversationKey, question, answer);
        return reply({ answer, needsClarification: true });
      }
      if (lastAction.kind === 'patient-report') {
        const intent = { ...(lastAction.payload as PatientReportIntent), format: formatOnly } as PatientReportIntent;
        const result = await answerPatientReportQuestion(intent);
        rememberConversationExchange(currentConversationKey, question, result.answer);
        setConversationLastAction(currentConversationKey, {
          kind: 'patient-report', label: lastAction.label, payload: intent as unknown as Record<string, unknown>,
        });
        return reply(result);
      }
      if (lastAction.kind === 'operational') {
        const intent = { ...(lastAction.payload as OperationalIntent), format: formatOnly } as OperationalIntent;
        const result = await answerOperationalQuestion(intent);
        rememberConversationExchange(currentConversationKey, question, result.answer);
        setConversationLastAction(currentConversationKey, {
          kind: 'operational', label: lastAction.label, payload: intent as unknown as Record<string, unknown>,
        });
        return reply(result);
      }
      if (lastAction.kind === 'hospital-report') {
        const intent = { ...(lastAction.payload as HospitalReportRequest), format: formatOnly };
        const result = await runHospitalReport(intent);
        const title = 'title' in result ? result.title : 'รายงานโรงพยาบาล';
        rememberConversationExchange(currentConversationKey, question, result.answer);
        setConversationLastAction(currentConversationKey, {
          kind: 'hospital-report', label: title, payload: intent as unknown as Record<string, unknown>,
        });
        return reply(result);
      }
      const result = await exportLastDynamicQuery(currentConversationKey, formatOnly);
      if (result) return reply(result);
    }
    const hospitalReportIntent = parseHospitalReportIntent(question);
    if (hospitalReportIntent) {
      const result = await runHospitalReport(hospitalReportIntent);
      const title = 'title' in result ? result.title : 'รายงานโรงพยาบาล';
      rememberConversationExchange(currentConversationKey, question, result.answer);
      setConversationLastAction(currentConversationKey, {
        kind: 'hospital-report', label: title,
        payload: hospitalReportIntent as unknown as Record<string, unknown>,
      });
      return reply({
        ...result,
        knowledge: {
          status: 'verified-template',
          message: 'ใช้ต้นแบบที่ตรวจสอบแล้วจาก FDHChecker Vault; feedback จะถูกเก็บเพื่อปรับรุ่นถัดไป',
        },
      });
    }
    const operationalIntent = parseOperationalIntent(question);
    if (operationalIntent) {
      const result = await answerOperationalQuestion(operationalIntent);
      rememberConversationExchange(currentConversationKey, question, result.answer);
      setConversationLastAction(currentConversationKey, {
        kind: 'operational', label: `รายงานงานระบบ ${operationalIntent.date}`,
        payload: operationalIntent as unknown as Record<string, unknown>,
      });
      return reply(result);
    }
    const errorIntent = parseErrorAnalysisIntent(question);
    if (errorIntent) {
      const result = await answerErrorAnalysisQuestion(errorIntent);
      rememberConversationExchange(currentConversationKey, question, result.answer);
      return reply(result);
    }
    const reportIntent = parsePatientReportIntent(question);
    if (reportIntent) {
      const result = await answerPatientReportQuestion(reportIntent);
      if (reportIntent.kind === 'patient-lookup' || reportIntent.kind === 'visit-detail') {
        setConversationPatientContext(
          currentConversationKey,
          result.report.resolvedHn
            ? { hn: result.report.resolvedHn, patientName: result.report.patientName }
            : null,
        );
      }
      rememberConversationExchange(currentConversationKey, question, result.answer);
      if (!result.needsClarification) {
        const storedIntent: PatientReportIntent = reportIntent.kind === 'patient-lookup' && result.report.resolvedHn
          ? {
            ...reportIntent,
            identifierType: 'hn',
            identifier: result.report.resolvedHn,
          }
          : reportIntent;
        setConversationLastAction(currentConversationKey, {
          kind: 'patient-report',
          label: result.report.patientName
            ? `${result.report.patientName} (HN ${result.report.resolvedHn || ('identifier' in reportIntent ? reportIntent.identifier : '')})`
            : 'รายงานผู้ป่วยล่าสุด',
          payload: storedIntent as unknown as Record<string, unknown>,
        });
      }
      return reply(result);
    }

    const patientTopicFollowup = parsePatientTopicFollowup(question);
    if (patientTopicFollowup?.topic) {
      const patient = getConversationPatientContext(currentConversationKey);
      if (!patient) {
        const answer = 'เพื่อป้องกันการแสดงข้อมูลผิดคน กรุณาระบุ HN ของผู้ป่วยก่อน เช่น “ขอผลแล็บ HN 000123456”';
        rememberConversationExchange(currentConversationKey, question, answer);
        return reply({ answer, needsClarification: true });
      }
      const result = await answerPatientReportQuestion({
        kind: 'patient-lookup',
        identifierType: 'hn',
        identifier: patient.hn,
        topic: patientTopicFollowup.topic,
        ...(patientTopicFollowup.format ? { format: patientTopicFollowup.format } : {}),
      });
      setConversationPatientContext(currentConversationKey, {
        hn: result.report.resolvedHn || patient.hn,
        patientName: result.report.patientName || patient.patientName,
      });
      rememberConversationExchange(currentConversationKey, question, result.answer);
      const intent: PatientReportIntent = {
        kind: 'patient-lookup', identifierType: 'hn', identifier: patient.hn,
        topic: patientTopicFollowup.topic,
        ...(patientTopicFollowup.format ? { format: patientTopicFollowup.format } : {}),
      };
      setConversationLastAction(currentConversationKey, {
        kind: 'patient-report',
        label: `${result.report.patientName || patient.patientName || 'ผู้ป่วย'} (HN ${result.report.resolvedHn || patient.hn})`,
        payload: intent as unknown as Record<string, unknown>,
      });
      return reply(result);
    }

    const matches = await getKnowledgeVault().search(
      question,
      Math.min(5, Math.max(1, Number(process.env.VAULT_TOP_K) || 3)),
    );
    const vaultContext = matches.map((match, index) => (
      `[${index + 1}] ${match.source} > ${match.heading}\n${match.content.slice(0, 1_600)}`
    )).join('\n\n');
    const dynamicResult = await answerConversationalDataQuestion(question, currentConversationKey, vaultContext);
    if (dynamicResult) return reply(dynamicResult);

    if (!matches.length) {
      const answer = await answerGeneralConversation(question, getConversationHistory(currentConversationKey));
      rememberConversationExchange(currentConversationKey, question, answer);
      return reply({ answer });
    }
    const answer = await answerGroundedQuestion(question, matches, getConversationHistory(currentConversationKey));
    rememberConversationExchange(currentConversationKey, question, answer);
    return reply({
      answer,
      sources: matches.map((match, index) => ({
        id: index + 1,
        source: match.source,
        heading: match.heading,
      })),
    });
  } catch (error) {
    console.error('Local AI chat error:', error);
    const message = (error as Error).message;
    const safeMessage = /context size|exceed_context_size|บริบท AI ยาวเกิน/i.test(message)
      ? 'บทสนทนายาวเกินขนาดที่ AI รองรับ ระบบพยายามย่อให้อัตโนมัติแล้ว กรุณากด “บทสนทนาใหม่” แล้วส่งคำขออีกครั้ง'
      : /timeout|aborted/i.test(message)
        ? 'AI ใช้เวลาประมวลผลนานเกินกำหนด กรุณาลองใหม่อีกครั้ง'
        : /Ollama|ECONNREFUSED|fetch failed/i.test(message)
          ? 'ไม่สามารถเชื่อมต่อ Local AI ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง'
          : message;
    return res.status(503).json({ error: safeMessage });
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

````
