"use client";

import { forwardRef, type VideoHTMLAttributes } from "react";

/**
 * Stream-only player: no download button, no picture-in-picture, no right-click "Save video as".
 * This deters casual saving; it can't stop screen capture. Course videos are additionally served
 * from the private store through signed links that expire.
 */
export const StreamOnlyVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement>>(function StreamOnlyVideo(props, ref) {
  return (
    <video
      ref={ref}
      {...props}
      controls
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});
