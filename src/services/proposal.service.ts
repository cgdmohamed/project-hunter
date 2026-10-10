import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { AppDb } from '../database/client.js';
import { proposals, type AnalysisRow, type ProjectRow, type ProposalRow } from '../database/schema.js';
import type { ProposalCall, ProposalResponse } from '../integrations/openai.js';
import type { Metrics } from '../utils/metrics.js';
import { nowIso } from '../utils/date.js';
import { parseSkills, EvaluationService } from './evaluation.service.js';

export interface ProposalGenerator {
  generateProposal(input: {
    title: string | null;
    description: string | null;
    category: string | null;
    requiredSkills: string[];
    evaluation: {
      summary: string;
      businessProblem: string;
      recommendedApproach: string;
      suggestedBid: string;
      estimatedDuration: string;
      risks: string[];
    };
  }): Promise<ProposalCall>;
}

export interface ProposalOutcome {
  proposal: ProposalRow;
  response: ProposalResponse;
}

export class ProposalService {
  constructor(
    private readonly db: AppDb,
    private readonly config: AppConfig,
    private readonly generator: ProposalGenerator,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  async generateAndSave(project: ProjectRow, analysis: AnalysisRow): Promise<ProposalOutcome> {
    const view = EvaluationService.toView(analysis);

    let call: ProposalCall;
    try {
      call = await this.generator.generateProposal({
        title: project.title,
        description: project.description,
        category: project.category,
        requiredSkills: parseSkills(project.skills) ?? [],
        evaluation: {
          summary: view.summary,
          businessProblem: view.businessProblem,
          recommendedApproach: view.recommendedApproach,
          suggestedBid: view.recommendedPrice,
          estimatedDuration: view.estimatedDuration,
          risks: view.risks,
        },
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

    const proposal = this.db
      .insert(proposals)
      .values({
        projectId: project.id,
        language: call.result.language,
        proposalText: call.result.proposalText,
        recommendedPrice: call.result.recommendedPrice,
        estimatedDuration: call.result.estimatedDuration,
        createdAt: nowIso(),
      })
      .returning()
      .get();

    this.logger.info({ projectId: project.id, proposalId: proposal.id }, 'proposal generated');

    return { proposal, response: call.result };
  }
}

export type { ProposalRow };