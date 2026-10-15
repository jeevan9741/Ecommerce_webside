"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarPlus, CalendarX, Eye, EyeOff, Loader2, Pencil, Plus, RotateCcw, Trash2, Video } from "lucide-react";
import { Modal } from "@/components/admin/modal";
import { errorText, type Push } from "@/components/admin/video-shared";
import type { PackageOption } from "@/components/admin/ebooks-panel";
import { formatInr } from "@/lib/format";
import { formatSessionDate, formatTimeRange, timeZoneLabel, type LiveSessionState } from "@/lib/live-session";
import { learningService, type AdminLiveSession, type LiveSessionInput } from "@/services/learningService";

const TRAINING_DAYS = 7;
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];
const JOIN_WINDOWS = [0, 5, 10, 15, 30, 60];

const STATE_STYLE: Record<LiveSessionState, string> = {
  UPCOMING: "border-gold-500/50 text-gold-600",
  LIVE: "border-danger text-danger",
  COMPLETED: "border-emerald text-emerald",
  CANCELLED: "border-border-strong text-parchment-muted",
};

const packageLabel = (p: PackageOption) => `${p.title}${p.priceInPaise !== undefined ? ` — ${formatInr(p.priceInPaise)}` : ""}${p.isActive ? "" : " (inactive)"}`;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function LiveSessionsPanel({ courses, push }: { courses: PackageOption[]; push: Push }) {
  const defaultCourse = courses.find((c) => c.type === "ZOOM" && c.isActive)?.id ?? courses[0]?.id ?? "";
  const [courseId, setCourseId] = useState("");
  const [sessions, setSessions] = useState<AdminLiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminLiveSession | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const [cancelling, setCancelling] = useState<AdminLiveSession | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const selected = courseId || defaultCourse;
  // Only the latest request may update the list — switching packages quickly must not let an older,
  // slower response overwrite the newer one.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    if (!selected) return setSessions([]);
    try {
      const { sessions } = await learningService.adminLiveSessions(selected);
      if (request !== latest.current) return;
      setSessions(sessions);
      setError(null);
    } catch (err) {
      if (request === latest.current) setError(errorText(err, "Could not load sessions."));
    }
  }, [selected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    void load();
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, message: string) {
    setBusyId(id);
    try {
      await fn();
      push("success", message);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  const scheduledDays = new Set((sessions ?? []).filter((s) => s.status !== "CANCELLED").map((s) => s.dayNumber));
  const missing = Array.from({ length: TRAINING_DAYS }, (_, i) => i + 1).filter((d) => !scheduledDays.has(d));
  const drafts = (sessions ?? []).filter((s) => !s.isPublished).length;

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-sm">
          <label className="label-field" htmlFor="live-course">
            Package
          </label>
          <select id="live-course" className="input-field" value={selected} onChange={(e) => { setSessions(null); setCourseId(e.target.value); }}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {packageLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline btn-sm" onClick={() => setBulk(true)} disabled={!selected}>
            <CalendarPlus className="h-4 w-4" /> Create 7-day schedule
          </button>
          <button type="button" className="btn-gold btn-sm" onClick={() => setEditing("new")} disabled={!selected}>
            <Plus className="h-4 w-4" /> Add session
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-sm text-parchment-muted">
        Only customers with a <strong>paid</strong> order for this package see published sessions. The Zoom link is never shown in the schedule — the
        Join button asks the server for it, and only works from the joining window until the session ends. Paste the participant link
        (zoom.us/j/…), never the host start link. Changes show up on customer dashboards within two minutes.
      </p>

      {sessions && sessions.length > 0 && (missing.length > 0 || drafts > 0) && (
        <div className="mt-3 rounded-xl border border-gold-500/40 bg-gold-500/5 p-3 text-sm text-parchment">
          {missing.length > 0 && <p>Days without an active session: {missing.join(", ")}.</p>}
          {drafts > 0 && <p>{drafts} session{drafts === 1 ? " is" : "s are"} unpublished (hidden from customers).</p>}
        </div>
      )}

      <div className="mt-5">
        {error ? (
          <p className="card p-5 text-sm text-danger">{error}</p>
        ) : !sessions ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <Video className="h-10 w-10 text-gold-500" />
            <p className="text-sm text-parchment-muted">No sessions for this package yet. Create the 7-day schedule in one go, or add sessions one by one.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => {
              // As of the last load (the list reloads after every change).
              const state = s.state;
              return (
                <li key={s.id} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-gold-600/40 bg-gold-500/10 text-gold-600">
                      <span className="text-[9px] font-bold uppercase leading-none">Day</span>
                      <span className="font-bold leading-none">{s.dayNumber}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-parchment [overflow-wrap:anywhere]">
                        {s.title}
                        <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATE_STYLE[state]}`}>{state}</span>
                        {!s.isPublished && <span className="ml-1 rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-bold uppercase text-parchment-muted">Draft</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-parchment-muted">
                        {formatSessionDate(s.startsAt, s.timezone)} · {formatTimeRange(s.startsAt, s.endsAt, s.timezone)} {timeZoneLabel(s.timezone, s.startsAt)} · join opens{" "}
                        {s.joinOpensMinutesBefore} min before
                      </p>
                      <p className="text-xs text-parchment-muted [overflow-wrap:anywhere]">{s.joinUrl}</p>
                      {s.status === "CANCELLED" && s.cancelReason && <p className="text-xs text-parchment-muted">Cancelled: {s.cancelReason}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:shrink-0">
                    {confirmDelete === s.id ? (
                      <>
                        <button
                          type="button"
                          className="btn-sm rounded-lg bg-danger px-3 text-sm font-semibold text-white"
                          disabled={busyId === s.id}
                          onClick={() => act(s.id, () => learningService.removeLiveSession(s.id), "Session deleted.")}
                        >
                          <Trash2 className="h-4 w-4" /> Delete session
                        </button>
                        <button type="button" className="btn-outline btn-sm" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn-outline btn-sm" onClick={() => setEditing(s)}>
                          <Pencil className="h-4 w-4" /> Edit / reschedule
                        </button>
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          disabled={busyId === s.id}
                          onClick={() =>
                            act(s.id, () => learningService.updateLiveSession(s.id, { isPublished: !s.isPublished }), s.isPublished ? "Session unpublished." : "Session published.")
                          }
                        >
                          {s.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          {s.isPublished ? "Unpublish" : "Publish"}
                        </button>
                        {s.status === "CANCELLED" ? (
                          <button type="button" className="btn-outline btn-sm" disabled={busyId === s.id} onClick={() => act(s.id, () => learningService.restoreLiveSession(s.id), "Session restored.")}>
                            <RotateCcw className="h-4 w-4" /> Restore
                          </button>
                        ) : (
                          <button type="button" className="btn-outline btn-sm" onClick={() => setCancelling(s)}>
                            <CalendarX className="h-4 w-4" /> Cancel
                          </button>
                        )}
                        <button type="button" className="btn-outline btn-sm text-danger" onClick={() => setConfirmDelete(s.id)} aria-label={`Delete ${s.title}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <SessionForm
          session={editing === "new" ? null : editing}
          courses={courses}
          courseId={selected}
          nextDay={missing[0] ?? 1}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            push("success", message);
            setEditing(null);
            void load();
          }}
        />
      )}
      {bulk && (
        <BulkScheduleForm
          courseId={selected}
          onClose={() => setBulk(false)}
          onDone={(message, ok) => {
            push(ok ? "success" : "error", message);
            setBulk(false);
            void load();
          }}
        />
      )}
      {cancelling && (
        <CancelForm
          session={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            push("success", "Session cancelled — customers now see it as cancelled.");
            setCancelling(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TimeFields({
  value,
  onChange,
  disabled,
  showDate = true,
}: {
  value: { date: string; startTime: string; endTime: string; timezone: string };
  onChange: (patch: Partial<{ date: string; startTime: string; endTime: string; timezone: string }>) => void;
  disabled: boolean;
  showDate?: boolean;
}) {
  const zones = TIMEZONES.includes(value.timezone) ? TIMEZONES : [value.timezone, ...TIMEZONES];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showDate && (
        <div>
          <label className="label-field" htmlFor="ls-date">
            Date
          </label>
          <input id="ls-date" type="date" className="input-field" value={value.date} onChange={(e) => onChange({ date: e.target.value })} required disabled={disabled} />
        </div>
      )}
      <div>
        <label className="label-field" htmlFor="ls-tz">
          Timezone
        </label>
        <select id="ls-tz" className="input-field" value={value.timezone} onChange={(e) => onChange({ timezone: e.target.value })} disabled={disabled}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z === "Asia/Kolkata" ? "India (IST, Asia/Kolkata)" : z}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label-field" htmlFor="ls-start">
          Start time
        </label>
        <input id="ls-start" type="time" className="input-field" value={value.startTime} onChange={(e) => onChange({ startTime: e.target.value })} required disabled={disabled} />
      </div>
      <div>
        <label className="label-field" htmlFor="ls-end">
          End time
        </label>
        <input id="ls-end" type="time" className="input-field" value={value.endTime} onChange={(e) => onChange({ endTime: e.target.value })} required disabled={disabled} />
      </div>
    </div>
  );
}

function JoinFields({
  joinUrl,
  joinOpensMinutesBefore,
  isPublished,
  onChange,
  disabled,
}: {
  joinUrl: string;
  joinOpensMinutesBefore: number;
  isPublished: boolean;
  onChange: (patch: Partial<{ joinUrl: string; joinOpensMinutesBefore: number; isPublished: boolean }>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div>
        <label className="label-field" htmlFor="ls-url">
          Zoom join link
        </label>
        <input
          id="ls-url"
          type="url"
          inputMode="url"
          className="input-field"
          placeholder="https://us06web.zoom.us/j/81234567890?pwd=…"
          value={joinUrl}
          onChange={(e) => onChange({ joinUrl: e.target.value })}
          required
          disabled={disabled}
        />
        <p className="field-hint">The participant link — not the host start link.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label-field" htmlFor="ls-window">
            Join button unlocks
          </label>
          <select id="ls-window" className="input-field" value={joinOpensMinutesBefore} onChange={(e) => onChange({ joinOpensMinutesBefore: Number(e.target.value) })} disabled={disabled}>
            {JOIN_WINDOWS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "At the start time" : `${m} min before start`}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-parchment">
          <input type="checkbox" checked={isPublished} onChange={(e) => onChange({ isPublished: e.target.checked })} disabled={disabled} />
          Published (visible to buyers)
        </label>
      </div>
    </>
  );
}

function SessionForm({
  session,
  courses,
  courseId,
  nextDay,
  onClose,
  onSaved,
}: {
  session: AdminLiveSession | null;
  courses: PackageOption[];
  courseId: string;
  nextDay: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<LiveSessionInput>(() =>
    session
      ? {
          courseId: session.courseId,
          dayNumber: session.dayNumber,
          title: session.title,
          description: session.description,
          date: session.date,
          startTime: session.startTime,
          endTime: session.endTime,
          timezone: session.timezone,
          joinUrl: session.joinUrl,
          joinOpensMinutesBefore: session.joinOpensMinutesBefore,
          isPublished: session.isPublished,
        }
      : {
          courseId,
          dayNumber: nextDay,
          title: `Day ${nextDay} — Live training`,
          description: null,
          date: "",
          startTime: "19:00",
          endTime: "21:00",
          timezone: "Asia/Kolkata",
          joinUrl: "",
          joinOpensMinutesBefore: 15,
          isPublished: true,
        }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<LiveSessionInput>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, title: form.title.trim(), description: form.description?.trim() || null, joinUrl: form.joinUrl.trim() };
      if (session) {
        await learningService.updateLiveSession(session.id, body);
        onSaved("Session saved.");
      } else {
        await learningService.createLiveSession(body);
        onSaved("Session created.");
      }
    } catch (err) {
      setError(errorText(err, "Could not save the session."));
      setSaving(false);
    }
  }

  return (
    <Modal title={session ? "Edit / reschedule session" : "Add live session"} onClose={saving ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <label className="label-field" htmlFor="ls-course">
              Package
            </label>
            <select id="ls-course" className="input-field" value={form.courseId} onChange={(e) => set({ courseId: e.target.value })} disabled={saving}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {packageLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field" htmlFor="ls-day">
              Day
            </label>
            <select id="ls-day" className="input-field" value={form.dayNumber} onChange={(e) => set({ dayNumber: Number(e.target.value) })} disabled={saving}>
              {Array.from({ length: TRAINING_DAYS }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="ls-title">
            Title
          </label>
          <input id="ls-title" className="input-field" value={form.title} onChange={(e) => set({ title: e.target.value })} required minLength={2} maxLength={150} disabled={saving} />
        </div>
        <div>
          <label className="label-field" htmlFor="ls-desc">
            Topics / notes <span className="font-normal text-parchment-muted">(optional)</span>
          </label>
          <textarea id="ls-desc" className="input-field min-h-16" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} maxLength={2000} disabled={saving} />
        </div>
        <TimeFields value={form} onChange={set} disabled={saving} />
        <JoinFields {...form} onChange={set} disabled={saving} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="submit" className="btn-gold" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {session ? "Save changes" : "Create session"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Seven sessions on consecutive days at the same time — edit individual days afterwards. */
function BulkScheduleForm({ courseId, onClose, onDone }: { courseId: string; onClose: () => void; onDone: (message: string, ok: boolean) => void }) {
  const [form, setForm] = useState({ date: "", startTime: "19:00", endTime: "21:00", timezone: "Asia/Kolkata", joinUrl: "", joinOpensMinutesBefore: 15, isPublished: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let created = 0;
    try {
      for (let day = 1; day <= TRAINING_DAYS; day++) {
        await learningService.createLiveSession({
          courseId,
          dayNumber: day,
          title: `Day ${day} — Live training`,
          description: null,
          date: addDays(form.date, day - 1),
          startTime: form.startTime,
          endTime: form.endTime,
          timezone: form.timezone,
          joinUrl: form.joinUrl.trim(),
          joinOpensMinutesBefore: form.joinOpensMinutesBefore,
          isPublished: form.isPublished,
        });
        created++;
      }
      onDone(`${TRAINING_DAYS} sessions created${form.isPublished ? " and published" : " as drafts — publish when ready"}.`, true);
    } catch (err) {
      if (created > 0) return onDone(`Created ${created} of ${TRAINING_DAYS} sessions, then: ${errorText(err)}`, false);
      setError(errorText(err, "Could not create the schedule."));
      setSaving(false);
    }
  }

  return (
    <Modal title="Create 7-day schedule" onClose={saving ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-parchment-muted">
          Creates Day 1–7 on consecutive dates at the same time. Reschedule, retitle or cancel individual days afterwards.
        </p>
        <div>
          <label className="label-field" htmlFor="ls-date">
            Day 1 date
          </label>
          <input id="ls-date" type="date" className="input-field" value={form.date} onChange={(e) => set({ date: e.target.value })} required disabled={saving} />
        </div>
        <TimeFields value={form} onChange={set} disabled={saving} showDate={false} />
        <JoinFields {...form} onChange={set} disabled={saving} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="submit" className="btn-gold" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create {TRAINING_DAYS} sessions
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CancelForm({ session, onClose, onDone }: { session: AdminLiveSession; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await learningService.cancelLiveSession(session.id, reason.trim() || null);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Cancel Day ${session.dayNumber}`} onClose={saving ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-parchment-muted">
          Customers will see “{session.title}” as cancelled and can&apos;t join it. You can restore it later, or add a replacement session.
        </p>
        <div>
          <label className="label-field" htmlFor="ls-reason">
            Reason shown to customers <span className="font-normal text-parchment-muted">(optional)</span>
          </label>
          <input id="ls-reason" className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={saving} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Keep session
          </button>
          <button type="submit" className="btn-gold" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Cancel session
          </button>
        </div>
      </form>
    </Modal>
  );
}
