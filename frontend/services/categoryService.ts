import { api } from "@/lib/api";
import type { StudentVideo } from "@/services/videoService";

// ---------- Admin ----------

export interface AdminSubcategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  videoCount: number;
  publishedCount: number;
}

export interface AdminCategory extends AdminSubcategory {
  /** Packages whose buyers can watch this category and all its subcategories. */
  packageIds: string[];
  subcategories: AdminSubcategory[];
}

export interface PackageOption {
  id: string;
  title: string;
  priceInPaise: number;
  isActive: boolean;
}

// ---------- Students ----------

export interface LibrarySection {
  id: string;
  slug: string;
  name: string;
  videoCount: number;
  completedCount: number;
  progressPercent: number;
}

export interface LibraryCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  locked: boolean;
  /** Packages that unlock a locked category (empty: not on sale yet). */
  packages: { id: string; title: string; priceInPaise: number }[];
  videoCount: number;
  completedCount: number;
  progressPercent: number;
  subcategories: LibrarySection[];
}

export interface CategoryDetail {
  category: LibraryCategory;
  /** Subcategories — or, for a category without any, the category itself. */
  sections: (LibrarySection & { videos: StudentVideo[] })[];
}

export const categoryService = {
  // Admin
  adminList: () => api.get<{ categories: AdminCategory[]; packages: PackageOption[] }>("/admin/categories"),
  create: (body: { name: string; description?: string | null; parentId?: string | null }) =>
    api.post<{ category: { id: string } }>("/admin/categories", body),
  update: (id: string, body: { name?: string; description?: string | null; isActive?: boolean }) =>
    api.patch<{ category: { id: string } }>(`/admin/categories/${id}`, body),
  move: (id: string, direction: "up" | "down") => api.post<{ ok: true }>(`/admin/categories/${id}/move`, { direction }),
  setPackages: (id: string, courseIds: string[]) => api.put<{ packageIds: string[] }>(`/admin/categories/${id}/packages`, { courseIds }),
  remove: (id: string) => api.delete<{ ok: true }>(`/admin/categories/${id}`),

  // Students
  library: () =>
    api.get<{ categories: LibraryCategory[]; summary: { videoCount: number; completedCount: number; progressPercent: number } }>(
      "/me/categories"
    ),
  category: (slug: string) => api.get<CategoryDetail>(`/me/categories/${encodeURIComponent(slug)}`),
};

export function formatRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
