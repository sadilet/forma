// PRODUCT_VIDEO_URL can be a direct video file (mp4, webm, mov), a YouTube link, or a Vimeo link.
// Browsers only autoplay muted video, so every source starts muted and loops. The player controls let people unmute.

export type VideoSource = { kind: "file"; src: string } | { kind: "embed"; src: string };

export function videoSource(value: string | undefined): VideoSource | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return id ? { kind: "embed", src: youtube(id) } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1];
    return id ? { kind: "embed", src: youtube(id) } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/(\d+)/)?.[1];
    return id ? { kind: "embed", src: `https://player.vimeo.com/video/${id}` } : null;
  }
  return { kind: "file", src: raw };
}


function youtube(id: string) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
}

// Adds the autoplay settings an embed needs. YouTube only loops a single video when `playlist` is its own id.
export function embedSrc(source: string, play: boolean) {
  const url = new URL(source);
  if (url.hostname.includes("vimeo")) {
    if (play) {
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("muted", "1");
      url.searchParams.set("loop", "1");
    }
  } else {
    const id = url.pathname.split("/").pop() ?? "";
    url.searchParams.set("rel", "0");
    url.searchParams.set("playsinline", "1");
    if (play) {
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("mute", "1");
      url.searchParams.set("loop", "1");
      url.searchParams.set("playlist", id);
    }
  }
  return url.toString();
}
