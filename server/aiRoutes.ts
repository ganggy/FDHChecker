import { Router } from 'express';
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
  rememberConversationExchange,
} from './aiConversationalAgent.js';

export const aiRouter = Router();

aiRouter.get('/status', async (_req, res) => {
  const ai = await getAiStatus();
  const vault = getKnowledgeVault().status();
  res.json({ ai, vault, auth: getAiAuthStatus(_req) });
});

aiRouter.post('/session', aiLoginRateLimit, createAiSession);
aiRouter.post('/session/auto', createTrustedAiSession);
aiRouter.delete('/session', clearAiSession);

aiRouter.post('/chat', requireAiAuth, aiRequestRateLimit, aiAuditTrail, async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const suppliedConversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  const conversationId = /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedConversationId) ? suppliedConversationId : 'default';
  const conversationKey = `${String(res.locals.aiAccessIdentity || 'unknown')}:${conversationId}`;
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 2_000) return res.status(400).json({ error: 'question is too long' });

  try {
    const operationalIntent = parseOperationalIntent(question);
    if (operationalIntent) {
      const result = await answerOperationalQuestion(operationalIntent);
      rememberConversationExchange(conversationKey, question, result.answer);
      return res.json(result);
    }
    const reportIntent = parsePatientReportIntent(question);
    if (reportIntent) {
      const result = await answerPatientReportQuestion(reportIntent);
      rememberConversationExchange(conversationKey, question, result.answer);
      return res.json(result);
    }

    const dynamicResult = await answerConversationalDataQuestion(question, conversationKey);
    if (dynamicResult) return res.json(dynamicResult);

    const matches = await getKnowledgeVault().search(
      question,
      Math.min(8, Math.max(1, Number(process.env.VAULT_TOP_K) || 5)),
    );
    if (!matches.length) {
      const answer = await answerGeneralConversation(question);
      rememberConversationExchange(conversationKey, question, answer);
      return res.json({ answer });
    }
    const answer = await answerGroundedQuestion(question, matches);
    rememberConversationExchange(conversationKey, question, answer);
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
