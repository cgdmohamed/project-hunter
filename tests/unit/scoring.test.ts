import { describe, expect, it } from 'vitest';
import { computeScore } from '../../src/services/evaluation.service.js';
import type { EvaluationResponse } from '../../src/integrations/openai.js';

function response(criteria: EvaluationResponse['criteria'], overallScore = 0): EvaluationResponse {
  return {
    category: 'x',
    summary: 's',
    businessProblem: 'b',
    technicalSuitability: 't',
    relevanceReason: 'r',
    expectedComplexity: 'medium',
    recommendedApproach: 'a',
    financialViabilityComment: 'f',
    risks: [],
    missingRequirements: [],
    clarificationQuestions: [],
    estimatedDuration: 'd',
    suggestedBid: 'p',
    confidence: 0.9,
    criteria,
    overallScore,
  };
}

describe('evaluation scoring', () => {
  it('sums criterion scores to produce the overall score', () => {
    const criteria = {
      capabilityMatch: 30,
      financialViability: 20,
      requirementsClarity: 12,
      deliveryFeasibility: 13,
      riskFactor: 8,
    };
    expect(computeScore(response(criteria))).toBe(83);
  });

  it('clamps the score to a maximum of 100', () => {
    const criteria = {
      capabilityMatch: 35,
      financialViability: 25,
      requirementsClarity: 15,
      deliveryFeasibility: 15,
      riskFactor: 10,
    };
    expect(computeScore(response(criteria))).toBe(100);
  });

  it('clamps the score to a minimum of 0', () => {
    const criteria = {
      capabilityMatch: 0,
      financialViability: 0,
      requirementsClarity: 0,
      deliveryFeasibility: 0,
      riskFactor: 5,
    };
    expect(computeScore(response(criteria))).toBe(5);
  });

  it('flags qualification only at or above the threshold', () => {
    const config = { MIN_PROJECT_SCORE: 75 } as { MIN_PROJECT_SCORE: number };
    const high = computeScore(
      response({
        capabilityMatch: 30,
        financialViability: 20,
        requirementsClarity: 12,
        deliveryFeasibility: 13,
        riskFactor: 8,
      }),
    );
    const low = computeScore(
      response({
        capabilityMatch: 10,
        financialViability: 5,
        requirementsClarity: 5,
        deliveryFeasibility: 5,
        riskFactor: 5,
      }),
    );
    expect(high >= config.MIN_PROJECT_SCORE).toBe(true);
    expect(low < config.MIN_PROJECT_SCORE).toBe(true);
  });
});