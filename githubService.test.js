import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Import the service functions
const {
  createFollowUpIssue, createIssuesFromSpec, postReviewComment, getFileFromPR, _setOctokitFactory,
} = await import('./githubService.js');

// Build a fresh mock octokit object for each test
function makeMockOctokit() {
  return {
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({ data: { number: 1, html_url: 'https://github.com/r/i/1', title: 'Test' } }),
        getLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        createReview: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({ data: { head: { sha: 'abc123' } } }),
      },
      repos: {
        getContent: vi.fn(),
      },
    },
  };
}

let mockOctokit;

beforeEach(() => {
  mockOctokit = makeMockOctokit();
  _setOctokitFactory(() => mockOctokit);
});

afterAll(() => {
  _setOctokitFactory(null); // restore for other test files
});

describe('createIssuesFromSpec', () => {
  it('calls issues.create for each issue', async () => {
    const issues = [
      { title: 'Add GET /users', body: 'desc', labels: ['enhancement'] },
      { title: 'Add POST /users', body: 'desc', labels: [] },
    ];
    const created = await createIssuesFromSpec('inst1', 'owner', 'repo', issues);
    expect(mockOctokit.rest.issues.create).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
  });

  it('passes correct title and body to issues.create', async () => {
    const issues = [{ title: 'My Issue', body: 'My body', labels: [] }];
    await createIssuesFromSpec('inst1', 'owner', 'repo', issues);
    expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My Issue', body: 'My body' })
    );
  });

  it('calls ensureLabel for each label', async () => {
    const issues = [{ title: 'T', body: '', labels: ['api', 'enhancement'] }];
    await createIssuesFromSpec('inst1', 'owner', 'repo', issues);
    expect(mockOctokit.rest.issues.getLabel).toHaveBeenCalledTimes(2);
  });

  it('throws and logs on 403', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockOctokit.rest.issues.create.mockRejectedValue(err);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createIssuesFromSpec('inst1', 'owner', 'repo', [{ title: 'T', body: '', labels: [] }]))
      .rejects.toThrow('Forbidden');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('re-authorize'));
    consoleSpy.mockRestore();
  });
});

describe('createFollowUpIssue', () => {
  it('creates issue with correct title referencing pullNumber', async () => {
    await createFollowUpIssue('inst', 'owner', 'repo', 42, { todos: ['Fix lint'], mediums: [], blockers: [] }, 'alice');
    expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('#42') })
    );
  });

  it('body contains checkbox items', async () => {
    await createFollowUpIssue('inst', 'owner', 'repo', 1, { todos: ['Write tests'], mediums: [], blockers: [] }, null);
    const call = mockOctokit.rest.issues.create.mock.calls[0][0];
    expect(call.body).toContain('- [ ] Write tests');
  });

  it('adds severity:high label when blockers present', async () => {
    await createFollowUpIssue('inst', 'owner', 'repo', 1, { todos: [], mediums: [], blockers: ['SQL injection'] }, null);
    const call = mockOctokit.rest.issues.create.mock.calls[0][0];
    expect(call.labels).toContain('severity:high');
  });

  it('does NOT add severity:high label when no blockers', async () => {
    await createFollowUpIssue('inst', 'owner', 'repo', 1, { todos: ['Fix lint'], mediums: [], blockers: [] }, null);
    const call = mockOctokit.rest.issues.create.mock.calls[0][0];
    expect(call.labels).not.toContain('severity:high');
  });

  it('logs actionable message on 403', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockOctokit.rest.issues.create.mockRejectedValue(err);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createFollowUpIssue('inst', 'owner', 'repo', 1, { todos: [], mediums: [], blockers: [] }, null))
      .rejects.toThrow('Forbidden');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('re-authorize'));
    consoleSpy.mockRestore();
  });
});

describe('postReviewComment', () => {
  it('calls pulls.createReview with COMMENT event', async () => {
    await postReviewComment('inst', 'owner', 'repo', 7, 'review body');
    expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 7, body: 'review body', event: 'COMMENT' })
    );
  });
});

describe('getFileFromPR', () => {
  it('returns file content when found', async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { type: 'file', content: Buffer.from('# Requirements\n').toString('base64') },
    });
    const result = await getFileFromPR('inst', 'owner', 'repo', 1, 'requirements.md');
    expect(result).toBe('# Requirements\n');
  });

  it('returns null when file not found (404)', async () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    mockOctokit.rest.repos.getContent.mockRejectedValue(err);
    const result = await getFileFromPR('inst', 'owner', 'repo', 1, 'requirements.md');
    expect(result).toBeNull();
  });
});
