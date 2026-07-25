// Minimal dependency-free glob matching for repo-relative paths (forward slashes, no leading `./`):
// `**` matches across path segments, `*` within a segment, `?` a single character.

function globToRegExp(glob: string): RegExp {
    let pattern = '';
    let i = 0;
    while (i < glob.length) {
        const char = glob[i];
        if (char === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    pattern += '(?:[^/]+/)*'; // `**/` — zero or more whole segments
                    i += 3;
                } else {
                    pattern += '.*'; // trailing or bare `**`
                    i += 2;
                }
            } else {
                pattern += '[^/]*';
                i += 1;
            }
        } else if (char === '?') {
            pattern += '[^/]';
            i += 1;
        } else {
            pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i += 1;
        }
    }
    return new RegExp(`^${pattern}$`);
}

export function matchingGlob(filePath: string, globs: string[]): string | null {
    for (const glob of globs) {
        if (globToRegExp(glob).test(filePath)) return glob;
    }
    return null;
}
