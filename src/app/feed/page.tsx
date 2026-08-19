import { redirect } from "next/navigation";

// MODULAR: IA consolidation — the library is now a tab inside the
// Workspace (/supervisor?tab=library), not a separate room. /feed stays
// alive as a redirect so deep links and bookmarks keep working.
export default function FeedPage() {
  redirect("/supervisor?tab=library");
}
