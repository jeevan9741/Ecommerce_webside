import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canJoinNow,
  isValidTimeZone,
  joinOpensAt,
  sessionState,
  utcToZonedInput,
  zonedTimeToUtc,
  zoomJoinUrlProblem,
} from "../src/services/live-session-time.js";
import { downloadName, extensionMatches, fileSignatureMatches } from "../src/services/ebook-file.js";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

test("IST wall-clock time converts to the right UTC instant and back", () => {
  const utc = zonedTimeToUtc("2026-10-20", "19:30", "Asia/Kolkata");
  assert.equal(utc.toISOString(), "2026-10-20T14:00:00.000Z");
  assert.deepEqual(utcToZonedInput(utc, "Asia/Kolkata"), { date: "2026-10-20", time: "19:30" });
});

test("DST timezones use the offset in force on that date", () => {
  assert.equal(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-12-01", "09:00", "America/New_York").toISOString(), "2026-12-01T14:00:00.000Z");
});

test("malformed dates and timezones are rejected", () => {
  assert.throws(() => zonedTimeToUtc("2026-02-31", "10:00", "Asia/Kolkata"));
  assert.throws(() => zonedTimeToUtc("2026-10-20", "25:00", "Asia/Kolkata"));
  assert.throws(() => zonedTimeToUtc("20-10-2026", "10:00", "Asia/Kolkata"));
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
});

test("session state and join window follow the clock", () => {
  const s = {
    startsAt: new Date("2026-10-20T14:00:00Z"),
    endsAt: new Date("2026-10-20T16:00:00Z"),
    joinOpensMinutesBefore: 15,
    status: "SCHEDULED" as const,
  };
  const at = (iso: string) => new Date(iso);
  assert.equal(joinOpensAt(s).toISOString(), "2026-10-20T13:45:00.000Z");

  assert.equal(sessionState(s, at("2026-10-20T13:00:00Z")), "UPCOMING");
  assert.equal(canJoinNow(s, at("2026-10-20T13:44:59Z")), false);
  assert.equal(canJoinNow(s, at("2026-10-20T13:45:00Z")), true); // window opens, still UPCOMING
  assert.equal(sessionState(s, at("2026-10-20T13:50:00Z")), "UPCOMING");
  assert.equal(sessionState(s, at("2026-10-20T14:00:00Z")), "LIVE");
  assert.equal(canJoinNow(s, at("2026-10-20T15:59:59Z")), true);
  assert.equal(sessionState(s, at("2026-10-20T16:00:00Z")), "COMPLETED");
  assert.equal(canJoinNow(s, at("2026-10-20T16:00:00Z")), false);

  const cancelled = { ...s, status: "CANCELLED" as const };
  assert.equal(sessionState(cancelled, at("2026-10-20T14:30:00Z")), "CANCELLED");
  assert.equal(canJoinNow(cancelled, at("2026-10-20T14:30:00Z")), false);
});

test("only Zoom participant links are accepted", () => {
  assert.equal(zoomJoinUrlProblem("https://us06web.zoom.us/j/81234567890?pwd=abc"), null);
  assert.equal(zoomJoinUrlProblem("https://zoom.us/j/81234567890"), null);
  assert.match(zoomJoinUrlProblem("http://zoom.us/j/1")!, /https/);
  assert.match(zoomJoinUrlProblem("https://zoom.us.evil.com/j/1")!, /Zoom/);
  assert.match(zoomJoinUrlProblem("https://example.com/j/1")!, /Zoom/);
  assert.match(zoomJoinUrlProblem("https://zoom.us/s/81234567890?zak=secret")!, /host start link/);
  assert.match(zoomJoinUrlProblem("https://zoom.us/j/1?zak=secret")!, /host start link/);
  assert.ok(zoomJoinUrlProblem("not a url"));
});

test("e-book files are checked by their real bytes, not the declared type", () => {
  assert.equal(fileSignatureMatches(bytes("%PDF-1.7\n%âãÏÓ"), "application/pdf"), true);
  assert.equal(fileSignatureMatches(bytes("<html><body>fake</body></html>"), "application/pdf"), false);
  assert.equal(fileSignatureMatches(bytes("MZ\x90\x00 an exe"), "application/pdf"), false);

  const epub = "PK\x03\x04" + "\x00".repeat(26) + "mimetypeapplication/epub+zip" + "\x00".repeat(10);
  assert.equal(fileSignatureMatches(bytes(epub), "application/epub+zip"), true);
  assert.equal(fileSignatureMatches(bytes("PK\x03\x04" + "\x00".repeat(60)), "application/epub+zip"), false); // a plain zip
  assert.equal(fileSignatureMatches(bytes("%PDF-1.7"), "application/epub+zip"), false);
});

test("file extension and download name", () => {
  assert.equal(extensionMatches("Supplier List.PDF", "application/pdf"), true);
  assert.equal(extensionMatches("book.epub", "application/pdf"), false);
  assert.equal(downloadName("Supplier List.pdf", "x", "application/pdf"), "Supplier List.pdf");
  assert.equal(downloadName("", "Meesho Guide", "application/epub+zip"), "Meesho Guide.epub");
  assert.equal(downloadName("../../etc/passwd.pdf", "x", "application/pdf"), "....etcpasswd.pdf");
});
