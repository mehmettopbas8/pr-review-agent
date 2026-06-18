// Manual mock for @octokit/rest used in githubService.test.js
// Vitest picks this up automatically when vi.mock('@octokit/rest') is called without a factory.

const mockRestMethods = {
  issues: {
    create: null,
    getLabel: null,
    createLabel: null,
  },
  pulls: {
    createReview: null,
    listReviews: null,
    get: null,
    listCommits: null,
  },
  repos: {
    getContent: null,
  },
};

// Populated by the test's beforeEach after vi.clearAllMocks()
const mockOctokit = { rest: mockRestMethods };

function Octokit() {
  return mockOctokit;
}

module.exports = { Octokit, mockOctokit };
