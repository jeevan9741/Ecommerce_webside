import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { sha256Hex } from "../utils/canonical-json.js";
import { requireAdminInTx, requireAdminRead } from "./franchise-admin-guard.js";

/**
 * States/UTs and districts for the franchise programme. Locations are never deleted (applications and
 * allocations reference them); an admin disables them instead. Every new location — added by hand or
 * imported — starts DISABLED: applicants see it only after an admin has verified it against the
 * official LGD list and enabled it. A district is "available" when it is
 * active and no PRIMARY allocation holds it — the same RESERVED/ALLOCATED/SUSPENDED states that the
 * database's one-primary-per-district index protects.
 */

export const HOLDING_STATUSES = ["RESERVED", "ALLOCATED", "SUSPENDED"] as const;

/** District ids currently held by a primary franchise (reserved, allocated or suspended). */
export async function heldDistrictIds(districtIds?: string[]) {
  const rows = await prisma.districtAllocation.findMany({
    where: { role: "PRIMARY", status: { in: [...HOLDING_STATUSES] }, ...(districtIds ? { districtId: { in: districtIds } } : {}) },
    select: { districtId: true },
  });
  return new Set(rows.map((r) => r.districtId));
}

/** Public list: active states with their active districts and whether each can be applied for. */
export async function publicLocations() {
  const states = await prisma.indiaState.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, districts: { where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const held = await heldDistrictIds();
  return states.map((s) => ({ ...s, districts: s.districts.map((d) => ({ id: d.id, name: d.name, available: !held.has(d.id) })) }));
}

/** Admin list: every state and district with allocation and application counts. */
export async function adminLocations(actorId: string) {
  await requireAdminRead(actorId);
  const [states, held, applications] = await Promise.all([
    prisma.indiaState.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { districts: { orderBy: { name: "asc" }, select: { id: true, name: true, code: true, isActive: true } } },
    }),
    heldDistrictIds(),
    prisma.franchiseApplication.groupBy({ by: ["districtId"], where: { status: { not: "REJECTED" } }, _count: true }),
  ]);
  const open = new Map(applications.map((a) => [a.districtId, a._count]));
  return states.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    isActive: s.isActive,
    displayOrder: s.displayOrder,
    districts: s.districts.map((d) => ({ ...d, held: held.has(d.id), openApplications: open.get(d.id) ?? 0 })),
  }));
}

const cleanName = (v: unknown, what: string) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (s.length < 2 || s.length > 100) throw new HttpError(400, `${what} must be 2–100 characters.`, { code: "INVALID_REQUEST" });
  return s;
};
const cleanCode = (v: unknown) => {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^\d{1,6}$/.test(s)) throw new HttpError(400, "Codes are the official numeric LGD codes (up to 6 digits).", { code: "INVALID_REQUEST" });
  return s;
};
const conflict = (err: unknown): never => {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
    throw new HttpError(409, "A location with this name or code already exists.", { code: "DUPLICATE_LOCATION" });
  }
  throw err;
};

export async function createState(actorId: string, body: { name?: unknown; code?: unknown; displayOrder?: unknown }) {
  await requireAdminRead(actorId);
  const data = { name: cleanName(body.name, "State name"), code: cleanCode(body.code), isActive: false, displayOrder: Number.isInteger(body.displayOrder) ? (body.displayOrder as number) : 0 };
  return prisma
    .$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const state = await tx.indiaState.create({ data });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_CREATED", target: state.id, metadata: { code: state.code } } });
      return state;
    })
    .catch(conflict);
}

/**
 * `isActive` must be a real boolean when sent. Turning a disabled location on is the verification step,
 * so it needs `confirm: true` (a boolean, nothing else) on every route — PATCH and activate alike.
 */
function activationRequested(body: { isActive?: unknown; confirm?: unknown }, currentlyActive: boolean) {
  if (body.isActive === undefined) return false;
  if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false.", { code: "INVALID_REQUEST" });
  const enabling = body.isActive && !currentlyActive;
  if (enabling && body.confirm !== true) {
    throw new HttpError(400, "Confirm that this location was verified against the official LGD list before enabling it.", { code: "CONFIRMATION_REQUIRED" });
  }
  return enabling;
}

export async function updateState(actorId: string, id: string, body: { name?: unknown; code?: unknown; isActive?: unknown; displayOrder?: unknown; confirm?: unknown }) {
  await requireAdminRead(actorId);
  const current = await prisma.indiaState.findUnique({ where: { id }, select: { isActive: true } });
  if (!current) throw new HttpError(404, "State not found");
  const enabling = activationRequested(body, current.isActive);
  const data: { name?: string; code?: string | null; isActive?: boolean; displayOrder?: number } = {};
  if (body.name !== undefined) data.name = cleanName(body.name, "State name");
  if (body.code !== undefined) data.code = cleanCode(body.code);
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (Number.isInteger(body.displayOrder)) data.displayOrder = body.displayOrder as number;
  // Guarded on the state read above, so a concurrent change can't turn an unconfirmed edit into an enable.
  return prisma
    .$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const { count } = await tx.indiaState.updateMany({ where: { id, isActive: current.isActive }, data });
      if (count !== 1) throw new HttpError(409, "This state changed — reload and try again.", { code: "STALE" });
      const state = await tx.indiaState.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: { actorId, action: enabling ? "FRANCHISE_STATE_ACTIVATED" : "FRANCHISE_STATE_UPDATED", target: id, metadata: { isActive: state.isActive, code: state.code, ...(enabling ? { verifiedConfirmed: true, districtsEnabled: 0 } : {}) } },
      });
      return state;
    })
    .catch(conflict);
}

export async function createDistrict(actorId: string, body: { stateId?: unknown; name?: unknown; code?: unknown }) {
  await requireAdminRead(actorId);
  const stateId = typeof body.stateId === "string" ? body.stateId : "";
  if (!(await prisma.indiaState.findUnique({ where: { id: stateId } }))) throw new HttpError(404, "State not found");
  const data = { stateId, name: cleanName(body.name, "District name"), code: cleanCode(body.code), isActive: false };
  return prisma
    .$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const district = await tx.district.create({ data });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_DISTRICT_CREATED", target: district.id, metadata: { stateId, code: district.code } } });
      return district;
    })
    .catch(conflict);
}

export async function updateDistrict(actorId: string, id: string, body: { name?: unknown; code?: unknown; isActive?: unknown; confirm?: unknown }) {
  await requireAdminRead(actorId);
  const current = await prisma.district.findUnique({ where: { id }, select: { isActive: true } });
  if (!current) throw new HttpError(404, "District not found");
  const enabling = activationRequested(body, current.isActive);
  const data: { name?: string; code?: string | null; isActive?: boolean } = {};
  if (body.name !== undefined) data.name = cleanName(body.name, "District name");
  if (body.code !== undefined) data.code = cleanCode(body.code);
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  return prisma
    .$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const { count } = await tx.district.updateMany({ where: { id, isActive: current.isActive }, data });
      if (count !== 1) throw new HttpError(409, "This district changed — reload and try again.", { code: "STALE" });
      const district = await tx.district.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: { actorId, action: enabling ? "FRANCHISE_DISTRICT_ACTIVATED" : "FRANCHISE_DISTRICT_UPDATED", target: id, metadata: { isActive: district.isActive, code: district.code, ...(enabling ? { verifiedConfirmed: true } : {}) } },
      });
      return district;
    })
    .catch(conflict);
}

/**
 * Enables a state and every disabled district in it, after the admin has verified them against the
 * official list. Needs explicit confirmation and the exact number of districts the admin reviewed.
 * The count is taken inside the transaction with the state row locked: a district added meanwhile waits
 * for this to finish (its foreign key needs the state row) and stays disabled, and only the districts
 * counted here are enabled — a concurrent change makes the whole activation refuse instead.
 */
export async function activateState(actorId: string, id: string, body: { confirm?: unknown; expectedDistricts?: unknown }) {
  await requireAdminRead(actorId);
  if (body.confirm !== true) throw new HttpError(400, "Confirm that this state and its districts were verified against the official LGD list.", { code: "CONFIRMATION_REQUIRED" });
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const locked = await tx.$queryRaw<{ id: string; code: string | null }[]>`SELECT "id", "code" FROM "IndiaState" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked.length) throw new HttpError(404, "State not found");
    const pending = await tx.district.findMany({ where: { stateId: id, isActive: false }, select: { id: true } });
    if (body.expectedDistricts !== pending.length) throw new HttpError(409, "The district list changed — review it again.", { code: "STALE", toEnable: pending.length });
    await tx.indiaState.update({ where: { id }, data: { isActive: true } });
    const { count } = await tx.district.updateMany({ where: { id: { in: pending.map((d) => d.id) }, stateId: id, isActive: false }, data: { isActive: true } });
    if (count !== pending.length) throw new HttpError(409, "The district list changed — review it again.", { code: "STALE" });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_ACTIVATED", target: id, metadata: { code: locked[0].code, districtsEnabled: count } } });
    return { id, districtsEnabled: count };
  });
}

// ---------- CSV import (official LGD extract): preview, then apply the exact file reviewed ----------

export interface ImportRow {
  line: number;
  stateCode: string;
  stateName: string;
  districtCode: string;
  districtName: string;
}

const MAX_ROWS = 5000;

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Validates an import file: header `state_code,state_name,district_code,district_name`, numeric codes,
 * one name per code, no duplicate district codes or duplicate names within a state, and a state code
 * that never maps to two different names. Returns the rows plus the plan against the database.
 */
const LIST_LIMIT = 2000;

export async function previewImport(csv: unknown, source?: unknown) {
  if (typeof csv !== "string" || csv.length === 0) throw new HttpError(400, "Paste or upload the CSV text.", { code: "INVALID_REQUEST" });
  if (csv.length > 2_000_000) throw new HttpError(413, "The file is too large.", { code: "FILE_TOO_LARGE" });
  const fileSha256 = sha256Hex(csv);
  const table = parseCsv(csv.replace(/^﻿/, ""));
  const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const expected = ["state_code", "state_name", "district_code", "district_name"];
  const errors: string[] = [];
  if (header.join(",") !== expected.join(",")) errors.push(`Header must be exactly: ${expected.join(",")}`);
  if (table.length > MAX_ROWS) errors.push(`At most ${MAX_ROWS} rows`);
  const rows: ImportRow[] = [];
  const stateNames = new Map<string, string>();
  const districtCodes = new Map<string, number>();
  const districtNames = new Map<string, number>();
  table.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== 4) return errors.push(`Line ${line}: expected 4 columns, got ${cells.length}`);
    const [stateCode, stateName, districtCode, districtName] = cells.map((c) => c.trim().replace(/\s+/g, " "));
    if (!/^\d{1,6}$/.test(stateCode)) errors.push(`Line ${line}: state_code must be numeric`);
    if (!/^\d{1,6}$/.test(districtCode)) errors.push(`Line ${line}: district_code must be numeric`);
    if (stateName.length < 2 || stateName.length > 100) errors.push(`Line ${line}: state_name must be 2–100 characters`);
    if (districtName.length < 2 || districtName.length > 100) errors.push(`Line ${line}: district_name must be 2–100 characters`);
    const knownState = stateNames.get(stateCode);
    if (knownState && knownState !== stateName) errors.push(`Line ${line}: state_code ${stateCode} is both "${knownState}" and "${stateName}"`);
    stateNames.set(stateCode, stateName);
    if (districtCodes.has(districtCode)) errors.push(`Line ${line}: district_code ${districtCode} repeats line ${districtCodes.get(districtCode)}`);
    districtCodes.set(districtCode, line);
    const nameKey = `${stateCode}|${districtName.toLowerCase()}`;
    if (districtNames.has(nameKey)) errors.push(`Line ${line}: "${districtName}" repeats line ${districtNames.get(nameKey)} in the same state`);
    districtNames.set(nameKey, line);
    rows.push({ line, stateCode, stateName, districtCode, districtName });
  });

  // Plan against what exists (matching by official code; names may be corrected by an import).
  const [states, districts] = await Promise.all([
    prisma.indiaState.findMany({ select: { id: true, code: true, name: true } }),
    prisma.district.findMany({ select: { id: true, code: true, name: true, stateId: true, state: { select: { code: true } } } }),
  ]);
  const stateByCode = new Map(states.filter((s) => s.code).map((s) => [s.code!, s]));
  const stateByName = new Map(states.map((s) => [s.name.toLowerCase(), s]));
  const districtByCode = new Map(districts.filter((d) => d.code).map((d) => [d.code!, d]));
  const plan = { newStates: 0, renamedStates: 0, newDistricts: 0, renamedDistricts: 0, movedDistricts: 0, unchanged: 0 };
  const changes = {
    addedStates: [] as { code: string; name: string }[],
    renamedStates: [] as { code: string; from: string; to: string }[],
    addedDistricts: [] as { stateCode: string; code: string; name: string }[],
    renamedDistricts: [] as { code: string; from: string; to: string }[],
    missingDistricts: [] as { code: string; name: string; stateCode: string | null }[],
  };
  const note = <T>(list: T[], item: T) => {
    if (list.length < LIST_LIMIT) list.push(item);
  };
  for (const [code, name] of stateNames) {
    const existing = stateByCode.get(code);
    if (!existing) {
      const byName = stateByName.get(name.toLowerCase());
      if (byName && byName.code && byName.code !== code) errors.push(`State "${name}" already exists with code ${byName.code}, not ${code}`);
      plan.newStates++;
      note(changes.addedStates, { code, name });
    } else if (existing.name !== name) {
      plan.renamedStates++;
      note(changes.renamedStates, { code, from: existing.name, to: name });
    }
  }
  const districtByStateName = new Map(districts.map((d) => [`${d.stateId}|${d.name.toLowerCase()}`, d]));
  for (const r of rows) {
    const existing = districtByCode.get(r.districtCode);
    const state = stateByCode.get(r.stateCode);
    const sameName = state ? districtByStateName.get(`${state.id}|${r.districtName.toLowerCase()}`) : undefined;
    if (!existing && sameName?.code && sameName.code !== r.districtCode) errors.push(`Line ${r.line}: "${r.districtName}" already exists with code ${sameName.code}, not ${r.districtCode}`);
    if (!existing) {
      plan.newDistricts++;
      note(changes.addedDistricts, { stateCode: r.stateCode, code: r.districtCode, name: r.districtName });
    } else if (existing.state.code !== r.stateCode) plan.movedDistricts++;
    else if (existing.name !== r.districtName) {
      plan.renamedDistricts++;
      note(changes.renamedDistricts, { code: r.districtCode, from: existing.name, to: r.districtName });
    } else plan.unchanged++;
  }
  if (plan.movedDistricts) errors.push(`${plan.movedDistricts} district code(s) would move to another state — not applied automatically; review them first`);
  const fileCodes = new Set(rows.map((r) => r.districtCode));
  // Existing districts the file doesn't contain (including ones with no official code): reported, never removed.
  const missing = districts.filter((d) => !d.code || !fileCodes.has(d.code));
  for (const d of missing) note(changes.missingDistricts, { code: d.code ?? "", name: d.name, stateCode: d.state.code });
  const sourceName = typeof source === "string" ? source.trim() : "";
  return {
    source: sourceName || null,
    fileSha256,
    rows: rows.length,
    states: stateNames.size,
    plan,
    notInFile: missing.length,
    changes,
    listLimit: LIST_LIMIT,
    errors: errors.slice(0, 200),
    errorCount: errors.length,
    valid: errors.length === 0,
  };
}

/**
 * Applies a previewed file (the hash must match what was reviewed). Creates and renames by official
 * code; never deletes or disables anything not in the file (reported as `notInFile` instead).
 */
export async function applyImport(actorId: string, input: { csv: unknown; expectedSha256: unknown; source: unknown; confirm?: unknown }) {
  await requireAdminRead(actorId);
  if (input.confirm !== true) throw new HttpError(400, "Confirm the import after reviewing the preview.", { code: "CONFIRMATION_REQUIRED" });
  const preview = await previewImport(input.csv, input.source);
  if (preview.fileSha256 !== input.expectedSha256) throw new HttpError(409, "The file differs from the one you previewed.", { code: "STALE" });
  if (!preview.valid) throw new HttpError(400, "The file has errors — fix them and preview again.", { code: "INVALID_IMPORT", errors: preview.errors });
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length < 5) throw new HttpError(400, "Name the source of the file (e.g. LGD download and date).", { code: "SOURCE_REQUIRED" });
  const table = parseCsv((input.csv as string).replace(/^﻿/, ""));
  table.shift();
  const rows = table.map((c) => c.map((x) => x.trim().replace(/\s+/g, " ")));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('eta-location-import'))`;
    await requireAdminInTx(tx, actorId);
    const stateIds = new Map<string, string>();
    for (const [stateCode, stateName] of new Map(rows.map((r) => [r[0], r[1]]))) {
      const existing = (await tx.indiaState.findUnique({ where: { code: stateCode } })) ?? (await tx.indiaState.findUnique({ where: { name: stateName } }));
      const state = existing
        ? await tx.indiaState.update({ where: { id: existing.id }, data: { name: stateName, code: stateCode } })
        : await tx.indiaState.create({ data: { name: stateName, code: stateCode, isActive: false } });
      stateIds.set(stateCode, state.id);
    }
    for (const [stateCode, , districtCode, districtName] of rows) {
      const stateId = stateIds.get(stateCode)!;
      const existing = await tx.district.findUnique({ where: { code: districtCode } });
      if (existing) await tx.district.update({ where: { id: existing.id }, data: { name: districtName } });
      else {
        const byName = await tx.district.findUnique({ where: { stateId_name: { stateId, name: districtName } } });
        if (byName) await tx.district.update({ where: { id: byName.id }, data: { code: districtCode } });
        else await tx.district.create({ data: { stateId, name: districtName, code: districtCode, isActive: false } });
      }
    }
    await tx.auditLog.create({
      data: { actorId, action: "FRANCHISE_LOCATIONS_IMPORTED", target: preview.fileSha256, metadata: { source, fileSha256: preview.fileSha256, rows: preview.rows, states: preview.states, ...preview.plan, notInFile: preview.notInFile, createdDisabled: true } },
    });
  }, { timeout: 120_000 });
  return { ...preview, applied: true };
}
