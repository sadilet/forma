import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { getCurrentUser } from "@/lib/auth";
import { collaborationConfigured } from "@/lib/liveblocks";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  const project = await getProject(projectId);
  return { title: project ? `${project.name} · Forma` : "Forma" };
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await getCurrentUser();
  const { projectId } = await params;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/w/${projectId}`)}`);
  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <Workspace
      user={user}
      project={project}
      collaborationEnabled={collaborationConfigured()}
      licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
    />
  );
}
