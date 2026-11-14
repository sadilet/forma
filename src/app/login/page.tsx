import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in · Forma" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (user) redirect(next);
  return <LoginScreen next={params.next ? next : undefined} />;
}
