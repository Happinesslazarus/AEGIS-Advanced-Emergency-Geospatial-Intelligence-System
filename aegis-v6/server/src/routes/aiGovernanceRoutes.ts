/**
 * AI Governance API surface.
 *
 * Read-only operator endpoints that expose model accuracy, drift, bias,
 * health, classifier circuit-breaker state, and the AI execution audit
 * log. Powers the AITransparencyDashboard.
 *
 * - Mounted at /api in index.ts
 * - All endpoints require operator role
 * - Extracted from extendedRoutes.ts (C3) so the governance surface
 *   lives next to its purpose, not buried in a grab-bag file.
 */
import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.js'
import { requireOperator } from '../middleware/internalAuth.js'
import { asyncRoute } from '../utils/asyncRoute.js'
import {
  computeConfidenceDistribution,
  getExecutionAuditLog,
  getModelMetrics,
  checkModelDrift,
  generateBiasReport,
  checkGovernanceHealth,
} from '../services/governanceEngine.js'
import { getClassifierHealth } from '../services/classifierRouter.js'

const router = Router()

//GET /api/ai/governance/models - accuracy, F1, etc.
router.get('/ai/governance/models', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const metrics = await getModelMetrics()
  res.json(metrics)
}))

//GET /api/ai/governance/drift - model drift detection
router.get('/ai/governance/drift', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const drift = await checkModelDrift()
  res.json(drift)
}))

//GET /api/ai/governance/bias - bias report (location, severity, temporal, language)
router.get('/ai/governance/bias', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const report = await generateBiasReport()
  res.json(report)
}))

//GET /api/ai/governance/health - auto-verifications, flagging rates, backlog
router.get('/ai/governance/health', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const health = await checkGovernanceHealth()
  res.json(health)
}))

//GET /api/ai/classifier/health - circuit breaker status for HF classifiers
router.get('/ai/classifier/health', authMiddleware, requireOperator, asyncRoute(async (_req: AuthRequest, res: Response) => {
  const health = getClassifierHealth()
  res.json({ models: health, timestamp: new Date().toISOString() })
}))

//GET /api/ai/confidence-distribution - computed from real predictions
router.get('/ai/confidence-distribution', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
  const { model } = req.query
  const distribution = await computeConfidenceDistribution(model as string | undefined)
  res.json(distribution)
}))

//GET /api/ai/audit - AI execution audit log
router.get('/ai/audit', authMiddleware, requireOperator, asyncRoute(async (req: AuthRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50
  const offset = parseInt(req.query.offset as string) || 0
  const model = req.query.model as string | undefined
  const result = await getExecutionAuditLog(limit, offset, model)
  res.json(result)
}))

export default router
