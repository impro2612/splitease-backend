import Link from "next/link"

export type LegalSection = { heading: string; body: (string | string[])[] }

/** Plain, readable page for the Privacy Policy and Terms (linked from the apps and store listings). */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-slate-300">
      <Link href="/" className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">SplitIT</Link>
      <h1 className="mt-6 text-3xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>
      <p className="mt-6 leading-7">{intro}</p>
      {sections.map((s, i) => (
        <section key={s.heading} className="mt-10">
          <h2 className="text-lg font-semibold text-white">{i + 1}. {s.heading}</h2>
          {s.body.map((p, j) =>
            Array.isArray(p) ? (
              <ul key={j} className="mt-3 list-disc space-y-2 pl-5 leading-7">
                {p.map((li) => <li key={li}>{li}</li>)}
              </ul>
            ) : (
              <p key={j} className="mt-3 leading-7">{p}</p>
            ),
          )}
        </section>
      ))}
      <footer className="mt-14 border-t border-white/10 pt-6 text-sm text-slate-500">
        <Link href="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-slate-300">Terms of Use</Link>
        <span className="mx-2">·</span>
        <a href="mailto:support.splitit@gmail.com" className="hover:text-slate-300">support.splitit@gmail.com</a>
      </footer>
    </main>
  )
}
