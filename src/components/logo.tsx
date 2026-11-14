import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-foreground", className)}>
      <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden="true" className="shrink-0">
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
      <span className="font-forma text-[15px] font-semibold tracking-[-0.035em]">Forma</span>
    </span>
  );
}
