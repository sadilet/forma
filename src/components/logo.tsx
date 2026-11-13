import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-foreground", className)}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1.25" y="1.25" width="15.5" height="15.5" rx="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 9h8M9 5v8" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Forma</span>
    </span>
  );
}
