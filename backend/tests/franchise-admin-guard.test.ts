/**
 * Batch A remediation (M1, L1, L2, L3): franchise administration re-checks the admin role in the database
 * on every location write and read, every policy read and every policy draft operation — a demoted admin's
 * still-valid token gets 403 and changes nothing — and state activation counts districts inside its
 * transaction, so concurrent district changes can't be enabled without review.
 * Everything is prefixed "zz-test-" and removed after.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string };
const people: Record<string, U> = {};
const codeBase = 100000 + Math.floor(Math.random() * 800000);
let codeSeq = 0;
const num = () => String(codeBase + codeSeq++);

async function makeUser(name: string, role: "USER" | "ADMIN") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `G${tag.slice(-8)}${userIds.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  // The token is signed with the role at issue time — exactly what a demoted admin still holds.
  people[name] = { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
const setRole = (u: U, role: "USER" | "ADMIN") => prisma.user.update({ where: { id: u.id }, data: { role } });

async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

const L = "/admin/franchise/locations";
const P = "/admin/franchise/policies";

async function newState(admin: U, districts: number) {
  const st = await call("POST", `${L}/states`, admin, { name: `${tag} S${num()}`, code: num() });
  assert.equal(st.status, 201, st.text);
  const ids: string[] = [];
  for (let i = 0; i < districts; i++) {
    const d = await call("POST", `${L}/districts`, admin, { stateId: st.body.id, name: `${tag} D${num()}`, code: num() });
    assert.equal(d.status, 201, d.text);
    ids.push(d.body.id);
  }
  return { stateId: st.body.id as string, districtIds: ids };
}
const activeDistricts = (stateId: string) => prisma.district.count({ where: { stateId, isActive: true } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("customer", "USER");
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-admin-guard test cleanup'`;
      const policies = (await tx.policyVersion.findMany({ where: { createdById: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const states = (await tx.indiaState.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((s) => s.id);
      const districts = (await tx.district.findMany({ where: { OR: [{ name: { startsWith: tag } }, { stateId: { in: states } }] }, select: { id: true } })).map((d) => d.id);
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...policies, ...states, ...districts] } }] } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.policyVersion.deleteMany({ where: { id: { in: policies } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { id: { in: states } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    const left = await prisma.user.count({ where: { email: { startsWith: tag } } });
    console.log(`leftovers users=${left} states=${await prisma.indiaState.count({ where: { name: { startsWith: tag } } })}`);
  } finally {
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});

describe("M1/L1/L2: a demoted admin's still-valid token is refused", () => {
  test("every location write is refused and changes nothing", async () => {
    const { stateId, districtIds } = await newState(people.admA, 1);
    const ex = await makeUser("ex-locations", "ADMIN");
    const csv = `state_code,state_name,district_code,district_name\n${num()},${tag} Imported,${num()},${tag} Imported D\n`;
    const pv = await call("POST", `${L}/import/preview`, people.admA, { csv, source: "guard test" });
    assert.equal(pv.body.valid, true, pv.text);
    await setRole(ex, "USER");
    const before = { states: await prisma.indiaState.count({ where: { name: { startsWith: tag } } }), districts: await prisma.district.count({ where: { name: { startsWith: tag } } }) };
    const attempts: [string, string, string, unknown][] = [
      ["create state", "POST", `${L}/states`, { name: `${tag} By ex`, code: num() }],
      ["rename state", "PATCH", `${L}/states/${stateId}`, { name: `${tag} Renamed by ex` }],
      ["enable state", "PATCH", `${L}/states/${stateId}`, { isActive: true, confirm: true }],
      ["activate state", "POST", `${L}/states/${stateId}/activate`, { confirm: true, expectedDistricts: 1 }],
      ["create district", "POST", `${L}/districts`, { stateId, name: `${tag} D by ex`, code: num() }],
      ["rename district", "PATCH", `${L}/districts/${districtIds[0]}`, { name: `${tag} D renamed by ex` }],
      ["enable district", "PATCH", `${L}/districts/${districtIds[0]}`, { isActive: true, confirm: true }],
      ["apply import", "POST", `${L}/import/apply`, { csv, expectedSha256: pv.body.fileSha256, source: "guard test", confirm: true }],
    ];
    for (const [label, method, path, body] of attempts) {
      const r = await call(method, path, ex, body);
      assert.equal(r.status, 403, `${label}: ${r.text}`);
    }
    assert.deepEqual(
      { states: await prisma.indiaState.count({ where: { name: { startsWith: tag } } }), districts: await prisma.district.count({ where: { name: { startsWith: tag } } }) },
      before,
      "no location was created"
    );
    const st = await prisma.indiaState.findUniqueOrThrow({ where: { id: stateId } });
    const d = await prisma.district.findUniqueOrThrow({ where: { id: districtIds[0] } });
    assert.equal(st.isActive, false);
    assert.equal(d.isActive, false);
    assert.ok(!st.name.includes("by ex") && !d.name.includes("by ex"), "nothing renamed");
    assert.equal(await prisma.auditLog.count({ where: { actorId: ex.id } }), 0, "no audit rows for refused actions");
  });

  test("location and policy reads are refused (and still work for a current admin)", async () => {
    const draft = await call("POST", P, people.admA, { domain: "GST_INVOICE" });
    assert.equal(draft.status, 201, draft.text);
    const ex = await makeUser("ex-reader", "ADMIN");
    await setRole(ex, "USER");
    const reads: [string, string, string, unknown?][] = [
      ["policy schema", "GET", `${P}/schema`],
      ["locations", "GET", L],
      ["import preview", "POST", `${L}/import/preview`, { csv: "state_code,state_name,district_code,district_name\n", source: "x" }],
      ["policy list", "GET", P],
      ["policy version", "GET", `${P}/${draft.body.policy.id}`],
      ["policy diff", "GET", `${P}/${draft.body.policy.id}/diff`],
      ["readiness", "GET", `${P}/readiness`],
      ["resolve", "GET", `${P}/resolve?domain=COMMERCIAL`],
      ["approvals", "GET", "/admin/franchise/approvals"],
    ];
    for (const [label, method, path, body] of reads) {
      const refused = await call(method, path, ex, body);
      assert.equal(refused.status, 403, `${label} (demoted): ${refused.text}`);
      const ok = await call(method, path, people.admA, body);
      assert.equal(ok.status, 200, `${label} (admin): ${ok.text}`);
    }
  });

  test("policy draft create, update, discard and submit are refused and change nothing", async () => {
    const drafter = await makeUser("ex-drafter", "ADMIN");
    const d = await call("POST", P, drafter, { domain: "GST_INVOICE" });
    assert.equal(d.status, 201, d.text);
    const policy = d.body.policy as { id: string; payloadSha256: string; payload: unknown };
    await setRole(drafter, "USER");
    const auditBefore = await prisma.auditLog.count({ where: { actorId: drafter.id } });
    const versionsBefore = await prisma.policyVersion.count({ where: { createdById: drafter.id } });
    const attempts: [string, string, string, unknown][] = [
      ["create", "POST", P, { domain: "GST_INVOICE" }],
      ["update", "PUT", `${P}/${policy.id}`, { payload: policy.payload, expectedSha: policy.payloadSha256 }],
      ["discard", "DELETE", `${P}/${policy.id}`, { expectedSha: policy.payloadSha256 }],
      ["submit", "POST", `${P}/${policy.id}/submit`, { expectedSha: policy.payloadSha256, reason: "should be refused" }],
    ];
    for (const [label, method, path, body] of attempts) {
      const r = await call(method, path, drafter, body);
      assert.equal(r.status, 403, `${label}: ${r.text}`);
    }
    const row = await prisma.policyVersion.findUniqueOrThrow({ where: { id: policy.id } });
    assert.equal(row.status, "DRAFT");
    assert.equal(row.payloadSha256, policy.payloadSha256);
    assert.equal(await prisma.policyVersion.count({ where: { createdById: drafter.id } }), versionsBefore, "no new draft");
    assert.equal(await prisma.adminApprovalRequest.count({ where: { requestedById: drafter.id } }), 0, "nothing submitted");
    assert.equal(await prisma.auditLog.count({ where: { actorId: drafter.id } }), auditBefore, "no audit rows for refused actions");
  });

  test("the check is live: a customer token is refused, and re-promotion restores access at once", async () => {
    assert.equal((await call("GET", L, people.customer)).status, 403);
    const flip = await makeUser("flip", "ADMIN");
    await setRole(flip, "USER");
    assert.equal((await call("GET", L, flip)).status, 403);
    await setRole(flip, "ADMIN");
    assert.equal((await call("GET", L, flip)).status, 200);
  });
});

describe("L3: state activation counts districts inside its transaction", () => {
  test("activating an unknown state is a 404 and records nothing", async () => {
    const unknownId = `missing-${tag}`;
    const r = await call("POST", `${L}/states/${unknownId}/activate`, people.admA, { confirm: true, expectedDistricts: 0 });
    assert.deepEqual([r.status, r.body.error], [404, "State not found"], r.text);
    assert.equal(await prisma.auditLog.count({ where: { target: unknownId } }), 0);
    assert.equal(await prisma.indiaState.count({ where: { id: unknownId } }), 0);
  });

  test("a district added after the admin's review blocks activation; nothing is enabled", async () => {
    const { stateId } = await newState(people.admA, 2);
    const late = await call("POST", `${L}/districts`, people.admA, { stateId, name: `${tag} Late`, code: num() });
    assert.equal(late.status, 201, late.text);
    const stale = await call("POST", `${L}/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts: 2 });
    assert.deepEqual([stale.status, stale.body.code, stale.body.toEnable], [409, "STALE", 3]);
    assert.equal((await prisma.indiaState.findUniqueOrThrow({ where: { id: stateId } })).isActive, false);
    assert.equal(await activeDistricts(stateId), 0);
    const ok = await call("POST", `${L}/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts: 3 });
    assert.deepEqual([ok.status, ok.body.districtsEnabled], [200, 3], ok.text);
    const audit = await prisma.auditLog.findMany({ where: { action: "FRANCHISE_STATE_ACTIVATED", target: stateId } });
    assert.equal(audit.length, 1);
    assert.equal((audit[0].metadata as { districtsEnabled: number }).districtsEnabled, 3);
  });

  test("concurrent district creation never yields an enabled district that wasn't counted", async () => {
    for (let round = 0; round < 8; round++) {
      const { stateId } = await newState(people.admA, 2);
      const [act, created] = await Promise.all([
        call("POST", `${L}/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts: 2 }),
        call("POST", `${L}/districts`, people.admA, { stateId, name: `${tag} Race${round}`, code: num() }),
      ]);
      assert.equal(created.status, 201, created.text);
      const newDistrict = await prisma.district.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(newDistrict.isActive, false, `round ${round}: a district added during activation is never enabled`);
      if (act.status === 200) {
        assert.equal(act.body.districtsEnabled, 2);
        assert.equal(await activeDistricts(stateId), 2, `round ${round}`);
      } else {
        assert.deepEqual([act.status, act.body.code], [409, "STALE"], `round ${round}: ${act.text}`);
        assert.equal(await activeDistricts(stateId), 0, `round ${round}`);
      }
    }
  });

  test("a district enabled individually during activation makes one of the two refuse", async () => {
    for (let round = 0; round < 6; round++) {
      const { stateId, districtIds } = await newState(people.admA, 2);
      const [act, patch] = await Promise.all([
        call("POST", `${L}/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts: 2 }),
        call("PATCH", `${L}/districts/${districtIds[0]}`, people.admA, { isActive: true, confirm: true }),
      ]);
      assert.ok([200, 409].includes(act.status), `round ${round} activate: ${act.text}`);
      assert.ok([200, 409].includes(patch.status), `round ${round} patch: ${patch.text}`);
      // Count what each path actually enabled from the audit trail (a PATCH arriving after activation can
      // find the district already on and change nothing).
      const enabledByActivation = act.status === 200 ? act.body.districtsEnabled : 0;
      const enabledByPatch = await prisma.auditLog.count({ where: { action: "FRANCHISE_DISTRICT_ACTIVATED", target: districtIds[0] } });
      assert.ok(enabledByPatch <= 1);
      if (enabledByPatch) assert.notEqual(enabledByActivation, 2, `round ${round}: district enabled by both paths`);
      assert.equal(await activeDistricts(stateId), enabledByActivation + enabledByPatch, `round ${round}: every enabled district is accounted for`);
    }
  });

  test("two activations at once: exactly one succeeds", async () => {
    const { stateId } = await newState(people.admA, 2);
    const results = await Promise.all([1, 2].map(() => call("POST", `${L}/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts: 2 })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], results.map((r) => r.text).join(" | "));
    assert.equal(await activeDistricts(stateId), 2);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STATE_ACTIVATED", target: stateId } }), 1);
  });
});

// ---------- B-4: a demotion racing an in-progress write, ordered by database locks (no timed sleeps) ----------

/**
 * Opens a transaction, runs `work` (which takes the locks), reports the transaction's backend pid, and keeps
 * the transaction open — holding those locks — until `release()` is called.
 */
function holdOpen(work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ready!: (pid: number) => void;
  let failed!: (e: unknown) => void;
  const pid = new Promise<number>((res, rej) => ((ready = res), (failed = rej)));
  const done = prisma
    .$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        await work(tx);
        ready(row.pid);
        await gate;
      },
      { maxWait: 10_000, timeout: 30_000 }
    )
    .catch((e) => {
      failed(e);
      throw e;
    });
  return { pid, release, done };
}

/** Backends currently waiting on a lock held by `holderPid` (PostgreSQL's own lock-wait graph). */
async function waitersOf(holderPid: number) {
  return prisma.$queryRaw<{ pid: number; query: string }[]>`SELECT "pid", "query" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))`;
}

/**
 * Waits until the database reports the condition. The short pause between checks is only a polling
 * interval; the ordering the tests rely on comes from the observed lock waits, not from timing.
 */
async function waitFor(what: string, check: () => Promise<boolean>, limitMs = 15_000) {
  const deadline = Date.now() + limitMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("B-4: an admin demoted while a write is in progress", () => {
  test("a demotion committed while the write waits on its in-transaction role check: the write is refused", async () => {
    const ex = await makeUser("race-demoted-first", "ADMIN");
    const name = `${tag} Race refused`;
    // The demotion takes the admin's row lock and stays uncommitted.
    const demotion = holdOpen((tx) => tx.user.update({ where: { id: ex.id }, data: { role: "USER" } }));
    const demotionPid = await demotion.pid;
    // The write's up-front check reads the committed role (still ADMIN) and passes; its in-transaction check
    // (SELECT … FOR SHARE on the same row) must wait for the demotion.
    const write = call("POST", `${L}/states`, ex, { name, code: num() });
    await waitFor("the write to wait on the demotion's row lock", async () => (await waitersOf(demotionPid)).some((w) => /FOR SHARE/i.test(w.query)));
    assert.equal(await prisma.indiaState.count({ where: { name } }), 0, "nothing written while waiting");
    demotion.release();
    await demotion.done;
    const r = await write;
    assert.equal(r.status, 403, `the write re-reads the committed demotion: ${r.text}`);
    assert.equal(await prisma.indiaState.count({ where: { name } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { actorId: ex.id } }), 0);
  });

  test("a write that already holds its role check finishes first; the demotion waits for it, then applies", async () => {
    const ex = await makeUser("race-write-first", "ADMIN");
    const { stateId } = await newState(people.admA, 1);
    // Hold the state row, so the activation stops right after its role check (which keeps the admin's row share-locked).
    const stateHold = holdOpen((tx) => tx.$queryRaw`SELECT "id" FROM "IndiaState" WHERE "id" = ${stateId} FOR UPDATE`);
    const holdPid = await stateHold.pid;
    const activation = call("POST", `${L}/states/${stateId}/activate`, ex, { confirm: true, expectedDistricts: 1 });
    let writerPid = 0;
    await waitFor("the activation to wait on the state row", async () => {
      const w = (await waitersOf(holdPid)).find((x) => /IndiaState/i.test(x.query) && /FOR UPDATE/i.test(x.query));
      writerPid = w?.pid ?? 0;
      return Boolean(w);
    });
    // Now demote the admin: the update must wait for the activation's share lock on the admin's row.
    let demotedAt: "before-release" | "after-release" | null = null;
    let released = false;
    const demotion = prisma.user.update({ where: { id: ex.id }, data: { role: "USER" } }).then(() => {
      demotedAt = released ? "after-release" : "before-release";
    });
    await waitFor("the demotion to wait on the activation's role lock", async () => (await waitersOf(writerPid)).some((w) => /UPDATE/i.test(w.query) && /"User"/.test(w.query)));
    assert.equal(demotedAt, null, "the demotion can't apply while the activation holds the role lock");
    released = true;
    stateHold.release();
    await stateHold.done;
    const r = await activation;
    await demotion;
    assert.equal(demotedAt, "after-release");
    assert.deepEqual([r.status, r.body.districtsEnabled], [200, 1], r.text);
    const audit = await prisma.auditLog.findMany({ where: { action: "FRANCHISE_STATE_ACTIVATED", target: stateId } });
    assert.deepEqual(audit.map((a) => a.actorId), [ex.id], "exactly one activation, by the admin who held the role at the time");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ex.id } })).role, "USER");
    const after = await call("POST", `${L}/states`, ex, { name: `${tag} After demotion`, code: num() });
    assert.equal(after.status, 403, "the next write sees the demotion");
  });
});
