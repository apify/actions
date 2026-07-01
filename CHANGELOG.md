# Changelog

## [1.3.2](https://github.com/apify/actions/compare/v1.3.1...v1.3.2) (2026-07-01)


### Bug Fixes

* increase child process output buffer size in `signed-commit` to handle large diffs ([#31](https://github.com/apify/actions/issues/31)) ([49ee1be](https://github.com/apify/actions/commit/49ee1be7944c664917334d34760b863452a9bc6e))

## [1.3.1](https://github.com/apify/actions/compare/v1.3.0...v1.3.1) (2026-07-01)


### Bug Fixes

* **pnpm-install:** bump actions/cache to v6.1.0 to drop deprecated Node.js 20 runtime ([#29](https://github.com/apify/actions/issues/29)) ([7927d91](https://github.com/apify/actions/commit/7927d914a01bea7f52e771cdf9cf0a1630dfb8b4))

## [1.3.0](https://github.com/apify/actions/compare/v1.2.0...v1.3.0) (2026-06-05)


### Features

* enhance MongoDB index checker with detailed sharding guidelines and common patterns ([#25](https://github.com/apify/actions/issues/25)) ([ebbf103](https://github.com/apify/actions/commit/ebbf10368eb33412fd89dbc7094c25ba8dfb1789))
* extend MongoDB index-check prompt with six more review patterns ([#21](https://github.com/apify/actions/issues/21)) ([8bab229](https://github.com/apify/actions/commit/8bab22948562bab4bb1a4a962e5571709676550f))
* PR title check action ([#24](https://github.com/apify/actions/issues/24)) ([28507c2](https://github.com/apify/actions/commit/28507c283529cfd5de11f7046443d25a39cb73e4))
* Update model version from claude-opus-4-7 to claude-opus-4-8 ([#26](https://github.com/apify/actions/issues/26)) ([f4bd7c9](https://github.com/apify/actions/commit/f4bd7c9aeaf8c43aaac13b17e41025a32dcec039))


### Bug Fixes

* **git-cliff-release:** Improve behavior with no existing version tag ([#27](https://github.com/apify/actions/issues/27)) ([9d7631e](https://github.com/apify/actions/commit/9d7631e09fd7cc1246532c903cb22633ea3eafa4))

## [1.2.0](https://github.com/apify/actions/compare/v1.1.2...v1.2.0) (2026-05-19)


### Features

* Update of MongoDB index checker, prompt, deduplication, etc. ([#17](https://github.com/apify/actions/issues/17)) ([86b91e4](https://github.com/apify/actions/commit/86b91e4edff0c8303012e4592345c0b75f91c790))


### Bug Fixes

* Update `signed-commit` action to fix issues with unstaged or conflicted files ([#22](https://github.com/apify/actions/issues/22)) ([5e8686c](https://github.com/apify/actions/commit/5e8686c8ee6814be65af30c049855cc220409150))

## [1.1.2](https://github.com/apify/actions/compare/v1.1.1...v1.1.2) (2026-05-18)


### Bug Fixes

* Correctly pass inputs to `github-script` actions ([#15](https://github.com/apify/actions/issues/15)) ([345a1cd](https://github.com/apify/actions/commit/345a1cd7be9530977aaf169323f7a612eddee1df))

## [1.1.1](https://github.com/apify/actions/compare/v1.1.0...v1.1.1) (2026-05-18)


### Bug Fixes

* Fix type imports in actions using `github-script` ([#13](https://github.com/apify/actions/issues/13)) ([7000329](https://github.com/apify/actions/commit/7000329e667503c515621568ab031b2c21c28ff1))

## [1.1.0](https://github.com/apify/actions/compare/v1.0.0...v1.1.0) (2026-05-18)


### Features

* add mongodb-query-index-check action ([#3](https://github.com/apify/actions/issues/3)) ([e288951](https://github.com/apify/actions/commit/e288951cc60592067bc9962ffa2eff88042f27e2))
* add python-package-check composite action ([#11](https://github.com/apify/actions/issues/11)) ([cafe9c0](https://github.com/apify/actions/commit/cafe9c01037ad8d0db8335d80807c26c03435186))
* bump max-turns default to 100 and stream full Claude output ([#7](https://github.com/apify/actions/issues/7)) ([812c5cb](https://github.com/apify/actions/commit/812c5cbef2ac17071ecbafefdf14d993435d2d45))
* expand allowed-tools list for mongodb-query-index-check ([#6](https://github.com/apify/actions/issues/6)) ([42e0fe2](https://github.com/apify/actions/commit/42e0fe2e29c013cc85d19c05706c1ca919cf7a91))
* make the review prompt directive instead of descriptive ([#8](https://github.com/apify/actions/issues/8)) ([910af2a](https://github.com/apify/actions/commit/910af2ae269e3057a9fb68e733f8ae8ee8f39b13))
* mention [@mtrunkat](https://github.com/mtrunkat) in the review summary on findings ([#12](https://github.com/apify/actions/issues/12)) ([2f0becd](https://github.com/apify/actions/commit/2f0becd0c89a7e8772b1172f75d17cb746501448))


### Bug Fixes

* move state files into workspace and address bash sandbox denials ([#9](https://github.com/apify/actions/issues/9)) ([6e2aa05](https://github.com/apify/actions/commit/6e2aa054ff3ba8e47be4ccddf6c1958434d3618c))
* Stop using `@octokit/rest` in scripts ([#10](https://github.com/apify/actions/issues/10)) ([232b613](https://github.com/apify/actions/commit/232b61378362e7a3e4ae78a4eda18b42c990bfe4))

## 1.0.0 (2026-05-15)


### Features

* Add custom GitHub Actions to a separate repository ([#1](https://github.com/apify/actions/issues/1)) ([09aeef7](https://github.com/apify/actions/commit/09aeef75a109aeb29cf7d5374d0e4531e7d84e5b))
