// GitHub REST helpers for the factory-approve pipeline. Dependency-free (global `fetch`) so the
// pipeline runs in CI and locally without installing node_modules.

const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';

/**
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} path Path starting with `/`.
 * @param {{ token: string, method?: string, body?: unknown, allow404?: boolean }} options
 * @returns {Promise<any>} Parsed JSON body, or null on 404 when `allow404` is set.
 */
async function githubRequest(path, { token, method = 'GET', body, allow404 = false }) {
    const response = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'apify-core-factory-approve',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${await response.text()}`);
    }
    if (response.status === 204) return null;
    return await response.json();
}

/**
 * Fetches the PR, retrying while GitHub is still computing `mergeable` (it is null right after a
 * push). Callers must treat a still-null `mergeable` as a failure.
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {string} token
 * @param {{ mergeableRetries?: number, retryDelayMs?: number }} [options]
 * @returns {Promise<any>}
 */
export async function getPullRequest(repoFullName, prNumber, token, options = {}) {
    const { mergeableRetries = 3, retryDelayMs = 3000 } = options;
    let pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    for (let attempt = 0; pr.mergeable === null && pr.state === 'open' && attempt < mergeableRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    }
    return pr;
}

/**
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {string} token
 * @returns {Promise<any[]>} Changed files (a gate-passing PR has at most a handful).
 */
export async function listPullRequestFiles(repoFullName, prNumber, token) {
    return githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100`, { token });
}

/**
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {string} token
 * @returns {Promise<any[]>}
 */
export async function listPullRequestReviews(repoFullName, prNumber, token) {
    return githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/reviews?per_page=100`, { token });
}

/**
 * @param {string} org
 * @param {string} teamSlug
 * @param {string} username
 * @param {string} token Must have `read:org`.
 * @returns {Promise<boolean>} Whether the user is an active member of the team.
 */
export async function isActiveTeamMember(org, teamSlug, username, token) {
    const membership = await githubRequest(`/orgs/${org}/teams/${teamSlug}/memberships/${username}`, {
        token,
        allow404: true,
    });
    return membership !== null && membership.state === 'active';
}

/**
 * Posts an approving review locked to the commit the pipeline actually reviewed.
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {{ commitId: string, body: string, token: string }} options
 */
export async function createApprovalReview(repoFullName, prNumber, { commitId, body, token }) {
    await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/reviews`, {
        token,
        method: 'POST',
        body: { event: 'APPROVE', commit_id: commitId, body },
    });
}

/**
 * Dismisses every APPROVED review by `login`, to withdraw a stale factory approval.
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {{ login: string, message: string, token: string }} options
 * @returns {Promise<number>} Number of dismissed reviews.
 */
export async function dismissApprovalsBy(repoFullName, prNumber, { login, message, token }) {
    const reviews = await listPullRequestReviews(repoFullName, prNumber, token);
    const toDismiss = reviews.filter((review) => review.user?.login === login && review.state === 'APPROVED');
    for (const review of toDismiss) {
        await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/reviews/${review.id}/dismissals`, {
            token,
            method: 'PUT',
            body: { message },
        });
    }
    return toDismiss.length;
}

/**
 * Fetches a file's content at a specific ref. Returns null when the file is missing, binary, or too
 * large for the contents API — callers treat null as "content unavailable" and fail toward rejection.
 * @param {string} repoFullName
 * @param {string} filePath
 * @param {string} ref
 * @param {string} token
 * @returns {Promise<string | null>}
 */
export async function getFileContentAtRef(repoFullName, filePath, ref, token) {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const response = await githubRequest(
        `/repos/${repoFullName}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        { token, allow404: true },
    );
    if (!response || response.encoding !== 'base64' || typeof response.content !== 'string') return null;
    return Buffer.from(response.content, 'base64').toString('utf-8');
}

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Adds a labelled message block to the PR body, replacing any previous block with the same label.
 * Uses the same HTML markers as apify-core's `scripts/edit_pull_request_body.js` so both coexist.
 * @param {string} repoFullName
 * @param {number} prNumber
 * @param {{ message: string, label: string, token: string }} options
 */
export async function upsertPrBodyMessage(repoFullName, prNumber, { message, label, token }) {
    const pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    const startMarker = `<!-- PR-BOT-MESSAGE-START ${label} -->`;
    const endMarker = `<!-- PR-BOT-MESSAGE-END ${label} -->`;

    let body = pr.body || '';
    // GitHub uses Windows-style line endings when the PR description is edited in the UI.
    const oldMessageRegex = new RegExp(`\r?\n${escapeRegExp(startMarker)}.*?${escapeRegExp(endMarker)}\r?\n`, 'gs');
    body = body.replace(oldMessageRegex, '');
    if (!body.trim()) body = '_No description provided._\n';

    const header = `---\n\n🤖 **PR BOT** (at ${new Date().toUTCString()}):`;
    body += `\n${startMarker}\n\n${header}\n\n${message.trim()}\n\n${endMarker}\n`;

    await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token, method: 'PATCH', body: { body } });
}

/**
 * Lists the most recently created PRs in the given state, for backtesting. With a `filter`, keeps
 * paginating until `limit` matching PRs are collected, so "last N" means N PRs the caller cares about.
 * @param {string} repoFullName
 * @param {{ token: string, limit: number, state?: 'closed' | 'open', filter?: (pull: any) => boolean }} options
 * @returns {Promise<{ pulls: any[], scanned: number }>}
 */
export async function listRecentPullRequests(repoFullName, { token, limit, state = 'closed', filter = () => true }) {
    const pulls = [];
    let scanned = 0;
    for (let page = 1; pulls.length < limit && page <= 30; page++) {
        const batch = await githubRequest(
            `/repos/${repoFullName}/pulls?state=${state}&sort=created&direction=desc&per_page=100&page=${page}`,
            { token },
        );
        scanned += batch.length;
        pulls.push(...batch.filter(filter));
        if (batch.length < 100) break;
    }
    return { pulls: pulls.slice(0, limit), scanned };
}
