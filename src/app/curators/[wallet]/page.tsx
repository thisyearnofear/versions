import { redirect } from "next/navigation";

// MODULAR: IA consolidation — human curation was replaced by the three AI
// agents (the only writer of curator ratings is src/services/agents.ts), so
// the per-wallet Curator Dashboard is vestigial and contradicts the "three
// distinct agent lenses" story. /curators/[wallet] stays alive as a redirect
// to the system-proof page so deep links and bookmarks keep working. The
// /api/v1/curators/* read endpoints remain available if a future surface
// needs them.
export default async function CuratorPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  await params;
  redirect("/agents");
}
