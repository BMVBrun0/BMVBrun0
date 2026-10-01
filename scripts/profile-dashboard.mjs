import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || 'BMVBrun0';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('GH_TOKEN or GITHUB_TOKEN is required.');
  process.exit(1);
}

const now = new Date();
const to = now.toISOString();
const fromDate = new Date(now);
fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
fromDate.setUTCDate(fromDate.getUTCDate() + 1);
const from = fromDate.toISOString();

const query = `
query ProfileDashboard($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    repositories(
      first: 100,
      privacy: PUBLIC,
      ownerAffiliations: OWNER,
      isFork: false,
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        name
        nameWithOwner
        isPrivate
        pushedAt
      }
    }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            weekday
          }
        }
      }
    }
  }
  viewer {
    repositories(
      first: 100,
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
      isFork: false,
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        name
        nameWithOwner
        isPrivate
        pushedAt
      }
    }
  }
}`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    'user-agent': `${USERNAME}-profile-dashboard`,
  },
  body: JSON.stringify({ query, variables: { login: USERNAME, from, to } }),
});

if (!response.ok) {
  console.error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const payload = await response.json();
if (payload.errors?.length) {
  console.error(JSON.stringify(payload.errors, null, 2));
  process.exit(1);
}

const user = payload.data?.user;
if (!user) {
  console.error(`GitHub user not found: ${USERNAME}`);
  process.exit(1);
}

const calendar = user.contributionsCollection?.contributionCalendar;
if (!calendar?.weeks?.length) {
  console.error('Contribution calendar is unavailable.');
  process.exit(1);
}

const days = calendar.weeks.flatMap((week) => week.contributionDays || []);
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const busiest = days.reduce((best, day) => day.contributionCount > best.contributionCount ? day : best, { contributionCount: 0, date: '' });
const contributionTotal = calendar.totalContributions || 0;
const commits = user.contributionsCollection.totalCommitContributions || 0;

// Always keep the public repositories from the profile itself, then merge any
// additional repositories visible to the authenticated token. This keeps the
// aggregate repository count current without ever rendering repository names.
const repoMap = new Map();
for (const repo of user.repositories?.nodes || []) {
  if (!repo?.nameWithOwner || repo.nameWithOwner === `${USERNAME}/${USERNAME}`) continue;
  repoMap.set(repo.nameWithOwner, repo);
}
for (const repo of payload.data?.viewer?.repositories?.nodes || []) {
  if (!repo?.nameWithOwner || repo.nameWithOwner === `${USERNAME}/${USERNAME}`) continue;
  repoMap.set(repo.nameWithOwner, { ...repoMap.get(repo.nameWithOwner), ...repo });
}
const analyzedRepos = [...repoMap.values()];
const privateRepoCount = analyzedRepos.filter((repo) => repo.isPrivate).length;
const repoCount = analyzedRepos.length;
const monthMap = new Map();
for (const day of days) {
  const key = day.date.slice(0, 7);
  monthMap.set(key, (monthMap.get(key) || 0) + day.contributionCount);
}
const months = [];
for (let i = 11; i >= 0; i -= 1) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  months.push({
    key,
    label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    value: monthMap.get(key) || 0,
  });
}

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdays = weekdayLabels.map((label, weekday) => ({
  label,
  value: days.filter((day) => day.weekday === weekday).reduce((sum, day) => sum + day.contributionCount, 0),
}));

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function pointsForMonths(values, x, y, width, height) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return values.map((item, i) => ({
    ...item,
    x: x + (i * width) / Math.max(1, values.length - 1),
    y: y + height - (item.value / max) * height,
  }));
}

function render(theme) {
  const dark = theme === 'dark';
  const bg = dark ? '#0d1117' : '#ffffff';
  const surface = dark ? '#111827' : '#f8fafc';
  const surface2 = dark ? '#0f172a' : '#f1f5f9';
  const border = dark ? '#30363d' : '#d0d7de';
  const text = dark ? '#f0f6fc' : '#0f172a';
  const muted = dark ? '#8b949e' : '#64748b';
  const faint = dark ? '#21262d' : '#e2e8f0';
  const cyan = '#22d3ee';
  const blue = '#3b82f6';
  const violet = '#8b5cf6';
  const pink = '#ec4899';
  const green = '#22c55e';

  const w = 1120;
  const h = 650;
  const recentRepos = analyzedRepos.filter((repo) => repo.pushedAt && (now - new Date(repo.pushedAt)) <= 90 * 86400000).length;
  const metrics = [
    { label: 'CONTRIBUTIONS', value: compact(contributionTotal), hint: 'last 12 months', accent: cyan },
    { label: 'COMMITS', value: compact(commits), hint: 'public contribution signal', accent: blue },
    { label: 'ACTIVE DAYS', value: compact(activeDays), hint: `${Math.round((activeDays / Math.max(1, days.length)) * 100)}% of days`, accent: violet },
    { label: 'REPOS INDEXED', value: compact(repoCount), hint: `${recentRepos} updated in 90d`, accent: green },
  ];

  const chartX = 48;
  const chartY = 238;
  const chartW = 1024;
  const chartH = 105;
  const monthPoints = pointsForMonths(months, chartX, chartY, chartW, chartH);
  const poly = monthPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${chartX},${chartY + chartH} ${poly} ${chartX + chartW},${chartY + chartH}`;

  const maxWeekday = Math.max(1, ...weekdays.map((d) => d.value));
  const positive = days.filter((d) => d.contributionCount > 0).map((d) => d.contributionCount).sort((a, b) => a - b);
  const q = (p) => positive.length ? positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * p))] : 1;
  const thresholds = [q(0.25), q(0.5), q(0.75), q(0.92)];
  const heatColors = dark
    ? [faint, '#164e63', '#0891b2', '#7c3aed', '#db2777']
    : [faint, '#a5f3fc', '#38bdf8', '#8b5cf6', '#ec4899'];
  const heatLevel = (count) => {
    if (!count) return 0;
    if (count <= thresholds[0]) return 1;
    if (count <= thresholds[1]) return 2;
    if (count <= thresholds[2]) return 3;
    return 4;
  };

  const heatX = 48;
  const heatY = 452;
  const cell = 8;
  const gap = 3;
  const weekW = cell + gap;

  const monthLabels = monthPoints.map((p, i) => i % 2 === 0
    ? `<text x="${p.x}" y="${chartY + chartH + 26}" text-anchor="middle" class="axis">${esc(p.label)}</text>`
    : '').join('');

  const heatCells = calendar.weeks.map((week, wi) => (week.contributionDays || []).map((day) => {
    const level = heatLevel(day.contributionCount);
    const x = heatX + wi * weekW;
    const y = heatY + day.weekday * weekW;
    const pulse = level >= 4 ? ' class="hot"' : '';
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${heatColors[level]}"${pulse}><title>${esc(day.date)}: ${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'}</title></rect>`;
  }).join('')).join('');

  const weekdayBars = weekdays.map((d, i) => {
    const y = 452 + i * 22;
    return `<text x="758" y="${y + 8}" class="tiny">${d.label}</text><rect x="794" y="${y}" width="250" height="8" rx="4" fill="${faint}"/><rect x="794" y="${y}" width="${Math.max(2, 250 * (d.value / maxWeekday)).toFixed(1)}" height="8" rx="4" fill="url(#barGrad)"/>`;
  }).join('');

  const metricSvg = metrics.map((m, i) => {
    const x = 28 + i * 266;
    return `<g class="metric m${i + 1}"><rect x="${x}" y="86" width="244" height="86" rx="16" fill="${surface}" stroke="${border}"/><rect x="${x}" y="86" width="244" height="3" rx="2" fill="${m.accent}"/><text x="${x + 18}" y="112" class="metricLabel">${m.label}</text><text x="${x + 18}" y="147" class="metricValue">${m.value}</text><text x="${x + 95}" y="145" class="metricHint">${esc(m.hint)}</text></g>`;
  }).join('');

  const busiestText = busiest.contributionCount > 0 ? `${busiest.contributionCount} on ${busiest.date}` : '—';
  const updated = now.toISOString().slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(USERNAME)} GitHub activity dashboard</title>
  <desc id="desc">A twelve month view of GitHub contribution activity and cadence.</desc>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${cyan}"/><stop offset="0.5" stop-color="${violet}"/><stop offset="1" stop-color="${pink}"/></linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${violet}" stop-opacity="0.35"/><stop offset="1" stop-color="${violet}" stop-opacity="0.02"/></linearGradient>
    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${cyan}"/><stop offset="1" stop-color="${violet}"/></linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style><![CDATA[
      text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${text}; }
      .title { font-size: 22px; font-weight: 760; letter-spacing: .2px; }
      .kicker { font-size: 11px; font-weight: 700; letter-spacing: 1.8px; fill: ${cyan}; }
      .muted { font-size: 12px; fill: ${muted}; }
      .metricLabel { font-size: 10px; font-weight: 750; letter-spacing: 1.2px; fill: ${muted}; }
      .metricValue { font-size: 26px; font-weight: 760; }
      .metricHint { font-size: 10px; fill: ${muted}; }
      .section { font-size: 12px; font-weight: 720; letter-spacing: .5px; }
      .axis { font-size: 9px; fill: ${muted}; }
      .tiny { font-size: 9px; fill: ${muted}; }
      .hot { opacity: .96; }
    ]]></style>
  </defs>

  <rect x="0.5" y="0.5" width="1119" height="649" rx="22" fill="${bg}" stroke="${border}"/>
  <circle cx="1040" cy="20" r="90" fill="${violet}" opacity="${dark ? '.07' : '.045'}" filter="url(#glow)"/>
  <circle cx="96" cy="640" r="120" fill="${cyan}" opacity="${dark ? '.05' : '.035'}" filter="url(#glow)"/>

  <rect x="28" y="27" width="95" height="3" rx="2" fill="url(#accent)"/>
  <text x="28" y="52" class="kicker">BMVBRUN0 / GITHUB ACTIVITY</text>
  <text x="28" y="75" class="title">Engineering dashboard</text>
  <text x="1092" y="51" text-anchor="end" class="muted">updated ${updated}</text>
  <text x="1092" y="69" text-anchor="end" class="muted">trailing 12 months</text>

  ${metricSvg}

  <rect x="28" y="192" width="1064" height="190" rx="18" fill="${surface2}" stroke="${border}"/>
  <text x="48" y="220" class="section">12-month contribution pulse</text>
  <text x="1072" y="220" text-anchor="end" class="muted">busiest day · ${esc(busiestText)}</text>
  <line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="${border}"/>
  <polygon points="${area}" fill="url(#area)"/>
  <polyline points="${poly}" fill="none" stroke="url(#accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="pulseLine"/>
  ${monthPoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${bg}" stroke="${cyan}" stroke-width="2"/>`).join('')}
  ${monthLabels}


  <rect x="28" y="398" width="690" height="224" rx="18" fill="${surface2}" stroke="${border}"/>
  <text x="48" y="427" class="section">Contribution field</text>
  <text x="694" y="427" text-anchor="end" class="muted">${activeDays} active days · ${compact(contributionTotal)} contributions</text>
  ${heatCells}
  <text x="48" y="607" class="muted">profile contribution graph · GitHub activity</text>

  <rect x="738" y="398" width="354" height="224" rx="18" fill="${surface2}" stroke="${border}"/>
  <text x="758" y="427" class="section">Weekly rhythm</text>
  ${weekdayBars}
</svg>`;
}

const outDir = path.resolve('assets/dashboard');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'activity-dark.svg'), render('dark'));
await fs.writeFile(path.join(outDir, 'activity-light.svg'), render('light'));

console.log(`Generated dashboard for ${USERNAME}: ${contributionTotal} contributions, ${activeDays} active days, ${repoCount} repositories indexed (${privateRepoCount} private).`);
