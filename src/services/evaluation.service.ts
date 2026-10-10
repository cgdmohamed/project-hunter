import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { AppDb } from '../database/client.js';
import { analyses, type AnalysisRow, type NewAnalysisRow, type ProjectRow } from '../database/schema.js';
import type { EvaluationCall, EvaluationResponse } from '../integrations/openai.js';
import type { AnalysisResult } from '../types/project.js';
import { nowIso } from '../utils/date.js';
import type { Metrics } from '../utils/metrics.js';
import type { NormalizationService } from './normalization.service.js';

export interface ProjectAnalyzer {
  analyzeProject(input: {
    title: string | null;
    description: string | null;
    category: string | null;
    skills: string[] | null;
    budgetRange: string;
  }): Promise<EvaluationCall>;
}

export interface AnalysisOutcome {
  analysis: AnalysisRow;
  score: number;
  qualified: boolean;
}

export function parseSkills(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((s) => String(s)) : null;
  } catch {
    return null;
  }
}

/** Overall score is the sum of criterion scores, clamped to [0,100]. */
export function computeScore(response: EvaluationResponse): number {
  const { criteria } = response;
  const sum =
    criteria.capabilityMatch +
    criteria.financialViability +
    criteria.requirementsClarity +
    criteria.deliveryFeasibility +
    criteria.riskFactor;
  return Math.max(0, Math.min(100, Math.round(sum * 100) / 100));
}

export class EvaluationService {
  constructor(
    private readonly db: AppDb,
    private readonly config: AppConfig,
    private readonly analyzer: ProjectAnalyzer,
    private readonly normalization: NormalizationService,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  get threshold(): number {
    return this.config.MIN_PROJECT_SCORE;
  }

  async analyze(project: ProjectRow): Promise<AnalysisOutcome> {
    const skills = parseSkills(project.skills);
    const budgetRange = this.normalization.displayBudget(project);

    let call: EvaluationCall;
    try {
      call = await this.analyzer.analyzeProject({
        title: project.title,
        description: project.description,
        category: project.category,
        skills,
        budgetRange,
      });
    } catch (error) {
      this.metrics.openaiFailures += 1;
      throw error;
    }

    this.metrics.recordOpenAi({
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      estimatedCost: call.estimatedCost,
    });

    const score = computeScore(call.result);
    const now = nowIso();

    const values: NewAnalysisRow = {
      projectId: project.id,
      score,
      category: call.result.category,
      summary: call.result.summary,
      businessProblem: call.result.businessProblem,
      technicalSuitability: call.result.technicalSuitability,
      suitabilityReasons: JSON.stringify([call.result.relevanceReason]),
      financialViability: call.result.financialViabilityComment,
      risks: JSON.stringify(call.result.risks),
      missingRequirements: JSON.stringify(call.result.missingRequirements),
      clarificationQuestions: JSON.stringify(call.result.clarificationQuestions),
      recommendedApproach: call.result.recommendedApproach,
      estimatedDuration: call.result.estimatedDuration,
      recommendedPrice: call.result.suggestedBid,
      confidence: call.result.confidence,
      model: this.config.OPENAI_MODEL,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      estimatedCost: call.estimatedCost,
      contentHash: project.contentHash,
      analyzedAt: now,
    };

    const analysis = this.db.insert(analyses).values(values).returning().get();
    const qualified = score >= this.threshold;

    this.metrics.projectsAnalyzed += 1;
    if (qualified) this.metrics.projectsQualified += 1;
    else this.metrics.projectsRejected += 1;

    this.logger.info(
      { projectId: project.id, score, qualified, model: this.config.OPENAI_MODEL },
      'project analyzed',
    );

    return { analysis, score, qualified };
  }

  /** Builds the AnalysisResult view used by the proposal generator/notifier. */
  static toView(analysis: AnalysisRow): AnalysisResult {
    return {
      score: analysis.score,
      category: analysis.category ?? 'general',
      summary: analysis.summary ?? '',
      businessProblem: analysis.businessProblem ?? '',
      technicalSuitability: analysis.technicalSuitability ?? '',
      suitabilityReasons: safeArray(analysis.suitabilityReasons),
      financialViability: analysis.financialViability ?? '',
      risks: safeArray(analysis.risks),
      missingRequirements: safeArray(analysis.missingRequirements),
      clarificationQuestions: safeArray(analysis.clarificationQuestions),
      recommendedApproach: analysis.recommendedApproach ?? '',
      estimatedDuration: analysis.estimatedDuration ?? '',
      recommendedPrice: analysis.recommendedPrice ?? '',
      confidence: analysis.confidence ?? 0,
      model: analysis.model ?? '',
      inputTokens: analysis.inputTokens ?? 0,
      outputTokens: analysis.outputTokens ?? 0,
      estimatedCost: analysis.estimatedCost ?? 0,
    };
  }
}

function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}