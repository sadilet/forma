import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
      <Link href="/" aria-label="Forma home" className="w-fit rounded-md">
        <Logo />
      </Link>
      <div className="my-auto py-24">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">This page does not exist.</h1>
        <p className="mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
          The link may be old, or the workspace may have been removed.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Button asChild variant="primary">
            <Link href="/projects">Go to workspaces</Link>
          </Button>
          <Button asChild variant="quiet">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
