// Test-only preload (see package.json "test"). Admin MFA is off by default (utils/feature-flags.ts); this pins
// "off" so a developer's shell can't switch it on for the older suites, whose admin tokens carry no second
// factor. tests/admin-mfa.test.ts switches it on and covers MFA end to end.
process.env.ADMIN_MFA_ENFORCEMENT ??= "off";
