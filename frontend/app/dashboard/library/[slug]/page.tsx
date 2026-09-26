import type { Metadata } from "next";
import { CategoryView } from "@/components/library/category-view";

export const metadata: Metadata = { title: "Course Library" };

/** Access is enforced by the backend: locked categories come back without any videos. */
export default async function LibraryCategoryPage({ params, searchParams }: PageProps<"/dashboard/library/[slug]">) {
  const [{ slug }, { section }] = await Promise.all([params, searchParams]);
  return <CategoryView key={slug} slug={slug} initialSection={typeof section === "string" ? section : undefined} />;
}
