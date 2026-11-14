import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Forma: figure out the product, then build it" },
  description:
    "A real-time collaborative studio. Sketch the idea, check it against the real world with an AI collaborator, settle the spec with your team, and build from the same context.",
};

export default async function Home() {
  const user = await getCurrentUser();
  return <LandingPage signedIn={Boolean(user)} videoUrl={process.env.PRODUCT_VIDEO_URL} />;
}
