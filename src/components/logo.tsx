import { cn } from "@/lib/utils";

// Same geometry as public/brand/forma-mark.svg, drawn in currentColor so it follows the light and dark themes.
export function LogoMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path
        d="M20 10h24a10 10 0 0 1 10 10v10M54 38v6a10 10 0 0 1-10 10H20A10 10 0 0 1 10 44V20A10 10 0 0 1 20 10"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M26 26h12a4 4 0 0 1 4 4v12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
    </svg>
  );
}

// Mirrors public/brand/forma-lockup.svg: the mark plus a 600-weight Outfit wordmark.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-foreground", className)}>
      <LogoMark size={24} />
      <span className="font-logo text-[19px] font-semibold leading-none tracking-[-0.04em]">Forma</span>
    </span>
  );
}
