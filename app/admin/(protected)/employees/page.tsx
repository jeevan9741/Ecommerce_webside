"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { formatInr, formatDate } from "@/lib/format";
import { Modal } from "@/components/admin/modal";

type WorkType = "WORK_FROM_HOME" | "OFFICE" | "HYBRID";
type EmployeeStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";

interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  position: string;
  joiningDate: string;
  salaryInPaise: number;
  workType: WorkType;
  status: EmployeeStatus;
  notes: string | null;
}

const WORK_TYPE_LABEL: Record<WorkType, string> = {
  WORK_FROM_HOME: "Work From Home",
  OFFICE: "Office",
  HYBRID: "Hybrid",
};

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  TERMINATED: "Terminated",
};

const emptyForm = {
  employeeCode: "",
  name: "",
  position: "",
  joiningDate: "",
  salary: "",
  workType: "OFFICE" as WorkType,
  status: "ACTIVE" as EmployeeStatus,
  notes: "",
};

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [modal, setModal] = useState<Employee | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await fetch("/api/admin/employees").then((r) => r.json());
    setEmployees(data.employees);
  }

  useEffect(() => {
    fetch("/api/admin/employees")
      .then((r) => r.json())
      .then((data) => setEmployees(data.employees));
  }, []);

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setModal("new");
  }

  function openEdit(emp: Employee) {
    setForm({
      employeeCode: emp.employeeCode,
      name: emp.name,
      position: emp.position,
      joiningDate: emp.joiningDate.slice(0, 10),
      salary: String(emp.salaryInPaise / 100),
      workType: emp.workType,
      status: emp.status,
      notes: emp.notes ?? "",
    });
    setError(null);
    setModal(emp);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      employeeCode: form.employeeCode.trim(),
      name: form.name.trim(),
      position: form.position.trim(),
      joiningDate: form.joiningDate,
      salaryInPaise: Math.round(Number(form.salary) * 100),
      workType: form.workType,
      status: form.status,
      notes: form.notes.trim() || undefined,
    };
    const isNew = modal === "new";
    const res = await fetch(isNew ? "/api/admin/employees" : `/api/admin/employees/${(modal as Employee).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save employee");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModal(null);
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/admin/employees/${id}`, { method: "DELETE" });
    await load();
  }

  if (!employees) {
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
          <h1 className="font-display text-2xl font-semibold text-parchment">Employees</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            {employees.length} employees · Salary details are confidential to admins only
          </p>
        </div>
        <button onClick={openNew} className="btn-gold !px-4 !py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add Employee
        </button>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[850px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Employee</th>
              <th className="px-4 pb-2">Position</th>
              <th className="px-4 pb-2">Work Type</th>
              <th className="px-4 pb-2">Salary</th>
              <th className="px-4 pb-2">Joined</th>
              <th className="px-4 pb-2">Status</th>
              <th className="px-4 pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="card align-top">
                <td className="rounded-l-2xl px-4 py-3">
                  <p className="text-parchment">{e.name}</p>
                  <p className="text-xs text-parchment-muted">{e.employeeCode}</p>
                </td>
                <td className="px-4 py-3 text-parchment-muted">{e.position}</td>
                <td className="px-4 py-3 text-parchment-muted">{WORK_TYPE_LABEL[e.workType]}</td>
                <td className="px-4 py-3 text-parchment">{formatInr(e.salaryInPaise)}</td>
                <td className="px-4 py-3 text-parchment-muted">{formatDate(e.joiningDate)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      e.status === "ACTIVE"
                        ? "border-emerald/40 text-emerald"
                        : e.status === "ON_LEAVE"
                          ? "border-gold-500/40 text-gold-400"
                          : "border-danger/40 text-danger"
                    }`}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
                <td className="rounded-r-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(e)} className="btn-ghost !px-2 !py-1.5" title="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(e.id)} className="btn-ghost !px-2 !py-1.5 !text-danger" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-parchment-muted">
                  No employees added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === "new" ? "Add Employee" : "Edit Employee"} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Employee ID</label>
                <input
                  className="input-field"
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Name</label>
                <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label-field">Position</label>
              <input
                className="input-field"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Joining Date</label>
                <input
                  type="date"
                  className="input-field"
                  value={form.joiningDate}
                  onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Salary (₹ / month)</label>
                <input
                  type="number"
                  className="input-field"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Work Type</label>
                <select
                  className="input-field"
                  value={form.workType}
                  onChange={(e) => setForm({ ...form, workType: e.target.value as WorkType })}
                >
                  {Object.entries(WORK_TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-field">Status</label>
                <select
                  className="input-field"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeStatus })}
                >
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label-field">Notes</label>
              <textarea className="input-field min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Employee"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
