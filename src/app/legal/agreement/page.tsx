import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Container } from "@/components/ui/primitives";
import { agreementFor, AGREEMENT_VERSION } from "@/lib/agreement";

export default function AgreementPage() {
  const supplier = agreementFor("supplier");
  const channel = agreementFor("channel");
  return (
    <div className="flex flex-col flex-1">
      <SiteHeader />
      <main className="flex-1 py-10">
        <Container>
          <p className="kicker">Legal · blanket agreement</p>
          <h1 className="mt-2 font-serif text-3xl font-black tracking-tight">VERSIONS {AGREEMENT_VERSION}</h1>
          <p className="mt-2 max-w-2xl font-serif text-sm leading-snug text-[var(--color-ink-2)]">
            One agreement for every free use, accepted once — at listing creation (supplier) or channel registration (channel). No per-track negotiation, no per-transaction contract.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <section className="card-surface p-5">
              <h2 className="font-serif text-lg font-bold">{supplier.title}</h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">{supplier.path}</p>
              <ul className="mt-4 space-y-2">
                {supplier.terms.map((t) => (
                  <li key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">• {t}</li>
                ))}
              </ul>
              <p className="mt-4 rounded-full bg-[var(--color-paper-2)] px-3 py-2 font-mono text-xs italic text-[var(--color-ink)]">“{supplier.acceptance}”</p>
            </section>
            <section className="card-surface p-5">
              <h2 className="font-serif text-lg font-bold">{channel.title}</h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">{channel.path}</p>
              <ul className="mt-4 space-y-2">
                {channel.terms.map((t) => (
                  <li key={t.slice(0, 40)} className="font-serif text-sm leading-snug text-[var(--color-ink-2)]">• {t}</li>
                ))}
              </ul>
              <p className="mt-4 rounded-full bg-[var(--color-paper-2)] px-3 py-2 font-mono text-xs italic text-[var(--color-ink)]">“{channel.acceptance}”</p>
            </section>
          </div>

          <div className="mt-8 flex gap-3">
            <Link href="/submit" className="btn-primary">List supply →</Link>
            <Link href="/channels" className="btn-secondary">Connect a channel →</Link>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}
