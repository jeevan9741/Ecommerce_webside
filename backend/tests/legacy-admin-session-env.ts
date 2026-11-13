// Test-only preload (see package.json "test"). The older suites sign admin session tokens directly, without
// a second factor, so they run with admin MFA enforcement off. tests/admin-mfa.test.ts switches it back on
// and covers MFA end to end. Production can't switch it off (see utils/feature-flags.ts).
process.env.ADMIN_MFA_ENFORCEMENT ??= "off";
