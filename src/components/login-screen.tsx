"use client";

import Link from "next/link";
import { useState } from "react";
import { login } from "@/app/actions";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-provider";
import { Button, Input } from "@/components/ui";

const DEMOS = [
  {
    name: "Alex Rivera",
    role: "Product",
    email: "alex@forma.dev",
    color: "#6ea8fe",
  },
  {
    name: "Sam Chen",
    role: "Engineering",
    email: "sam@forma.dev",
    color: "#f0a05a",
  },
];

export function LoginScreen({ next }: { next?: string }) {
  const [email, setEmail] = useState("alex@forma.dev");
  const [password, setPassword] = useState("demo");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(nextEmail: string, nextPassword: string) {
    setPending(true);
    setError(null);
    const result = await login({ email: nextEmail, password: nextPassword, next });
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col justify-between px-8 py-8 sm:px-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Forma home" className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="max-w-xl py-16">
          <h1 className="max-w-lg text-5xl font-semibold leading-[1.05] tracking-[-0.04em]">
            Draw the product.
            <br />
            Specify it together.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-7 text-muted-foreground">
            Forma is a shared infinite canvas for software design. Sketch the system, select a
            component, and let the architect pressure-test what is still missing.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Two browsers. One workspace. Real cursors.</p>
      </section>
      <section className="flex items-center border-t border-border px-8 py-12 lg:border-l lg:border-t-0 sm:px-14">
        <div className="w-full max-w-sm">
          <h2 className="text-lg font-semibold tracking-tight">Enter a workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use a demo account. Open the other in a second browser.
          </p>
          <div className="mt-5 grid gap-2">
            {DEMOS.map((demo) => (
              <button
                key={demo.email}
                type="button"
                disabled={pending}
                onClick={() => {
                  setEmail(demo.email);
                  setPassword("demo");
                  void submit(demo.email, "demo");
                }}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-subtle px-3 py-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-[#101114]"
                  style={{ background: demo.color }}
                >
                  {demo.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{demo.name}</span>
                  <span className="block text-xs text-muted-foreground">{demo.role}</span>
                </span>
                <span className="text-xs text-muted-foreground">{demo.email}</span>
              </button>
            ))}
          </div>
          <form
            className="mt-6 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(email, password);
            }}
          >
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label="Email"
            />
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-label="Password"
            />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Entering…" : "Continue"}
            </Button>
            <p className="text-xs text-muted-foreground">Password for both accounts: demo</p>
          </form>
        </div>
      </section>
    </main>
  );
}
