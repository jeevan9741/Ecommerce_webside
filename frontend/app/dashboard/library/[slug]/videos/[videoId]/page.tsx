import type { Metadata } from "next";
import { VideoPlayer } from "@/components/videos/video-player";

export const metadata: Metadata = { title: "Course Video" };

/** Access is enforced by the backend: the player only receives a signed link for unlocked categories. */
export default async function LibraryVideoPage({ params }: PageProps<"/dashboard/library/[slug]/videos/[videoId]">) {
  const { slug, videoId } = await params;
  return <VideoPlayer key={videoId} context={{ kind: "category", slug }} videoId={videoId} />;
}
