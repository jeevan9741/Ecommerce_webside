"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Languages as LanguagesIcon,
  Check,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Video,
  FileText,
  PlayCircle,
  Layers,
} from "lucide-react";
import { formatInr, COURSE_TYPE_LABEL } from "@/lib/format";
import { Modal } from "@/components/admin/modal";
import { FileUploadField } from "@/components/admin/file-upload-field";
import { useToasts, ToastStack } from "@/components/toast";

interface CourseLanguageVideo {
  id: string;
  languageId: string;
  videoUrl: string | null;
  subtitleUrl: string | null;
  ebookUrl: string | null;
  language: { id: string; code: string; name: string; nativeName: string };
}

interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  videoUrl: string | null;
  subtitleUrl: string | null;
  displayOrder: number;
}

interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  displayOrder: number;
  lessons: Lesson[];
}

interface Course {
  id: string;
  slug: string;
  type: "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";
  title: string;
  shortDescription: string;
  description: string;
  priceInPaise: number;
  commissionInPaise: number;
  isActive: boolean;
  languageVideos: CourseLanguageVideo[];
  modules: CourseModule[];
  _count: { orders: number; access: number };
}

const COURSE_TYPES: Course["type"][] = ["EBOOK", "VIDEO", "ZOOM", "CENTRE"];

const emptyForm = {
  slug: "",
  type: "EBOOK" as Course["type"],
  title: "",
  shortDescription: "",
  description: "",
  price: "",
  commission: "",
  isActive: true,
};

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [modalCourse, setModalCourse] = useState<Course | "new" | null>(null);
  const [languagesCourse, setLanguagesCourse] = useState<Course | null>(null);
  const [curriculumCourse, setCurriculumCourse] = useState<Course | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await backendFetch("/api/admin/courses").then((r) => r.json());
    setCourses(data.courses);
  }

  useEffect(() => {
    backendFetch("/api/admin/courses")
      .then((r) => r.json())
      .then((data) => setCourses(data.courses));
  }, []);

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setModalCourse("new");
  }

  function openEdit(course: Course) {
    setForm({
      slug: course.slug,
      type: course.type,
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      price: String(course.priceInPaise / 100),
      commission: String(course.commissionInPaise / 100),
      isActive: course.isActive,
    });
    setError(null);
    setModalCourse(course);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      slug: form.slug.trim(),
      type: form.type,
      title: form.title.trim(),
      shortDescription: form.shortDescription.trim(),
      description: form.description.trim(),
      priceInPaise: Math.round(Number(form.price) * 100),
      commissionInPaise: Math.round(Number(form.commission) * 100),
      isActive: form.isActive,
    };
    const isNew = modalCourse === "new";
    const res = await backendFetch(isNew ? "/api/admin/courses" : `/api/admin/courses/${(modalCourse as Course).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save course");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModalCourse(null);
    await load();
  }

  async function toggleActive(course: Course) {
    if (course.isActive) {
      await backendFetch(`/api/admin/courses/${course.id}`, { method: "DELETE" });
    } else {
      await backendFetch(`/api/admin/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
    }
    await load();
  }

  if (!courses) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Courses</h1>
          <p className="mt-1 text-sm text-parchment-muted">{courses.length} courses configured</p>
        </div>
        <button onClick={openNew} className="btn-gold !px-4 !py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add Course
        </button>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[950px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Course</th>
              <th className="px-4 pb-2">Type</th>
              <th className="px-4 pb-2">Price</th>
              <th className="px-4 pb-2">Commission</th>
              <th className="px-4 pb-2">Languages</th>
              <th className="px-4 pb-2">Curriculum</th>
              <th className="px-4 pb-2">Sales</th>
              <th className="px-4 pb-2">Status</th>
              <th className="px-4 pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id} className="card align-top">
                <td className="rounded-l-2xl px-4 py-3">
                  <p className="text-parchment">{c.title}</p>
                  <p className="text-xs text-parchment-muted">{c.slug}</p>
                </td>
                <td className="px-4 py-3 text-parchment-muted">{COURSE_TYPE_LABEL[c.type]}</td>
                <td className="px-4 py-3 text-parchment">{formatInr(c.priceInPaise)}</td>
                <td className="px-4 py-3 text-parchment-muted">{formatInr(c.commissionInPaise)}</td>
                <td className="px-4 py-3 text-parchment-muted">{c.languageVideos.length}</td>
                <td className="px-4 py-3 text-parchment-muted">
                  {c.modules.length} module{c.modules.length === 1 ? "" : "s"} ·{" "}
                  {c.modules.reduce((sum, m) => sum + m.lessons.length, 0)} lesson
                  {c.modules.reduce((sum, m) => sum + m.lessons.length, 0) === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3 text-parchment-muted">{c._count.orders}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      c.isActive
                        ? "border-emerald/40 text-emerald"
                        : "border-border-strong text-parchment-muted"
                    }`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="rounded-r-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setLanguagesCourse(c)} className="btn-ghost !px-2 !py-1.5" title="Manage languages">
                      <LanguagesIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => setCurriculumCourse(c)} className="btn-ghost !px-2 !py-1.5" title="Manage curriculum">
                      <BookOpen className="h-4 w-4" />
                    </button>
                    <button onClick={() => openEdit(c)} className="btn-ghost !px-2 !py-1.5" title="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(c)}
                      className="btn-ghost !px-2 !py-1.5 !text-danger"
                      title={c.isActive ? "Deactivate" : "Activate"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalCourse && (
        <Modal title={modalCourse === "new" ? "Add Course" : "Edit Course"} onClose={() => setModalCourse(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Slug</label>
                <input
                  className="input-field"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="ebook-course"
                />
              </div>
              <div>
                <label className="label-field">Type</label>
                <select
                  className="input-field"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as Course["type"] })}
                >
                  {COURSE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {COURSE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label-field">Title</label>
              <input className="input-field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Short Description</label>
              <input
                className="input-field"
                value={form.shortDescription}
                onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Full Description</label>
              <textarea
                className="input-field min-h-24"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Price (₹)</label>
                <input
                  type="number"
                  className="input-field"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Referral Commission (₹)</label>
                <input
                  type="number"
                  className="input-field"
                  value={form.commission}
                  onChange={(e) => setForm({ ...form, commission: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-parchment-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active (visible to customers)
            </label>
            <p className="text-xs text-parchment-muted">
              Languages, videos, subtitles and e-books are managed separately via the languages icon once the course is saved.
            </p>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Course"}
            </button>
          </div>
        </Modal>
      )}

      {languagesCourse && (
        <CourseLanguagesModal
          course={languagesCourse}
          onClose={() => setLanguagesCourse(null)}
          onChanged={load}
        />
      )}

      {curriculumCourse && (
        <CourseCurriculumModal
          course={curriculumCourse}
          onClose={() => setCurriculumCourse(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function ContentField({
  label,
  value,
  accept,
  onUpload,
  onDelete,
}: {
  label: string;
  value: string | null;
  accept?: string;
  onUpload: (key: string) => void;
  onDelete: () => void;
}) {
  const [replacing, setReplacing] = useState(false);

  return (
    <div>
      <label className="label-field">{label}</label>
      {value && !replacing ? (
        <div className="flex items-center justify-between rounded-xl border border-border-soft px-3 py-2">
          <p className="text-xs text-emerald">Uploaded</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setReplacing(true)} className="btn-ghost !px-2 !py-1 text-xs" title="Replace">
              <Pencil className="h-3.5 w-3.5" /> Replace
            </button>
            <button onClick={onDelete} className="btn-ghost !px-2 !py-1 text-xs !text-danger" title="Delete">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      ) : (
        <FileUploadField
          prefix="course-content"
          accept={accept}
          onUploaded={(key) => {
            onUpload(key);
            setReplacing(false);
          }}
        />
      )}
    </div>
  );
}

function CourseCurriculumModal({
  course,
  onClose,
  onChanged,
}: {
  course: Course;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [modules, setModules] = useState<CourseModule[]>(course.modules);
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [addingModule, setAddingModule] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(course.modules[0]?.id ?? null);
  const { toasts, push, dismiss } = useToasts();

  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  async function addModule() {
    const title = newModuleTitle.trim();
    if (!title) return;
    setAddingModule(true);
    const res = await backendFetch(`/api/admin/courses/${course.id}/modules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    setAddingModule(false);
    if (res.ok) {
      setModules((prev) => [...prev, data.module]);
      setNewModuleTitle("");
      setOpenModuleId(data.module.id);
      push("success", `Module "${title}" added.`);
      await onChanged();
    } else {
      push("error", data.error ?? "Failed to add module.");
    }
  }

  async function renameModule(moduleId: string, title: string) {
    const res = await backendFetch(`/api/admin/modules/${moduleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, title } : m)));
      push("success", "Module renamed.");
      await onChanged();
    } else {
      push("error", data.error ?? "Failed to rename module.");
    }
  }

  async function deleteModule(moduleId: string, title: string) {
    const res = await backendFetch(`/api/admin/modules/${moduleId}`, { method: "DELETE" });
    if (res.ok) {
      setModules((prev) => prev.filter((m) => m.id !== moduleId));
      push("success", `Module "${title}" deleted.`);
      await onChanged();
    } else {
      push("error", "Failed to delete module.");
    }
  }

  function updateLesson(moduleId: string, lesson: Lesson) {
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, lessons: m.lessons.map((l) => (l.id === lesson.id ? lesson : l)) } : m))
    );
  }

  async function addLesson(moduleId: string, title: string) {
    const res = await backendFetch(`/api/admin/modules/${moduleId}/lessons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (res.ok) {
      setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, lessons: [...m.lessons, data.lesson] } : m)));
      push("success", `Lesson "${title}" added.`);
      await onChanged();
    } else {
      push("error", data.error ?? "Failed to add lesson.");
    }
  }

  async function saveLessonField(moduleId: string, lesson: Lesson, field: "videoUrl" | "subtitleUrl", value: string | null) {
    const res = await backendFetch(`/api/admin/lessons/${lesson.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json();
    const kind = field === "videoUrl" ? "Video" : "Subtitle";
    if (res.ok) {
      updateLesson(moduleId, data.lesson);
      push("success", value ? `${kind} uploaded.` : `${kind} removed.`);
      await onChanged();
    } else {
      push("error", data.error ?? `Failed to update ${kind.toLowerCase()}.`);
    }
    return res.ok;
  }

  async function deleteLesson(moduleId: string, lessonId: string, title: string) {
    const res = await backendFetch(`/api/admin/lessons/${lessonId}`, { method: "DELETE" });
    if (res.ok) {
      setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) } : m)));
      push("success", `Lesson "${title}" deleted.`);
      await onChanged();
    } else {
      push("error", "Failed to delete lesson.");
    }
  }

  return (
    <Modal title={`Curriculum — ${course.title}`} onClose={onClose} size="xl">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-surface-hover/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-parchment-muted">
            Structure this course into <span className="font-medium text-parchment">modules</span>, each containing{" "}
            <span className="font-medium text-parchment">lessons</span> with their own video and subtitle files. Purchased
            students access these via time-limited signed URLs. The demo video (Settings → Languages) stays separate and
            public.
          </p>
          <div className="flex shrink-0 items-center gap-4 self-start sm:self-auto">
            <div className="flex items-center gap-1.5 rounded-full border border-border-soft bg-ink-elevated px-3 py-1.5 text-xs font-medium text-parchment">
              <Layers className="h-3.5 w-3.5 text-gold-500" />
              {modules.length} module{modules.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-border-soft bg-ink-elevated px-3 py-1.5 text-xs font-medium text-parchment">
              <Video className="h-3.5 w-3.5 text-gold-500" />
              {totalLessons} lesson{totalLessons === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4">
          {modules.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft py-16 text-center">
              <Layers className="h-8 w-8 text-parchment-muted/60" />
              <p className="text-sm font-medium text-parchment">No modules yet</p>
              <p className="max-w-xs text-xs text-parchment-muted">
                Start by adding your first module below, e.g. &ldquo;Module 1: Getting Started&rdquo;.
              </p>
            </div>
          )}

          {modules.map((m, mi) => (
            <ModuleCard
              key={m.id}
              module={m}
              index={mi}
              isOpen={openModuleId === m.id}
              onToggle={() => setOpenModuleId(openModuleId === m.id ? null : m.id)}
              onRename={(title) => renameModule(m.id, title)}
              onDelete={() => deleteModule(m.id, m.title)}
              onAddLesson={(title) => addLesson(m.id, title)}
              onSaveLessonField={(lesson, field, value) => saveLessonField(m.id, lesson, field, value)}
              onDeleteLesson={(lessonId, title) => deleteLesson(m.id, lessonId, title)}
            />
          ))}
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 rounded-xl border border-dashed border-border-soft bg-ink-elevated p-3 sm:flex-row sm:items-center">
          <input
            className="input-field"
            placeholder="New module title, e.g. Module 1: Getting Started"
            value={newModuleTitle}
            onChange={(e) => setNewModuleTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addModule()}
          />
          <button
            onClick={addModule}
            disabled={addingModule || !newModuleTitle.trim()}
            className="btn-gold !py-2.5 text-sm shrink-0 sm:w-auto"
          >
            {addingModule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Module
          </button>
        </div>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </Modal>
  );
}

function ConfirmIconButton({
  onConfirm,
  icon: Icon,
  label,
  busy,
}: {
  onConfirm: () => void;
  icon: LucideIcon;
  label: string;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <button
      type="button"
      title={label}
      disabled={busy}
      onClick={() => {
        if (confirming) {
          setConfirming(false);
          onConfirm();
        } else {
          setConfirming(true);
        }
      }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        confirming ? "bg-danger text-white hover:bg-danger/90" : "text-danger hover:bg-danger/10"
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="whitespace-nowrap">{confirming ? "Confirm delete?" : label}</span>
    </button>
  );
}

function ModuleCard({
  module: m,
  index,
  isOpen,
  onToggle,
  onRename,
  onDelete,
  onAddLesson,
  onSaveLessonField,
  onDeleteLesson,
}: {
  module: CourseModule;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddLesson: (title: string) => void;
  onSaveLessonField: (lesson: Lesson, field: "videoUrl" | "subtitleUrl", value: string | null) => Promise<boolean>;
  onDeleteLesson: (lessonId: string, title: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(m.title);
  const [renaming, setRenaming] = useState(false);
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [addingLesson, setAddingLesson] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function submitAddLesson() {
    const title = newLessonTitle.trim();
    if (!title) return;
    setAddingLesson(true);
    await onAddLesson(title);
    setAddingLesson(false);
    setNewLessonTitle("");
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-ink-elevated shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-parchment-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-parchment-muted" />
          )}
          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-gold-100 px-2.5 py-1 text-xs font-bold text-gold-600">
            Module {index + 1}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-parchment sm:text-base">{m.title}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border-soft px-2.5 py-1 text-xs text-parchment-muted sm:inline-flex">
          <Video className="h-3 w-3" />
          {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
        </span>
        <ConfirmIconButton onConfirm={() => { setDeleting(true); onDelete(); }} icon={Trash2} label="Delete" busy={deleting} />
      </div>

      {isOpen && (
        <div className="space-y-4 border-t border-border-soft bg-surface-hover/40 p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input-field"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Module title"
            />
            <button
              onClick={async () => {
                setRenaming(true);
                await onRename(titleDraft.trim());
                setRenaming(false);
              }}
              disabled={renaming || !titleDraft.trim() || titleDraft.trim() === m.title}
              className="btn-outline !px-4 !py-2.5 text-xs shrink-0"
            >
              {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} Save Title
            </button>
          </div>

          <div className="space-y-3">
            {m.lessons.length === 0 && (
              <p className="rounded-xl border border-dashed border-border-soft bg-ink-elevated px-4 py-6 text-center text-xs text-parchment-muted">
                No lessons in this module yet.
              </p>
            )}
            {m.lessons.map((l, li) => (
              <LessonCard
                key={l.id}
                lesson={l}
                index={li}
                onSaveField={(field, value) => onSaveLessonField(l, field, value)}
                onDelete={() => onDeleteLesson(l.id, l.title)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border-soft bg-ink-elevated p-3 sm:flex-row sm:items-center">
            <input
              className="input-field"
              placeholder="New lesson title, e.g. Lesson 1: Introduction"
              value={newLessonTitle}
              onChange={(e) => setNewLessonTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAddLesson()}
            />
            <button
              onClick={submitAddLesson}
              disabled={addingLesson || !newLessonTitle.trim()}
              className="btn-ghost !border !border-border-soft !px-4 !py-2.5 text-xs shrink-0"
            >
              {addingLesson ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add Lesson
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LessonCard({
  lesson,
  index,
  onSaveField,
  onDelete,
}: {
  lesson: Lesson;
  index: number;
  onSaveField: (field: "videoUrl" | "subtitleUrl", value: string | null) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function togglePreview() {
    if (previewUrl) {
      setPreviewUrl(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const res = await backendFetch(`/api/admin/lessons/${lesson.id}/preview`);
    const data = await res.json().catch(() => ({}));
    setPreviewLoading(false);
    if (res.ok) setPreviewUrl(data.videoUrl);
    else setPreviewError(data.error ?? "Failed to load preview.");
  }

  return (
    <div className="card space-y-4 p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-parchment">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-border-soft text-[11px] font-semibold text-parchment-muted">
            {index + 1}
          </span>
          <span className="truncate">{lesson.title}</span>
        </span>
        <ConfirmIconButton onConfirm={() => { setDeleting(true); onDelete(); }} icon={Trash2} label="Delete" busy={deleting} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LessonAssetCard
          label="Lesson Video"
          icon={Video}
          accept="video/*"
          value={lesson.videoUrl}
          onUpload={(key) => onSaveField("videoUrl", key)}
          onDelete={() => onSaveField("videoUrl", null)}
          onPreview={togglePreview}
          previewBusy={previewLoading}
          previewActive={!!previewUrl}
        />
        <LessonAssetCard
          label="Subtitles"
          icon={FileText}
          accept=".vtt,.srt"
          value={lesson.subtitleUrl}
          onUpload={(key) => onSaveField("subtitleUrl", key)}
          onDelete={() => onSaveField("subtitleUrl", null)}
        />
      </div>

      {previewError && <p className="text-xs text-danger">{previewError}</p>}
      {previewUrl && (
        <video key={lesson.id} src={previewUrl} controls className="w-full rounded-xl border border-border-soft" />
      )}
    </div>
  );
}

function LessonAssetCard({
  label,
  icon: Icon,
  value,
  accept,
  onUpload,
  onDelete,
  onPreview,
  previewBusy,
  previewActive,
}: {
  label: string;
  icon: LucideIcon;
  value: string | null;
  accept?: string;
  onUpload: (key: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onPreview?: () => void;
  previewBusy?: boolean;
  previewActive?: boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  }

  return (
    <div className="rounded-xl border border-border-soft bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-parchment-muted">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        {value && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald/10 px-2 py-0.5 text-[11px] font-medium text-emerald">
            <Check className="h-3 w-3" /> Uploaded
          </span>
        )}
      </div>

      {value && !replacing ? (
        <div className="space-y-3">
          <div className="flex h-14 items-center justify-center rounded-lg bg-border-soft/40 text-parchment-muted">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {onPreview && (
              <button
                onClick={onPreview}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft px-2.5 py-1.5 text-xs font-medium text-parchment transition-colors hover:bg-surface-hover"
              >
                {previewBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5 text-gold-500" />
                )}
                {previewActive ? "Hide" : "Preview"}
              </button>
            )}
            <button
              onClick={() => setReplacing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-soft px-2.5 py-1.5 text-xs font-medium text-parchment transition-colors hover:bg-surface-hover"
            >
              <Pencil className="h-3.5 w-3.5" /> Replace
            </button>
            <ConfirmIconButton onConfirm={handleDelete} icon={Trash2} label="Delete" busy={deleting} />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border-soft text-parchment-muted">
            <Icon className="h-5 w-5" />
          </div>
          <FileUploadField
            prefix="course-content"
            accept={accept}
            onUploaded={async (key) => {
              const ok = await onUpload(key);
              if (ok) setReplacing(false);
            }}
          />
          {replacing && (
            <button onClick={() => setReplacing(false)} className="text-xs text-parchment-muted hover:text-parchment">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface AdminLanguage {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
}

function CourseLanguagesModal({
  course,
  onClose,
  onChanged,
}: {
  course: Course;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [allLanguages, setAllLanguages] = useState<AdminLanguage[] | null>(null);
  const [entries, setEntries] = useState<CourseLanguageVideo[]>(course.languageVideos);
  const [openLanguageId, setOpenLanguageId] = useState<string | null>(null);

  useEffect(() => {
    backendFetch("/api/admin/languages")
      .then((r) => r.json())
      .then((data) => setAllLanguages(data.languages.filter((l: AdminLanguage) => l.isActive)));
  }, []);

  function entryFor(languageId: string) {
    return entries.find((e) => e.languageId === languageId) ?? null;
  }

  async function saveField(languageId: string, field: "videoUrl" | "subtitleUrl" | "ebookUrl", storageKey: string | null) {
    const existing = entryFor(languageId);
    const payload = {
      videoUrl: existing?.videoUrl ?? null,
      subtitleUrl: existing?.subtitleUrl ?? null,
      ebookUrl: existing?.ebookUrl ?? null,
      [field]: storageKey,
    };
    const res = await backendFetch(`/api/admin/courses/${course.id}/languages/${languageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      setEntries((prev) => {
        const others = prev.filter((e) => e.languageId !== languageId);
        return [...others, data.entry];
      });
      await onChanged();
    }
  }

  async function removeLanguage(languageId: string) {
    await backendFetch(`/api/admin/courses/${course.id}/languages/${languageId}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.languageId !== languageId));
    await onChanged();
  }

  if (!allLanguages) {
    return (
      <Modal title={`Languages — ${course.title}`} onClose={onClose}>
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Languages — ${course.title}`} onClose={onClose}>
      <div className="space-y-2">
        <p className="mb-2 text-xs text-parchment-muted">
          Add a video, subtitle file, and/or e-book for each language this course supports.
        </p>
        {allLanguages.map((lang) => {
          const entry = entryFor(lang.id);
          const isOpen = openLanguageId === lang.id;
          return (
            <div key={lang.id} className="rounded-xl border border-border-soft">
              <button
                type="button"
                onClick={() => setOpenLanguageId(isOpen ? null : lang.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
              >
                <span className="flex items-center gap-2 text-parchment">
                  {lang.name} <span className="text-xs text-parchment-muted">{lang.nativeName}</span>
                  {entry && (entry.videoUrl || entry.ebookUrl) && <Check className="h-3.5 w-3.5 text-emerald" />}
                </span>
                <span className="text-xs text-parchment-muted">{isOpen ? "Hide" : "Manage"}</span>
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-border-soft p-4">
                  <ContentField
                    label="Video"
                    accept="video/*"
                    value={entry?.videoUrl ?? null}
                    onUpload={(key) => saveField(lang.id, "videoUrl", key)}
                    onDelete={() => saveField(lang.id, "videoUrl", null)}
                  />
                  <ContentField
                    label="Subtitle (.vtt/.srt)"
                    value={entry?.subtitleUrl ?? null}
                    onUpload={(key) => saveField(lang.id, "subtitleUrl", key)}
                    onDelete={() => saveField(lang.id, "subtitleUrl", null)}
                  />
                  <ContentField
                    label="E-Book (PDF)"
                    accept="application/pdf"
                    value={entry?.ebookUrl ?? null}
                    onUpload={(key) => saveField(lang.id, "ebookUrl", key)}
                    onDelete={() => saveField(lang.id, "ebookUrl", null)}
                  />
                  {entry && (
                    <button
                      onClick={() => removeLanguage(lang.id)}
                      className="btn-ghost !px-0 !py-0 text-xs !text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove this language from the course
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
