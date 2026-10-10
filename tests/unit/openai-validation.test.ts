import { describe, expect, it } from 'vitest';
import { evaluationSchema, parseJson, proposalSchema } from '../../src/integrations/openai.js';

const validEvaluation = {
  category: 'تطوير ويب',
  summary: 'نظام حجوزات',
  businessProblem: 'يدير المطعم حجوزاته يدوياً',
  technicalSuitability: 'مناسب تماماً لتقنياتنا',
  relevanceReason: 'نطابق قدراتنا',
  expectedComplexity: 'medium',
  recommendedApproach: 'React + Node',
  financialViabilityComment: 'ميزانية جيدة',
  risks: ['متطلبات غير واضحة'],
  missingRequirements: ['عدد المستخدمين'],
  clarificationQuestions: ['كم عدد الطاولات؟'],
  estimatedDuration: 'أسبوعان',
  suggestedBid: '1500 دولار',
  confidence: 0.9,
  criteria: {
    capabilityMatch: 30,
    financialViability: 20,
    requirementsClarity: 12,
    deliveryFeasibility: 13,
    riskFactor: 8,
  },
  overallScore: 83,
};

describe('AI JSON validation', () => {
  it('accepts a valid evaluation payload', () => {
    const parsed = evaluationSchema.parse(validEvaluation);
    expect(parsed.overallScore).toBe(83);
    expect(parsed.category).toBe('تطوير ويب');
  });

  it('rejects an out-of-range criterion', () => {
    expect(() =>
      evaluationSchema.parse({
        ...validEvaluation,
        criteria: { ...validEvaluation.criteria, capabilityMatch: 99 },
      }),
    ).toThrow();
  });

  it('rejects a score above 100', () => {
    expect(() => evaluationSchema.parse({ ...validEvaluation, overallScore: 120 })).toThrow();
  });

  it('rejects missing required fields', () => {
    const { summary, ...missing } = validEvaluation;
    expect(() => evaluationSchema.parse(missing)).toThrow();
    void summary;
  });

  it('extracts JSON from model output with markdown fences', () => {
    const wrapped = "```json\n" + JSON.stringify(validEvaluation) + "\n```";
    const parsed = parseJson(wrapped);
    expect(parsed).toEqual(validEvaluation);
  });

  it('extracts JSON from text with surrounding prose', () => {
    const wrapped = `Here you go:\n${JSON.stringify(validEvaluation)}\nHope that helps!`;
    expect(parseJson(wrapped)).toEqual(validEvaluation);
  });

  it('validates a proposal payload', () => {
    const proposal = {
      language: 'ar',
      proposalText: 'نعم، يمكنني تنفيذ هذا المشروع بكفاءة خلال المدة المطلوبة مع خطة عمل واضحة.',
      recommendedPrice: '1200$',
      estimatedDuration: 'ثلاثة أسابيع',
    };
    const parsed = proposalSchema.parse(proposal);
    expect(parsed.language).toBe('ar');
  });

  it('rejects a short proposal text', () => {
    expect(() =>
      proposalSchema.parse({ language: 'en', proposalText: 'short', recommendedPrice: 'x', estimatedDuration: 'y' }),
    ).toThrow();
  });
});