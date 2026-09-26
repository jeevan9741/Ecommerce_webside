import type { Metadata } from "next";
import { VideoPlayer } from "@/components/videos/video-player";

export const metadata: Metadata = { title: "Course Video" };

/** Access is enforced by the backend: the player only receives a signed link for purchased courses. */
export default async function CourseVideoPage({ params }: PageProps<"/dashboard/courses/[id]/videos/[videoId]">) {
  const { id, videoId } = await params;
  return <VideoPlayer key={videoId} context={{ kind: "course", courseId: id }} videoId={videoId} />;
}
