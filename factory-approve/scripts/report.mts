// Markdown rendering of the pipeline outcome — one fixed template for both the approval review
// body and the rejection/error comment, in which only validated, length-capped reviewer text varies.

import type { Policy } from './policy.mts';
import type { ReviewerVerdict } from './verdict.mts';

// Hidden marker identifying factory report comments; each run folds earlier marked comments as
// outdated before posting its own.
export const REPORT_MARKER = '<!-- FACTORY-APPROVE-REPORT -->';

const STATUS_LINE = {
    approve: '✅ approved',
    reject: '❌ rejected',
    error: '⚠️ could not finish',
};

function gatesCell(staticChecks: { id: string; pass: boolean }[]): string {
    const failed = staticChecks.filter((check) => !check.pass);
    const passedCount = staticChecks.length - failed.length;
    if (failed.length === 0) return `✅ ${passedCount}/${staticChecks.length}`;
    return `❌ ${passedCount}/${staticChecks.length} — ${failed.map((check) => `\`${check.id}\``).join(', ')}`;
}

// `reviewerVerdicts` holds whatever stage 2 produced, in reviewer order; entries after a reject (or
// when gates never passed) render as "skipped" because the pipeline short-circuits — their missing
// verdict files are by design, not reviewer failures.
export function buildVerdictReport({
    verdict,
    reason,
    gates,
    reviewerVerdicts,
    policy,
    runUrl = '',
}: {
    verdict: 'approve' | 'reject' | 'error';
    reason: string;
    gates: any;
    reviewerVerdicts: ReviewerVerdict[];
    policy: Policy;
    runUrl?: string;
}): string {
    const lines = [`### 🏭 \`factory-approve\` — ${STATUS_LINE[verdict]}`, '', reason];

    // Approvals stay minimal: reason + footer. The result table only matters when something
    // stopped the pipeline and the reader needs to see where.
    if (verdict !== 'approve' && gates?.staticChecks?.length) {
        const rows = [['Static gates', gates.crashMessage ? '⚠️ crashed' : gatesCell(gates.staticChecks)]];
        // The action runs reviewer N only when reviewer N-1 approved, so entries after the first
        // non-approval were never started — render them as skipped rather than as failures.
        let shortCircuited = Boolean(gates.crashMessage) || !gates.staticPassed;
        policy.llm.reviewerModels.forEach((model, index) => {
            const label = `Reviewer ${index + 1} — \`${model}\`${index > 0 ? ', adversarial' : ''}`;
            const entry = reviewerVerdicts[index];
            let cell;
            if (shortCircuited) cell = '⏭️ skipped';
            else if (entry?.verdict === 'approve') cell = '✅ approve';
            else if (entry?.verdict === 'reject') cell = '❌ reject';
            else cell = '⚠️ no verdict';
            if (cell !== '✅ approve') shortCircuited = true;
            rows.push([label, cell]);
        });
        lines.push('', '| check | result |', '| --- | --- |', ...rows.map(([label, cell]) => `| ${label} | ${cell} |`));
    }

    if (verdict !== 'approve') {
        const detailLines: string[] = [];
        const failedChecks = (gates?.staticChecks ?? []).filter((check: any) => !check.pass);
        if (failedChecks.length > 0) {
            detailLines.push(
                '**Failed checks:**',
                '',
                ...failedChecks.map((check: any) => `- \`${check.id}\`: ${check.details}`),
                '',
            );
        }
        reviewerVerdicts.forEach((entry, index) => {
            if (!entry?.details) return;
            detailLines.push(`**Reviewer ${index + 1} — \`${policy.llm.reviewerModels[index] ?? '?'}\`:**`, '', entry.details, '');
        });
        detailLines.push(
            `The \`${policy.label}\` label stays on — the next push re-reviews automatically. Request a human ` +
                'reviewer, or remove the label to take this PR out of the auto-approve lane.',
        );
        // Blank lines around the body are required for markdown to render inside <details>.
        lines.push('', '<details>', '<summary>Details and next steps</summary>', '', ...detailLines, '', '</details>');
    }

    const shortSha = typeof gates?.headSha === 'string' && gates.headSha ? gates.headSha.slice(0, 9) : '';
    const footer = [
        shortSha && (verdict === 'approve' ? `Approval locked to \`${shortSha}\`` : `Reviewed \`${shortSha}\``),
        runUrl && `[workflow run](${runUrl})`,
    ].filter(Boolean);
    if (footer.length > 0) lines.push('', `<sub>${footer.join(' · ')}</sub>`);

    return lines.join('\n');
}
