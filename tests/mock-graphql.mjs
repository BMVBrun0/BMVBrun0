// Network-free GraphQL fixture; loaded only by the test suite.
let attempts = { activity: 0, repositories: 0 };
const day = new Date();
const date = day.toISOString().slice(0, 10);
const weekday = day.getUTCDay();
const success = (data) => new Response(JSON.stringify({ data }), { status: 200 });
const error = (status, statusText) => new Response('temporary failure', { status, statusText });

globalThis.fetch = async (_url, options) => {
  const query = JSON.parse(options.body).query;
  const kind = query.includes('ProfileActivity') ? 'activity' : 'repositories';
  attempts[kind]++;
  const mode = process.env.TEST_GRAPHQL_MODE;

  if (mode === 'always-504') return error(504, 'Gateway Timeout');
  if (mode === 'auth-401') return error(401, 'Unauthorized');
  if (mode === 'retry-504' && attempts[kind] === 1) return error(504, 'Gateway Timeout');
  if (mode === 'repos-503' && kind === 'repositories') return error(503, 'Service Unavailable');

  if (kind === 'activity') return success({
    user: {
      contributionsCollection: {
        totalCommitContributions: 4,
        contributionCalendar: {
          totalContributions: 5,
          weeks: [{ contributionDays: [{ date, contributionCount: 5, weekday }] }],
        },
      },
    },
  });
  return success({
    user: { repositories: { nodes: [{ nameWithOwner: 'BMVBrun0/demo', isPrivate: false, pushedAt: date }] } },
    viewer: { repositories: { nodes: [{ nameWithOwner: 'BMVBrun0/demo', isPrivate: false, pushedAt: date }] } },
  });
};
