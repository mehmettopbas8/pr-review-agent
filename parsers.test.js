import { describe, it, expect } from 'vitest';
import { botMatchesLogin, filterDiff, isRetrospectiveComment, buildFollowUpBody, extractFollowUpItems } from './parsers.js';

describe('botMatchesLogin', () => {
  it('matches exact [bot] suffix', () => {
    expect(botMatchesLogin('myapp[bot]', 'myapp[bot]')).toBe(true);
  });
  it('matches without [bot]', () => {
    expect(botMatchesLogin('myapp[bot]', 'myapp')).toBe(true);
  });
  it('matches -bot suffix', () => {
    expect(botMatchesLogin('myapp-bot', 'myapp[bot]')).toBe(true);
  });
  it('rejects a different user', () => {
    expect(botMatchesLogin('someone', 'myapp[bot]')).toBe(false);
  });
  it('returns false when botLogin is null', () => {
    expect(botMatchesLogin('anyone', null)).toBe(false);
  });
});

describe('filterDiff', () => {
  it('keeps normal source files', () => {
    const diff = 'diff --git a/src/index.js b/src/index.js\n+const x = 1;';
    expect(filterDiff(diff)).toContain('src/index.js');
  });
  it('strips package-lock.json', () => {
    const diff =
      'diff --git a/package-lock.json b/package-lock.json\n+lock stuff\n' +
      'diff --git a/src/app.js b/src/app.js\n+real code';
    const result = filterDiff(diff);
    expect(result).not.toContain('package-lock.json');
    expect(result).toContain('src/app.js');
  });
  it('strips .min.js files', () => {
    const diff = 'diff --git a/dist/bundle.min.js b/dist/bundle.min.js\n+minified';
    expect(filterDiff(diff)).toBe('');
  });
  it('truncates at 80k chars', () => {
    const huge = 'diff --git a/big.js b/big.js\n' + 'x'.repeat(90000);
    const result = filterDiff(huge);
    expect(result.length).toBeLessThanOrEqual(80000 + 20);
    expect(result).toContain('[diff truncated]');
  });
});

describe('isRetrospectiveComment', () => {
  it('matches PR Retrospective header', () => {
    expect(isRetrospectiveComment('## 🏁 PR Retrospective\n\nsome text')).toBe(true);
  });
  it('matches merge commit detected', () => {
    expect(isRetrospectiveComment("🔀 **Merge commit detected — don't forget")).toBe(true);
  });
  it('matches not ready to merge', () => {
    expect(isRetrospectiveComment('⛔ **This PR is NOT ready to merge')).toBe(true);
  });
  it('does not match a normal review', () => {
    expect(isRetrospectiveComment('1. [High] Missing validation in auth.js')).toBe(false);
  });
});

describe('buildFollowUpBody', () => {
  it('includes PR back-link', () => {
    const body = buildFollowUpBody({ todos: [], mediums: [], blockers: [], pullNumber: 42 });
    expect(body).toContain('#42');
  });
  it('renders checkbox task items', () => {
    const body = buildFollowUpBody({ todos: ['Fix the thing'], mediums: [], blockers: [], pullNumber: 1 });
    expect(body).toContain('- [ ] Fix the thing');
  });
  it('renders blockers in Critical/High section', () => {
    const body = buildFollowUpBody({ todos: [], mediums: [], blockers: ['SQL injection in login'], pullNumber: 7 });
    expect(body).toContain('## Critical / High');
    expect(body).toContain('- [ ] SQL injection in login');
  });
  it('renders medium/low section', () => {
    const body = buildFollowUpBody({ todos: [], mediums: ['Missing index on users table'], blockers: [], pullNumber: 3 });
    expect(body).toContain('## Medium / Low');
  });
  it('includes auto-generated footer', () => {
    const body = buildFollowUpBody({ todos: [], mediums: [], blockers: [], pullNumber: 5 });
    expect(body).toContain('Automatically opened');
  });
});

describe('extractFollowUpItems', () => {
  it('returns empty arrays for no reviews', () => {
    expect(extractFollowUpItems([])).toEqual({ todos: [], mediums: [], blockers: [] });
  });
  it('extracts todos', () => {
    const review = '1. [TODO before merge] Add tests for the auth module';
    const { todos } = extractFollowUpItems([review]);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toContain('Add tests');
  });
  it('extracts blockers from Critical/High tags', () => {
    const review = '1. [Critical] SQL injection\n2. [High] Missing auth check';
    const { blockers } = extractFollowUpItems([review]);
    expect(blockers).toHaveLength(2);
  });
  it('extracts mediums from Medium/Low tags', () => {
    const review = '1. [Medium] Rename variable\n2. [Low] Add comment';
    const { mediums } = extractFollowUpItems([review]);
    expect(mediums).toHaveLength(2);
  });
  it('deduplicates identical items', () => {
    const review = '1. [High] Same issue\n1. [High] Same issue';
    const { blockers } = extractFollowUpItems([review]);
    expect(blockers).toHaveLength(1);
  });
});
