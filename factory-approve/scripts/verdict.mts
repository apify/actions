// Strict parsing and aggregation of the verdict files the claude-code-action steps write. Any
// deviation from the contract throws; callers treat a throw as a non-approval (fail closed).

import type { Policy } from './policy.mts';

export type ReviewerVerdict = { verdict: string; reason: string; details?: string };

export function parseVerdict(fileContent: string, policy: Policy): ReviewerVerdict {
    let parsed: any;
    try {
        parsed = JSON.parse(fileContent.trim());
    } catch {
        throw new Error('verdict file is not a single JSON object');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('verdict file is not a JSON object');
    }
    if (parsed.verdict !== 'approve' && parsed.verdict !== 'reject') {
        throw new Error(`invalid verdict ${JSON.stringify(parsed.verdict)}`);
    }
    if (typeof parsed.reason !== 'string' || parsed.reason.trim().length === 0) {
        throw new Error('missing verdict reason');
    }
    const reason = parsed.reason.replace(/\s+/g, ' ').trim().slice(0, policy.llm.maxReasonChars);
    if (parsed.details !== undefined && typeof parsed.details !== 'string') {
        throw new Error('verdict details must be a string when present');
    }
    // Newlines are kept (details render as markdown), but CRs and trailing noise are not.
    const details = parsed.details?.replace(/\r\n?/g, '\n').trim().slice(0, policy.llm.maxDetailsChars);
    return { verdict: parsed.verdict, reason, ...(details ? { details } : {}) };
}

// Unanimity is required to approve; a definitive reject wins over an error; anything else fails
// closed as an error.
export function aggregateVerdicts(verdicts: ReviewerVerdict[]): { verdict: 'approve' | 'reject' | 'error'; reason: string } {
    if (verdicts.length === 0) return { verdict: 'error', reason: 'No reviewer produced a verdict.' };
    const reject = verdicts.find((entry) => entry.verdict === 'reject');
    if (reject) return { verdict: 'reject', reason: reject.reason };
    const error = verdicts.find((entry) => entry.verdict !== 'approve');
    if (error) return { verdict: 'error', reason: error.reason };
    return { verdict: 'approve', reason: verdicts[0].reason };
}
