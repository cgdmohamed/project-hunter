import { describe, expect, it } from 'vitest';
import {
  budgetToUsd,
  detectCurrency,
  evaluateBudget,
  parseBudgetText,
} from '../../src/utils/money.js';

const RATES = { USD: 1, SAR: 0.2667, EGP: 0.0204, JOD: 1.4102 };

describe('money / budget parsing', () => {
  it('parses a USD range', () => {
    const budget = parseBudgetText('$250 - $1,000');
    expect(budget.min).toBe(250);
    expect(budget.max).toBe(1000);
    expect(budget.currency).toBe('USD');
  });

  it('parses a SAR range', () => {
    const budget = parseBudgetText('1000 - 5000 ر.س');
    expect(budget.min).toBe(1000);
    expect(budget.max).toBe(5000);
    expect(budget.currency).toBe('SAR');
  });

  it('parses Arabic-Indic digits', () => {
    const budget = parseBudgetText('٥٠٠ - ٢٠٠٠ ريال');
    expect(budget.min).toBe(500);
    expect(budget.max).toBe(2000);
  });

  it('treats a single amount as a confirmed exact budget', () => {
    const budget = parseBudgetText('$500');
    expect(budget.min).toBe(500);
    expect(budget.max).toBe(500);
  });

  it('detects an open budget', () => {
    const budget = parseBudgetText('الميزانية مفتوحة');
    expect(budget.openBudget).toBe(true);
    expect(budget.min).toBeNull();
    expect(budget.max).toBeNull();
  });

  it('returns nulls for unusable text', () => {
    const budget = parseBudgetText('غير محدد');
    expect(budget.min).toBeNull();
    expect(budget.max).toBeNull();
  });

  it('detects currencies', () => {
    expect(detectCurrency('$100')).toBe('USD');
    expect(detectCurrency('500 دينار أردني')).toBe('JOD');
    expect(detectCurrency('100 يورو')).toBe('EUR');
  });

  it('converts budgets to USD', () => {
    const budget = parseBudgetText('1000 - 2000 ر.س');
    const usd = budgetToUsd(budget, RATES);
    expect(usd.minUsd).toBeCloseTo(266.7, 1);
    expect(usd.maxUsd).toBeCloseTo(533.4, 1);
  });

  it('marks unknown currency as not convertible', () => {
    const budget = parseBudgetText('1000 ZZZ');
    const usd = budgetToUsd(budget, RATES);
    expect(usd.convertible).toBe(false);
  });
});

describe('budget filtering rules', () => {
  it('rejects a confirmed maximum below the threshold', () => {
    expect(evaluateBudget({ minUsd: 20, maxUsd: 80, convertible: true }, 100)).toBe('rejected');
  });

  it('accepts a range that overlaps the threshold', () => {
    expect(evaluateBudget({ minUsd: 50, maxUsd: 300, convertible: true }, 100)).toBe('eligible');
  });

  it('accepts a range above the threshold', () => {
    expect(evaluateBudget({ minUsd: 500, maxUsd: 2000, convertible: true }, 100)).toBe('eligible');
  });

  it('marks unknown budgets as needs_review', () => {
    expect(evaluateBudget({ minUsd: null, maxUsd: null, convertible: true }, 100)).toBe('needs_review');
    expect(evaluateBudget({ minUsd: null, maxUsd: null, convertible: false }, 100)).toBe('needs_review');
  });
});