import { redirect } from "next/navigation";
import { ProjectHome } from "@/components/project-home";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const projects = await listProjects();
  return <ProjectHome user={user} projects={projects} />;
}
