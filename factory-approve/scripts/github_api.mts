// GitHub REST helpers for the factory-approve pipeline. Dependency-free (global `fetch`) so the
// pipeline runs in CI and locally without installing node_modules.

const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function githubRequest(
    path: string,
    { token, method = 'GET', body, allow404 = false }: { token: string; method?: string; body?: unknown; allow404?: boolean },
): Promise<any> {
    const response = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'apify-factory-approve',
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

// Fetches the PR, retrying while GitHub is still computing `mergeable` (it is null right after a
// push). Callers must treat a still-null `mergeable` as a failure.
export async function getPullRequest(
    repoFullName: string,
    prNumber: number,
    token: string,
    { mergeableRetries = 3, retryDelayMs = 3000 }: { mergeableRetries?: number; retryDelayMs?: number } = {},
): Promise<any> {
    let pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    for (let attempt = 0; pr.mergeable === null && pr.state === 'open' && attempt < mergeableRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    }
    return pr;
}

export async function listPullRequestFiles(repoFullName: string, prNumber: number, token: string): Promise<any[]> {
    return githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100`, { token });
}

export async function listPullRequestReviews(repoFullName: string, prNumber: number, token: string): Promise<any[]> {
    return githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/reviews?per_page=100`, { token });
}

// Issue comments, oldest first (paginated, capped at 1000).
export async function listIssueComments(repoFullName: string, issueNumber: number, token: string): Promise<any[]> {
    const comments: any[] = [];
    for (let page = 1; page <= 10; page++) {
        const batch = await githubRequest(
            `/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
            { token },
        );
        comments.push(...batch);
        if (batch.length < 100) break;
    }
    return comments;
}

// Requires a token with `read:org`.
export async function isActiveTeamMember(org: string, teamSlug: string, username: string, token: string): Promise<boolean> {
    const membership = await githubRequest(`/orgs/${org}/teams/${teamSlug}/memberships/${username}`, {
        token,
        allow404: true,
    });
    return membership !== null && membership.state === 'active';
}

// Posts an approving review locked to the commit the pipeline actually reviewed.
export async function createApprovalReview(
    repoFullName: string,
    prNumber: number,
    { commitId, body, token }: { commitId: string; body: string; token: string },
): Promise<void> {
    await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}/reviews`, {
        token,
        method: 'POST',
        body: { event: 'APPROVE', commit_id: commitId, body },
    });
}

// Dismisses every APPROVED review by `login`; returns how many were dismissed.
export async function dismissApprovalsBy(
    repoFullName: string,
    prNumber: number,
    { login, message, token }: { login: string; message: string; token: string },
): Promise<number> {
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

// Returns a file's content at a ref, or null when it is missing, binary, or too large for the
// contents API — callers treat null as "content unavailable" and fail toward rejection.
export async function getFileContentAtRef(
    repoFullName: string,
    filePath: string,
    ref: string,
    token: string,
): Promise<string | null> {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const response = await githubRequest(
        `/repos/${repoFullName}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        { token, allow404: true },
    );
    if (!response || response.encoding !== 'base64' || typeof response.content !== 'string') return null;
    return Buffer.from(response.content, 'base64').toString('utf-8');
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Migration cleanup: removes the labelled PR-BOT block an earlier version of this action wrote into
// the PR body (same HTML markers as apify-core's `scripts/edit_pull_request_body.js`).
export async function removePrBodyMessage(
    repoFullName: string,
    prNumber: number,
    { label, token }: { label: string; token: string },
): Promise<void> {
    const pr = await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token });
    const startMarker = `<!-- PR-BOT-MESSAGE-START ${label} -->`;
    const endMarker = `<!-- PR-BOT-MESSAGE-END ${label} -->`;

    const body = pr.body || '';
    // GitHub uses Windows-style line endings when the PR description is edited in the UI.
    const oldMessageRegex = new RegExp(`\r?\n${escapeRegExp(startMarker)}.*?${escapeRegExp(endMarker)}\r?\n`, 'gs');
    const cleaned = body.replace(oldMessageRegex, '');
    if (cleaned === body) return;
    await githubRequest(`/repos/${repoFullName}/pulls/${prNumber}`, { token, method: 'PATCH', body: { body: cleaned } });
}

async function githubGraphql(query: string, variables: Record<string, any>, token: string): Promise<any> {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'apify-factory-approve',
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL failed with ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`);
    return payload.data;
}

export async function createIssueComment(
    repoFullName: string,
    issueNumber: number,
    { body, token }: { body: string; token: string },
): Promise<void> {
    await githubRequest(`/repos/${repoFullName}/issues/${issueNumber}/comments`, {
        token,
        method: 'POST',
        body: { body },
    });
}

// Collapses every existing comment containing `marker` as OUTDATED (GitHub's native fold); returns
// how many were folded. Old reports are never edited or deleted — each run posts a fresh comment
// and folds the previous ones. Failures are logged and swallowed: a stale expanded comment must
// not fail the pipeline.
export async function minimizeOutdatedReports(
    repoFullName: string,
    issueNumber: number,
    { marker, token }: { marker: string; token: string },
): Promise<number> {
    let minimized = 0;
    for (const comment of await listIssueComments(repoFullName, issueNumber, token)) {
        if (!comment.body?.includes(marker) || !comment.node_id) continue;
        try {
            await githubGraphql(
                `mutation($id: ID!) {
                    minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) {
                        minimizedComment { isMinimized }
                    }
                }`,
                { id: comment.node_id },
                token,
            );
            minimized += 1;
        } catch (error) {
            console.warn(`Could not minimize comment ${comment.id}: ${errorMessage(error)}`);
        }
    }
    return minimized;
}

// Most recently created PRs in the given state, for backtesting. With a `filter`, keeps paginating
// until `limit` matching PRs are collected, so "last N" means N PRs the caller cares about.
export async function listRecentPullRequests(
    repoFullName: string,
    {
        token,
        limit,
        state = 'closed',
        filter = () => true,
    }: { token: string; limit: number; state?: 'closed' | 'open'; filter?: (pull: any) => boolean },
): Promise<{ pulls: any[]; scanned: number }> {
    const pulls: any[] = [];
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
