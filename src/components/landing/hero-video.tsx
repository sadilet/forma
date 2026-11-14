"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { embedSrc, type VideoSource } from "@/components/landing/video-source";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// The product video in the hero. It plays on its own, muted and looping, unless the visitor asks for reduced motion.
export function HeroVideo({ source }: { source: VideoSource }) {
  const reduceMotion = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (reduceMotion) video.current?.pause();
  }, [reduceMotion]);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border-strong bg-black shadow-float">
      {source.kind === "file" ? (
        <video
          ref={video}
          className="h-full w-full object-cover"
          src={source.src}
          autoPlay
          muted
          loop
          controls
          playsInline
          preload="auto"
          aria-label="Forma product video"
        />
      ) : (
        <iframe
          className="h-full w-full"
          src={embedSrc(source.src, !reduceMotion)}
          title="Forma product video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      )}
    </div>
  );
}
