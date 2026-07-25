// Exact fingerprint of the content a review verdict applies to, used to skip re-reviewing pushes
// that don't change what the reviewers would see (develop-syncs, rebases, empty commits). Only hunk
// line numbers are normalized away — any other change, including whitespace, produces a new
// fingerprint. The policy is hashed in as a salt, so changing the rules invalidates stored verdicts.

import { createHash } from 'node:crypto';

import type { Policy } from './policy.mts';

const FINGERPRINT_VERSION = 1;
const MARKER_REGEX = /<!-- FACTORY-APPROVE-FINGERPRINT v(\d+) (approve|reject) ([0-9a-f]{64}) -->/;

// JSON.stringify that serializes RegExp values (JSON.stringify alone turns them into `{}`).
export const stableStringify = (value: unknown) =>
    JSON.stringify(value, (_key, entry) => (entry instanceof RegExp ? String(entry) : entry));

// Strips hunk line numbers (`@@ -12,5 +13,6 @@` → `@@`); they shift on rebases and syncs.
const normalizePatch = (patch: string) => patch.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, '@@');

export function computeReviewFingerprint({ title, files, policy }: { title: string; files: any[]; policy: Policy }): string {
    const hash = createHash('sha256');
    hash.update(`v${FINGERPRINT_VERSION}\0${stableStringify(policy)}\0${title}\0`);
    const sorted = [...files].sort((a, b) => (a.filename < b.filename ? -1 : 1));
    for (const file of sorted) {
        hash.update(`${file.filename}\0${file.status}\0${file.previous_filename ?? ''}\0`);
        hash.update(normalizePatch(file.patch ?? ''));
        hash.update('\0');
    }
    return hash.digest('hex');
}

// Hidden marker embedded in the factory's review/comment body.
export function fingerprintMarker(verdict: 'approve' | 'reject', fingerprint: string): string {
    return `<!-- FACTORY-APPROVE-FINGERPRINT v${FINGERPRINT_VERSION} ${verdict} ${fingerprint} -->`;
}

// Newest fingerprint record among the factory account's reviews and comments. Only factory-authored
// bodies are trusted — nobody else can plant an "already reviewed" marker, because reviews and
// comments cannot be authored under another user's login. Other marker versions are ignored.
export function findPriorVerdict({
    reviews,
    comments,
    factoryLogin,
}: {
    reviews: any[];
    comments: any[];
    factoryLogin: string;
}): { verdict: 'approve' | 'reject'; fingerprint: string } | null {
    const records: { at: string; verdict: 'approve' | 'reject'; fingerprint: string }[] = [];
    const collect = (items: any[], timestamp: (item: any) => string) => {
        for (const item of items) {
            if (item.user?.login !== factoryLogin) continue;
            const match = item.body?.match(MARKER_REGEX);
            if (!match || Number(match[1]) !== FINGERPRINT_VERSION) continue;
            records.push({ at: timestamp(item), verdict: match[2], fingerprint: match[3] });
        }
    };
    collect(reviews, (review) => review.submitted_at ?? '');
    collect(comments, (comment) => comment.created_at ?? '');
    records.sort((a, b) => (a.at > b.at ? -1 : 1));
    return records[0] ? { verdict: records[0].verdict, fingerprint: records[0].fingerprint } : null;
}

// Latest effective review state per human reviewer: APPROVED or CHANGES_REQUESTED, with later
// reviews superseding earlier ones and dismissed reviews never counting (GitHub flips their state
// to DISMISSED). The PR author and the factory account are ignored.
export function activeHumanReviews({
    pr,
    reviews,
    factoryLogin,
}: {
    pr: any;
    reviews: any[];
    factoryLogin: string;
}): Map<string, string> {
    const latestStates = new Map<string, string>();
    for (const review of reviews) {
        const login = review.user?.login;
        if (!login || login === pr.user?.login || login === factoryLogin) continue;
        if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
            latestStates.set(login, review.state);
        }
    }
    return latestStates;
}
