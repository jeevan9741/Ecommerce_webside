// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  differentOffset,
  formatCountdown,
  formatSessionDate,
  formatTime,
  formatTimeRange,
  joinOpen,
  liveState,
  timeZoneLabel,
} from "../lib/live-session.ts";

const session = {
  startsAt: "2026-10-20T13:30:00.000Z", // 7:00 PM IST
  endsAt: "2026-10-20T15:30:00.000Z", // 9:00 PM IST
  joinOpensAt: "2026-10-20T13:15:00.000Z",
  state: "UPCOMING",
};
const at = (iso) => Date.parse(iso);

test("badge state follows the (server-corrected) clock between fetches", () => {
  assert.equal(liveState(session, at("2026-10-20T13:00:00Z")), "UPCOMING");
  assert.equal(liveState(session, at("2026-10-20T13:30:00Z")), "LIVE");
  assert.equal(liveState(session, at("2026-10-20T15:30:00Z")), "COMPLETED");
  // A session fetched as LIVE becomes COMPLETED on its own once it ends.
  assert.equal(liveState({ ...session, state: "LIVE" }, at("2026-10-20T16:00:00Z")), "COMPLETED");
  assert.equal(liveState({ ...session, state: "CANCELLED" }, at("2026-10-20T14:00:00Z")), "CANCELLED");
});

test("Join is enabled only inside the joining window", () => {
  assert.equal(joinOpen(session, at("2026-10-20T13:14:59Z")), false);
  assert.equal(joinOpen(session, at("2026-10-20T13:15:00Z")), true);
  assert.equal(joinOpen(session, at("2026-10-20T15:29:59Z")), true);
  assert.equal(joinOpen(session, at("2026-10-20T15:30:00Z")), false);
  assert.equal(joinOpen({ ...session, state: "CANCELLED" }, at("2026-10-20T14:00:00Z")), false);
});

test("countdown formatting", () => {
  assert.equal(formatCountdown(3 * 86400_000 + 4 * 3600_000), "3d 4h");
  assert.equal(formatCountdown(5 * 3600_000 + 12 * 60_000), "5h 12m");
  assert.equal(formatCountdown(12 * 60_000 + 5000), "12m 05s");
  assert.equal(formatCountdown(45_000), "45s");
  assert.equal(formatCountdown(-1000), "0s");
});

test("times are shown in the session's timezone", () => {
  assert.equal(formatTime(session.startsAt, "Asia/Kolkata"), "7:00 PM");
  assert.equal(formatTimeRange(session.startsAt, session.endsAt, "Asia/Kolkata"), "7:00 PM – 9:00 PM");
  assert.match(formatSessionDate(session.startsAt, "Asia/Kolkata"), /20 Oct,? 2026/);
  assert.match(timeZoneLabel("Asia/Kolkata", session.startsAt), /IST|GMT\+5:30/);
  assert.equal(differentOffset("Asia/Kolkata", "Asia/Calcutta", session.startsAt), false);
  assert.equal(differentOffset("Asia/Kolkata", "Europe/London", session.startsAt), true);
});
