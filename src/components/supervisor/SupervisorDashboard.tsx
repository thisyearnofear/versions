"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { apiClient, type SavedBrief, type BriefSearchRecord, type LicensingInterest, type SupervisorProfile } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { AudioPlayer } from "@/components/audio/AudioPlayer";

const PAGE_SIZE = 10;

export function SupervisorDashboard() {
  const { address, isConnected } = useAccount();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<SupervisorProfile | null>(null);
  const [savedBriefs, setSavedBriefs] = useState<SavedBrief[]>([]);
  const [recentSearches, setRecentSearches] = useState<BriefSearchRecord[]>([]);
  const [interests, setInterests] = useState<LicensingInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [listsLoading, setListsLoading] = useState(true);
  const [autoSaving, setAutoSaving] = useState(false);

  const [savedBriefsPage, setSavedBriefsPage] = useState(0);
  const [savedBriefsSearch, setSavedBriefsSearch] = useState("");
  const [savedBriefsTotal, setSavedBriefsTotal] = useState(0);
  const [recentSearchesPage, setRecentSearchesPage] = useState(0);
  const [recentSearchesSearch, setRecentSearchesSearch] = useState("");
  const [recentSearchesTotal, setRecentSearchesTotal] = useState(0);

  const briefFromUrl = searchParams.get("brief")?.trim();
  const isBriefSaved = briefFromUrl
    ? savedBriefs.some((b) => b.brief_text.trim() === briefFromUrl)
    : true;

  const fetchSavedBriefs = useCallback(async (page: number, search: string) => {
    try {
      const res = await apiClient.getSavedBriefs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search,
      });
      setSavedBriefs(res.rows);
      setSavedBriefsTotal(res.total);
    } catch (err) {
      showToast(`Saved briefs load failed: ${(err as Error).message}`, "error");
    }
  }, [showToast]);

  const fetchRecentSearches = useCallback(async (page: number, search: string) => {
    try {
      const res = await apiClient.getRecentSearches({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search,
      });
      setRecentSearches(res.rows);
      setRecentSearchesTotal(res.total);
    } catch (err) {
      showToast(`Recent searches load failed: ${(err as Error).message}`, "error");
    }
  }, [showToast]);

  const refreshProfileAndInterests = useCallback(async () => {
    if (!isConnected || !address) return;
    setLoading(true);
    try {
      const [profileRes, interestsRes] = await Promise.all([
        apiClient.getSupervisorProfile(),
        apiClient.getInterests(),
      ]);
      setProfile(profileRes.profile);
      setInterests(interestsRes.rows);
    } catch (err) {
      showToast(`Dashboard load failed: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, showToast]);

  const refreshLists = useCallback(async () => {
    if (!isConnected || !address) return;
    setListsLoading(true);
    try {
      await Promise.all([
        fetchSavedBriefs(savedBriefsPage, savedBriefsSearch),
        fetchRecentSearches(recentSearchesPage, recentSearchesSearch),
      ]);
    } finally {
      setListsLoading(false);
    }
  }, [address, isConnected, fetchSavedBriefs, fetchRecentSearches, savedBriefsPage, savedBriefsSearch, recentSearchesPage, recentSearchesSearch]);

  useEffect(() => {
    void refreshProfileAndInterests();
  }, [refreshProfileAndInterests]);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  if (!isConnected) {
    return (
      <div className="border-t border-b border-[var(--color-hair)] py-12 text-center">
        <p className="font-serif text-lg text-[var(--color-ink-2)]">
          Connect your wallet to view your supervisor dashboard.
        </p>
      </div>
    );
  }

  const onAutoSave = async () => {
    if (!briefFromUrl) return;
    setAutoSaving(true);
    try {
      await apiClient.saveBrief({ briefText: briefFromUrl });
      showToast("Brief saved", "success");
      router.replace("/supervisor");
      await refreshLists();
    } catch (err) {
      showToast(`Save failed: ${(err as Error).message}`, "error");
    } finally {
      setAutoSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-16">
      {!loading && !listsLoading && briefFromUrl && !isBriefSaved && (
        <section className="border border-[var(--color-rust)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rust)] mb-1">
              Brief from search
            </p>
            <p className="font-serif text-base">{briefFromUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => void onAutoSave()}
            disabled={autoSaving}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {autoSaving ? "Saving…" : "Save to dashboard"}
          </button>
        </section>
      )}
      <ProfileSection profile={profile} onUpdate={refreshProfileAndInterests} />
      <SavedBriefsSection
        briefs={savedBriefs}
        total={savedBriefsTotal}
        page={savedBriefsPage}
        onPageChange={(p) => {
          setSavedBriefsPage(p);
        }}
        search={savedBriefsSearch}
        onSearch={(s) => {
          setSavedBriefsSearch(s);
          setSavedBriefsPage(0);
        }}
        onChange={refreshLists}
      />
      <RecentSearchesSection
        searches={recentSearches}
        total={recentSearchesTotal}
        page={recentSearchesPage}
        onPageChange={(p) => {
          setRecentSearchesPage(p);
        }}
        search={recentSearchesSearch}
        onSearch={(s) => {
          setRecentSearchesSearch(s);
          setRecentSearchesPage(0);
        }}
      />
      <InterestsSection interests={interests} onChange={refreshProfileAndInterests} />
      {loading && (
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
          Loading…
        </div>
      )}
    </div>
  );
}

function ProfileSection({
  profile,
  onUpdate,
}: {
  profile: SupervisorProfile | null;
  onUpdate: () => void;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    company: profile?.company ?? "",
    role: profile?.role ?? "supervisor",
  });

  useEffect(() => {
    if (!editing) {
      setForm({
        name: profile?.name ?? "",
        email: profile?.email ?? "",
        company: profile?.company ?? "",
        role: profile?.role ?? "supervisor",
      });
    }
  }, [profile, editing]);

  const onSave = async () => {
    try {
      await apiClient.updateSupervisorProfile(form);
      showToast("Profile updated", "success");
      setEditing(false);
      onUpdate();
    } catch (err) {
      showToast(`Update failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <section className="border-t border-[var(--color-ink)] pt-8">
      <h3 className="font-serif text-2xl font-black tracking-tight mb-4">Profile</h3>
      {editing ? (
        <div className="flex flex-col gap-3 max-w-xl">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-3 font-serif text-base"
          />
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email"
            className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-3 font-serif text-base"
          />
          <input
            type="text"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
            placeholder="Company"
            className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-3 font-serif text-base"
          />            <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as SupervisorProfile["role"] }))}
            className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-3 font-serif text-base"
          >
            <option value="supervisor">Music Supervisor</option>
            <option value="sync_house">Sync House</option>
            <option value="aandr">A&R</option>
          </select>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:bg-[var(--color-rust)] transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-5 py-3 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-w-xl">
          <div className="font-serif text-lg">{profile?.name || "No name set"}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
            {profile?.email && <span className="mr-4">{profile.email}</span>}
            {profile?.company && <span className="mr-4">{profile.company}</span>}
            <span className="text-[var(--color-rust)]">{profile?.role ?? "supervisor"}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setForm({
                name: profile?.name ?? "",
                email: profile?.email ?? "",
                company: profile?.company ?? "",
                role: profile?.role ?? "supervisor",
              });
              setEditing(true);
            }}
            className="mt-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
          >
            Edit profile →
          </button>
        </div>
      )}
    </section>
  );
}

function SavedBriefsSection({
  briefs,
  total,
  page,
  onPageChange,
  search,
  onSearch,
  onChange,
}: {
  briefs: SavedBrief[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearch: (search: string) => void;
  onChange: () => void;
}) {
  const { showToast } = useToast();
  const [input, setInput] = useState(search);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setInput(search); }, [search]);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleSearch = (value: string) => {
    setInput(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { onSearch(value); }, 300);
  };

  const onDelete = async (id: string) => {
    try {
      await apiClient.deleteSavedBrief(id);
      showToast("Brief deleted", "success");
      onChange();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <section className="border-t border-[var(--color-ink)] pt-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <h3 className="font-serif text-2xl font-black tracking-tight">Saved briefs</h3>
        <input
          type="text"
          value={input}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search saved briefs"
          className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-2 font-serif text-sm max-w-md"
        />
      </div>
      {briefs.length === 0 ? (
        <p className="font-serif text-[var(--color-ink-2)]">No saved briefs yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {briefs.map((b) => (
              <li
                key={b.id}
                className="border border-[var(--color-hair-strong)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div>
                  <p className="font-serif text-base">{b.brief_text}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
                    {new Date(b.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Link
                    href={`/discover?brief=${encodeURIComponent(b.brief_text)}`}
                    className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors"
                  >
                    Search
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onDelete(b.id)}
                    className="border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPrev={() => onPageChange(page - 1)}
            onNext={() => onPageChange(page + 1)}
            onGoTo={onPageChange}
          />
        </>
      )}
    </section>
  );
}

function RecentSearchesSection({
  searches,
  total,
  page,
  onPageChange,
  search,
  onSearch,
}: {
  searches: BriefSearchRecord[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearch: (search: string) => void;
}) {
  const [input, setInput] = useState(search);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setInput(search); }, [search]);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleSearch = (value: string) => {
    setInput(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { onSearch(value); }, 300);
  };
  return (
    <section className="border-t border-[var(--color-ink)] pt-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <h3 className="font-serif text-2xl font-black tracking-tight">Recent searches</h3>
        <input
          type="text"
          value={input}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search recent searches"
          className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-2 font-serif text-sm max-w-md"
        />
      </div>
      {searches.length === 0 ? (
        <p className="font-serif text-[var(--color-ink-2)]">No recent searches.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {searches.map((s) => (
              <li
                key={s.id}
                className="border border-[var(--color-hair-strong)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div>
                  <p className="font-serif text-base">{s.brief_text}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
                    {s.results_count} matches · {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Link
                  href={`/discover?brief=${encodeURIComponent(s.brief_text)}`}
                  className="border border-[var(--color-ink)] font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
                >
                  Run again
                </Link>
              </li>
            ))}
          </ul>
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPrev={() => onPageChange(page - 1)}
            onNext={() => onPageChange(page + 1)}
            onGoTo={onPageChange}
          />
        </>
      )}
    </section>
  );
}

function InterestsSection({
  interests,
  onChange,
}: {
  interests: LicensingInterest[];
  onChange: () => void;
}) {
  const { showToast } = useToast();

  const onUpdateStatus = async (id: string, status: LicensingInterest["status"]) => {
    try {
      await apiClient.updateInterest({ id, status });
      showToast("Status updated", "success");
      onChange();
    } catch (err) {
      showToast(`Update failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <section className="border-t border-[var(--color-ink)] pt-8">
      <h3 className="font-serif text-2xl font-black tracking-tight mb-4">Licensing interests</h3>
      {interests.length === 0 ? (
        <p className="font-serif text-[var(--color-ink-2)]">
          No tracks marked yet. Search the catalog and click “Interested” to build your shortlist.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {interests.map((i) => (
            <li
              key={i.id}
              className="border border-[var(--color-hair-strong)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div>
                <p className="font-serif text-base">
                  {i.artist_wallet ? (
                    <Link href={`/artists/${encodeURIComponent(i.artist_wallet)}`} className="hover:text-[var(--color-rust)] transition-colors">
                      {i.title ?? "Untitled"}
                    </Link>
                  ) : (
                    <span>{i.title ?? "Untitled"}</span>
                  )}{" "}
                  <span className="text-[var(--color-ink-3)]">·</span> {i.artist_name ?? "Unknown artist"}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] mt-1">
                  {i.submission_id.slice(0, 8)}… · Status: <span className="text-[var(--color-rust)]">{i.status}</span>
                </p>
              </div>
              <select
                value={i.status}
                onChange={(e) => void onUpdateStatus(i.id, e.target.value as LicensingInterest["status"])}
                className="border border-[var(--color-ink)] bg-[var(--color-paper)] p-2 font-mono text-[10px] uppercase tracking-[0.12em]"
              >
                <option value="interested">Interested</option>
                <option value="contacted">Contacted</option>
                <option value="licensed">Licensed</option>
                <option value="passed">Passed</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
