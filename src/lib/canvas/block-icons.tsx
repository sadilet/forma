import { AppWindow, Database, FileText, GitBranch, Server, UserRound, type LucideIcon } from "lucide-react";
import type { BlockKind } from "@/lib/canvas/kinds";

// Same pictures in the toolbar and on the canvas cards.
export const BLOCK_ICONS: Record<BlockKind, LucideIcon> = {
  screen: AppWindow,
  service: Server,
  database: Database,
  entity: UserRound,
  decision: GitBranch,
  note: FileText,
};
