"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { apiClient, type SavedBrief, type BriefSearchRecord, type LicensingInterest, type SupervisorProfile } from "@/lib/api-client";
import { useToast } from "@/components/ui/Toast";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { Card, Eyebrow, Section } from "@/components/ui/primitives";
import { LicensesSection } from "@/components/supervisor/LicensesSection";
import { MatchBenchmarkPanel } from "@/components/supervisor/MatchBenchmarkPanel";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { LICENSE_FEES, type LicenseUsageType } from "@/lib/pricing";
import { matchBriefHash } from "@/lib/match-benchmark";

const PAGE_SIZE = 10;

export function SupervisorDashboard() {
  const { isAuthenticated, requireAuth } = useSupervisorAuth();
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
    if (!isAuthenticated) {
      setProfile(null);
      setInterests([]);
      setLoading(false);
      return;
    }
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
  }, [showToast, isAuthenticated]);

  const refreshLists = useCallback(async () => {
    setListsLoading(true);
    try {
      await Promise.all([
        fetchSavedBriefs(savedBriefsPage, savedBriefsSearch),
        fetchRecentSearches(recentSearchesPage, recentSearchesSearch),
      ]);
    } finally {
      setListsLoading(false);
    }
  }, [fetchSavedBriefs, fetchRecentSearches, savedBriefsPage, savedBriefsSearch, recentSearchesPage, recentSearchesSearch]);

  useEffect(() => {
    void refreshProfileAndInterests();
  }, [refreshProfileAndInterests]);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

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
    <div className="flex flex-col gap-2">
      {!isAuthenticated && (
        <div className="mb-6 border border-[var(--color-hair-strong)] rounded-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <Eyebrow className="mb-1 text-[var(--color-rust)]">Sign in required</Eyebrow>
            <p className="font-serif text-sm text-[var(--color-ink-2)]">
              Search stays guest-friendly. Shortlist and license require a signed-in wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requireAuth("/supervisor")}
            className="shrink-0 bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors"
          >
            Sign in →
          </button>
        </div>
      )}

      {!loading && !listsLoading && briefFromUrl && !isBriefSaved && (
        <Card className="mb-6 border-[var(--color-rust)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <Eyebrow className="mb-1 text-[var(--color-rust)]">Brief from search</Eyebrow>
            <p className="font-serif text-sm">{briefFromUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => void onAutoSave()}
            disabled={autoSaving}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.14em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
          >
            {autoSaving ? "Saving…" : "Save brief"}
          </button>
        </Card>
      )}

      {isAuthenticated && (
        <ProfileSection profile={profile} onUpdate={refreshProfileAndInterests} />
      )}

      <ShortlistSection
        interests={interests}
        isAuthenticated={isAuthenticated}
        loading={loading}
        onChange={refreshProfileAndInterests}
        requireAuth={requireAuth}
      />

      <Section eyebrow="Activity" title="Recent searches" divider={false} className="py-8">
        <CompactSearchInput
          value={recentSearchesSearch}
          onChange={(s) => {
            setRecentSearchesSearch(s);
            setRecentSearchesPage(0);
          }}
          placeholder="Filter searches"
        />
        {recentSearches.length === 0 ? (
          <EmptyState text="No recent searches." href="/discover" linkLabel="Run a brief →" />
        ) : (
          <ul className="mt-4 space-y-2">
            {recentSearches.map((s) => (
              <li key={s.id}>
                <CompactRow
                  title={s.brief_text}
                  meta={`${s.results_count} matches · ${new Date(s.created_at).toLocaleDateString()}`}
                  action={
                    <Link
                      href={`/discover?brief=${encodeURIComponent(s.brief_text)}`}
                      className="font-mono text-[10px] uppercase tracking-[0.12em] border border-[var(--color-ink)] px-3 py-1.5 hover:border-[var(--color-rust)] hover:text-[var(--color-rust)] transition-colors"
                    >
                      Run again
                    </Link>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {recentSearchesTotal > PAGE_SIZE && (
          <PaginationControls
            page={recentSearchesPage}
            pageSize={PAGE_SIZE}
            total={recentSearchesTotal}
            onPrev={() => setRecentSearchesPage((p) => p - 1)}
            onNext={() => setRecentSearchesPage((p) => p + 1)}
            onGoTo={setRecentSearchesPage}
          />
        )}
      </Section>

      <Section eyebrow="Library" title="Saved briefs" className="py-8">
        <CompactSearchInput
          value={savedBriefsSearch}
          onChange={(s) => {
            setSavedBriefsSearch(s);
            setSavedBriefsPage(0);
          }}
          placeholder="Filter briefs"
        />
        {savedBriefs.length === 0 ? (
          <EmptyState text="No saved briefs yet." href="/discover" linkLabel="Search catalog →" />
        ) : (
          <ul className="mt-4 space-y-2">
            {savedBriefs.map((b) => (
              <SavedBriefRow key={b.id} brief={b} onDelete={refreshLists} />
            ))}
          </ul>
        )}
        {savedBriefsTotal > PAGE_SIZE && (
          <PaginationControls
            page={savedBriefsPage}
            pageSize={PAGE_SIZE}
            total={savedBriefsTotal}
            onPrev={() => setSavedBriefsPage((p) => p - 1)}
            onNext={() => setSavedBriefsPage((p) => p + 1)}
            onGoTo={setSavedBriefsPage}
          />
        )}
      </Section>

      <div id="licenses">
        <LicensesSection isAuthenticated={isAuthenticated} requireAuth={requireAuth} />
      </div>

      <MatchBenchmarkPanel compact />

      {(loading || listsLoading) && (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)] py-4">
          Loading…
        </p>
      )}
    </div>
  );
}

function CompactSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setInput(value); }, [value]);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleChange = (v: string) => {
    setInput(v);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(v), 300);
  };

  return (
    <input
      type="text"
      value={input}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={placeholder}
      className="w-full max-w-md border border-[var(--color-hair-strong)] bg-transparent px-3 py-2 font-mono text-[11px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:outline-none focus:border-[var(--color-ink)]"
    />
  );
}

function CompactRow({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-[var(--color-hair)] rounded-sm p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-[var(--color-ink-3)] transition-colors">
      <div className="min-w-0">
        <p className="font-serif text-[14px] truncate">{title}</p>
        {meta && (
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] mt-0.5">
            {meta}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ text, href, linkLabel }: { text: string; href: string; linkLabel: string }) {
  return (
    <p className="mt-4 font-serif text-sm text-[var(--color-ink-2)]">
      {text}{" "}
      <Link href={href} className="text-[var(--color-rust)] hover:underline">
        {linkLabel}
      </Link>
    </p>
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
    <Section eyebrow="Account" title="Profile" divider={false} className="py-8">
      {editing ? (
        <div className="flex flex-col gap-2 max-w-md">
          {(["name", "email", "company"] as const).map((field) => (
            <input
              key={field}
              type={field === "email" ? "email" : "text"}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
              className="border border-[var(--color-hair-strong)] bg-transparent px-3 py-2 font-serif text-sm focus:outline-none focus:border-[var(--color-ink)]"
            />
          ))}
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as SupervisorProfile["role"] }))}
            className="border border-[var(--color-hair-strong)] bg-transparent px-3 py-2 font-serif text-sm"
          >
            <option value="supervisor">Music Supervisor</option>
            <option value="sync_house">Sync House</option>
            <option value="aandr">A&R</option>
          </select>
          <div className="flex gap-2 mt-1">
            <button type="button" onClick={() => void onSave()} className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 hover:bg-[var(--color-rust)] transition-colors">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="font-mono text-[10px] uppercase tracking-[0.12em] px-4 py-2 text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-serif text-base font-semibold">{profile?.name || "No name set"}</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] mt-1">
              {[profile?.email, profile?.company, profile?.role ?? "supervisor"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors shrink-0"
          >
            Edit →
          </button>
        </div>
      )}
    </Section>
  );
}

function SavedBriefRow({ brief, onDelete }: { brief: SavedBrief; onDelete: () => void }) {
  const { showToast } = useToast();

  const onDeleteClick = async () => {
    try {
      await apiClient.deleteSavedBrief(brief.id);
      showToast("Brief deleted", "success");
      onDelete();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <CompactRow
      title={brief.brief_text}
      meta={new Date(brief.created_at).toLocaleDateString()}
      action={
        <div className="flex gap-2 shrink-0">
          <Link
            href={`/discover?brief=${encodeURIComponent(brief.brief_text)}`}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 hover:bg-[var(--color-rust)] transition-colors"
          >
            Search
          </Link>
          <button
            type="button"
            onClick={() => void onDeleteClick()}
            className="font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
          >
            Delete
          </button>
        </div>
      }
    />
  );
}

function ShortlistSection({
  interests,
  isAuthenticated,
  loading,
  onChange,
  requireAuth,
}: {
  interests: LicensingInterest[];
  isAuthenticated: boolean;
  loading: boolean;
  onChange: () => void;
  requireAuth: (returnTo?: string) => boolean;
}) {
  const { showToast } = useToast();
  const router = useRouter();
  const [licensingId, setLicensingId] = useState<string | null>(null);

  const onRequestLicense = async (interest: LicensingInterest) => {
    if (!requireAuth("/supervisor")) return;
    setLicensingId(interest.id);
    try {
      const usageType: LicenseUsageType = "sync_tv_film";
      await apiClient.createLicense({
        submissionId: interest.submission_id,
        briefHash: matchBriefHash(`shortlist:${interest.submission_id}`),
        briefText: "Shortlisted from dashboard",
        usageType,
      });
      showToast(`License created · $${LICENSE_FEES[usageType]} USDC — settle below`, "success");
      router.push("/supervisor#licenses");
      onChange();
    } catch (err) {
      showToast(`License failed: ${(err as Error).message}`, "error");
    } finally {
      setLicensingId(null);
    }
  };

  const onRemove = async (id: string) => {
    try {
      await apiClient.updateInterest({ id, status: "passed" });
      showToast("Removed from shortlist", "success");
      onChange();
    } catch (err) {
      showToast(`Update failed: ${(err as Error).message}`, "error");
    }
  };

  return (
    <Section
      eyebrow="Pipeline"
      title="Shortlist"
      intro={isAuthenticated ? "Tracks you are considering for sync. Request a license, then settle below." : undefined}
      divider={false}
      className="py-8"
    >
      {!isAuthenticated ? (
        <EmptyState text="Sign in to save tracks from Discover." href="/discover" linkLabel="Search catalog →" />
      ) : loading ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">Loading…</p>
      ) : interests.filter((i) => i.status !== "passed").length === 0 ? (
        <EmptyState text="No shortlisted tracks." href="/discover" linkLabel="Find matches →" />
      ) : (
        <ul className="space-y-2">
          {interests.filter((i) => i.status !== "passed").map((i) => (
            <li key={i.id}>
              <div className="border border-[var(--color-hair)] rounded-sm p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-[var(--color-ink-3)] transition-colors">
                <div className="min-w-0">
                  <p className="font-serif text-[14px] font-medium truncate">
                    {i.title ?? "Untitled"}
                    <span className="text-[var(--color-ink-3)] font-normal"> · {i.artist_name ?? "Unknown"}</span>
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] mt-0.5">
                    {i.status}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void onRequestLicense(i)}
                    disabled={licensingId === i.id}
                    className="bg-[var(--color-ink)] text-[var(--color-paper)] font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 hover:bg-[var(--color-rust)] transition-colors disabled:opacity-50"
                  >
                    {licensingId === i.id ? "…" : "License · $250"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemove(i.id)}
                    className="font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 text-[var(--color-ink-3)] hover:text-[var(--color-rust)] transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
