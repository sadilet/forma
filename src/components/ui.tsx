"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "bg-foreground text-background hover:opacity-85",
        accent: "bg-accent text-accent-ink hover:bg-accent-strong",
        quiet: "border border-border bg-surface-elevated text-foreground shadow-soft hover:bg-surface-hover",
        ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-hover",
      },
      size: {
        sm: "h-8 px-2.5 text-[13px]",
        md: "h-9 px-3",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "quiet", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-border-strong bg-input px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/70",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-none rounded-lg border border-border-strong bg-input px-3 py-2 text-sm leading-5 outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/70",
        props.className,
      )}
    />
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <Tooltip.Provider delayDuration={250}>{children}</Tooltip.Provider>;
}

export function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="z-50 flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground shadow-panel"
        >
          {label}
          {shortcut ? <span className="text-muted-foreground">{shortcut}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-float">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm leading-5 text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
