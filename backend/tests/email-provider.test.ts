/**
 * Email providers after the SMTP path was removed: "resend" (production) and "console" (local development).
 * Anything else — including the old "smtp" — is refused when sending in production (never silently printed),
 * is reported at boot, and nodemailer is no longer installed. No email is sent: Resend isn't called here.
 */
import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const { sendEmail, checkEmailOnStartup } = await import("../src/services/email.service.js");

const saved = { provider: process.env.EMAIL_PROVIDER, node: process.env.NODE_ENV, key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
afterEach(() => {
  for (const [name, value] of [["EMAIL_PROVIDER", saved.provider], ["NODE_ENV", saved.node], ["RESEND_API_KEY", saved.key], ["EMAIL_FROM", saved.from]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mock.restoreAll();
});

function captureLogs() {
  const lines: string[] = [];
  mock.method(console, "log", (...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  mock.method(console, "error", (...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  return lines;
}

describe("email providers", () => {
  test('"smtp" is no longer a provider: sending in production fails loudly and nothing is printed', async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.NODE_ENV = "production";
    const lines = captureLogs();
    await assert.rejects(sendEmail({ to: "someone@example.test", subject: "Your code", html: "<p>123456</p>" }), /EMAIL_PROVIDER is not set to a real provider \("smtp"\)/);
    assert.equal(lines.some((l) => l.includes("123456") || l.includes("DEV EMAIL")), false, "the email (and any code in it) is never logged");
  });

  test("boot report for resend is unchanged and never mentions SMTP", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_only";
    process.env.EMAIL_FROM = "ETA <no-reply@example.test>";
    const lines = captureLogs();
    await checkEmailOnStartup();
    assert.equal(lines[0], "[EMAIL] provider=resend");
    assert.equal(lines[1], "[EMAIL] RESEND_API_KEY=set EMAIL_FROM=ETA <no***@example.test>");
    assert.match(lines[2], /^\[EMAIL\] admin notifications: /);
    assert.equal(lines.length, 3);
    assert.equal(lines.some((l) => /smtp/i.test(l)), false);
  });

  test('with "smtp" configured, the boot report attempts no SMTP login and prints no SMTP settings', async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.NODE_ENV = "production";
    const lines = captureLogs();
    await checkEmailOnStartup();
    assert.deepEqual(lines.filter((l) => /SMTP_|SMTP login|SMTP check/.test(l)), []);
    assert.equal(lines[0], '[EMAIL] provider=smtp');
  });

  test("console mode still prints emails locally (outside production)", async () => {
    process.env.EMAIL_PROVIDER = "console";
    process.env.NODE_ENV = "development";
    const lines = captureLogs();
    await sendEmail({ to: "dev@example.test", subject: "Local check", html: "<p>hello</p>" });
    assert.ok(lines.some((l) => l.includes('[DEV EMAIL] to=dev@example.test subject="Local check"')));
  });

  test('production config check warns about "smtp" at boot', () => {
    // productionConfigProblems() reads NODE_ENV once at import, so it runs in its own production-mode process.
    // That process has no secrets and connects to nothing (the database URL points at a closed local port).
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", 'import("./src/config/env.ts").then((m) => console.log(JSON.stringify(m.productionConfigProblems())))'],
      { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_ENV: "production", EMAIL_PROVIDER: "smtp", JWT_SECRET: "test-only-0123456789abcdef", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/none" }, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    const problems = JSON.parse(r.stdout.trim().split("\n").pop()!) as string[];
    assert.ok(problems.includes('EMAIL_PROVIDER is "smtp" — set it to "resend" or verification emails will fail'), JSON.stringify(problems));
  });

  test("nodemailer is no longer installed", async () => {
    await assert.rejects(import("nodemailer" as string), (e: { code?: string }) => e.code === "ERR_MODULE_NOT_FOUND");
  });
});
