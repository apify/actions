import { defineConfig } from '@apify/oxlint-config';

export default defineConfig({
    options: {
        typeAware: true,
    },
    overrides: [
        {
            // factory-approve ships standalone Node CLI scripts (run via `node`, not github-script)
            // plus a local backtest tool, so logging to stdout is the intended interface.
            files: ['factory-approve/scripts/**', 'factory-approve/backtest/**'],
            rules: {
                'no-console': 'off',
            },
        },
    ],
});
