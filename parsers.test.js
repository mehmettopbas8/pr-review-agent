import { describe, it, expect } from 'vitest';
import { botMatchesLogin, filterDiff, isRetrospectiveComment } from './parsers.js';

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
