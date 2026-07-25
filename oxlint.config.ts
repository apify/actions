import { defineConfig } from '@apify/oxlint-config';

export default defineConfig({
    options: {
        typeAware: true,
    },
    overrides: [
        {
            // Unlike the github-script based actions (which log via the injected `core`), the
            // factory-approve scripts run as plain `node` CLIs, so console is their logging interface.
            files: ['factory-approve/**'],
            rules: {
                'no-console': 'off',
            },
        },
    ],
});
