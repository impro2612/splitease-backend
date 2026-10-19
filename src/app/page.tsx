/* eslint-disable @next/next/no-img-element -- static marketing images, no optimisation needed */
import Link from "next/link"
import {
  ArrowRightLeft, BellRing, BookOpen, Check, Coins, Map, MessageCircle, PieChart, Plane, ReceiptText, ShieldCheck, Sparkles, Users,
} from "lucide-react"

// Store links go live here once the apps are published; until then the buttons say "Coming soon"
const APP_STORE_URL: string | null = null
const PLAY_STORE_URL: string | null = null

const FEATURES = [
  { icon: ReceiptText, color: "#818cf8", title: "Unlimited expenses, free", text: "Add every bill, split it equally, by percentage or exact amounts. No daily limits, ever." },
  { icon: ArrowRightLeft, color: "#34d399", title: "Smart Debts", text: "SplitIT works out the fewest payments needed, so the group settles up in minutes." },
  { icon: Coins, color: "#fbbf24", title: "Any currency", text: "Travelling abroad? Each expense keeps its own currency, and your totals convert live." },
  { icon: MessageCircle, color: "#4ade80", title: "Friends & chat", text: "Find friends by name, email or phone, sync your contacts and chat right in the app." },
  { icon: BookOpen, color: "#f59e0b", title: "Borrow Book", text: "Lent someone cash? Keep personal IOUs separate from groups, with part payments." },
  { icon: Plane, color: "#10b981", title: "Trip Planner", text: "Set a budget before you go and see how you're tracking while you travel." },
  { icon: Map, color: "#a78bfa", title: "Timeline", text: "Every trip pinned on a map, so you can look back at where you've been." },
  { icon: Sparkles, color: "#fb7185", title: "ScrapBook", text: "Relive your year: the trips, the people and the spends, as a story you can share." },
  { icon: PieChart, color: "#a3e635", title: "My Spending", text: "Import a bank statement and see where your money goes, with smart insights." },
  { icon: BellRing, color: "#38bdf8", title: "Auto expense tracking", text: "On a trip, SplitIT spots payment alerts and offers to add them to the group. (Android)" },
]

const FAQ = [
  { q: "Does SplitIT move money?", a: "No. SplitIT keeps track of who owes whom. Pay each other however you like, by UPI, cash or bank transfer, and record it with Settle up." },
  { q: "Is SplitIT free?", a: "Splitting is free forever: groups, unlimited expenses, settling up, friends and chat. Everything else is free for your first 3 months, then part of SplitIT Plus." },
  { q: "Do my friends need the app?", a: "To see the group and add expenses, yes. Invite them by WhatsApp or text message right from the app." },
  { q: "Is my data safe?", a: "Everything is sent over encrypted connections and stored on servers in India. We never sell your data or show ads. Read our Privacy Policy for the details." },
]

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.51zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.68.97.07 1.96-.49 2.56-1.23z" />
    </svg>
  )
}

function PlayLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path fill="#34a853" d="M3.6 2.2 13.4 12l-9.8 9.8c-.4-.2-.6-.6-.6-1.1V3.3c0-.5.2-.9.6-1.1z" />
      <path fill="#fbbc04" d="M16.8 15.4 13.4 12l3.4-3.4 3.8 2.2c1.1.6 1.1 1.8 0 2.4l-3.8 2.2z" />
      <path fill="#4285f4" d="M16.8 15.4 13.4 12l-9.8 9.8c.4.2.9.2 1.4-.1l11.8-6.3z" />
      <path fill="#ea4335" d="M16.8 8.6 5 2.3c-.5-.3-1-.3-1.4-.1L13.4 12l3.4-3.4z" />
    </svg>
  )
}

function StoreButton({ store }: { store: "apple" | "google" }) {
  const url = store === "apple" ? APP_STORE_URL : PLAY_STORE_URL
  const top = store === "apple" ? "Download on the" : "Get it on"
  const name = store === "apple" ? "App Store" : "Google Play"
  const body = (
    <>
      {store === "apple" ? <AppleLogo /> : <PlayLogo />}
      <span className="text-left leading-tight">
        <span className="block text-[11px] text-slate-400">{url ? top : "Coming soon to"}</span>
        <span className="block text-base font-semibold text-white">{name}</span>
      </span>
    </>
  )
  const cls = "flex h-14 w-48 items-center gap-3 rounded-2xl border border-white/15 bg-black px-4 text-white transition"
  return url ? (
    <a href={url} className={`${cls} hover:border-white/40`}>{body}</a>
  ) : (
    <div className={`${cls} cursor-default opacity-90`} aria-label={`${name}, coming soon`}>{body}</div>
  )
}

function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[2.2rem] border border-white/10 bg-[#12121f] p-2 shadow-2xl shadow-indigo-950/60 ${className}`}>
      <img src={src} alt={alt} width={466} height={900} className="w-full rounded-[1.8rem]" loading="lazy" />
    </div>
  )
}

export default function Home() {
  return (
    <div className="relative overflow-hidden text-slate-300">
      {/* Soft glow behind the hero */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-12rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <a href="#top" className="flex items-center gap-2.5">
          <img src="/splitit-logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl bg-white" />
          <span className="font-display text-xl font-bold text-white">SplitIT</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm sm:flex">
          <a href="#features" className="hover:text-white">Features</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
          <a href="#faq" className="hover:text-white">FAQ</a>
        </nav>
        <a href="#download" className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400">Get the app</a>
      </header>

      <main id="top" className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200">
              <Sparkles className="h-3.5 w-3.5" /> Unlimited expenses · free forever
            </p>
            <h1 className="font-display text-5xl font-extrabold leading-[1.05] text-white sm:text-6xl">
              Split expenses.<br />
              <span className="bg-gradient-to-r from-indigo-300 to-teal-300 bg-clip-text text-transparent">Stay friends.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
              Trips, flats, dinners and everything in between. Add what you spent, SplitIT works out who owes whom, and you settle up however you like.
            </p>
            <div id="download" className="mt-9 flex flex-wrap gap-3 scroll-mt-24">
              <StoreButton store="apple" />
              <StoreButton store="google" />
            </div>
            <p className="mt-4 text-sm text-slate-500">For iPhone and Android · Made in India 🇮🇳</p>
          </div>
          <div className="relative mx-auto w-full max-w-[19rem]">
            <Phone src="/screens/dashboard.webp" alt="SplitIT home screen showing your net balance and who owes whom" />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">Everything shared money needs</h2>
            <p className="mt-4 text-slate-400">From a weekend trip to years of flat bills, SplitIT keeps it fair and simple.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, color, title, text }) => (
              <div key={title} className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}22` }}>
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Screens */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="font-display text-center text-3xl font-bold text-white sm:text-4xl">Clean, quick and made for groups</h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-400">See every expense, every balance and everything that changed, at a glance.</p>
          <div className="mt-14 flex items-start justify-center gap-5 overflow-x-auto pb-4 [scrollbar-width:none]">
            <Phone src="/screens/group.webp" alt="A group with its expenses" className="w-56 shrink-0 sm:w-60" />
            <Phone src="/screens/activity.webp" alt="Activity across your groups" className="mt-10 hidden w-56 shrink-0 sm:block sm:w-60" />
            <Phone src="/screens/friends.webp" alt="Your friends list" className="w-56 shrink-0 sm:w-60" />
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-5xl scroll-mt-20 px-5 py-20">
          <h2 className="font-display text-center text-3xl font-bold text-white sm:text-4xl">Simple, fair pricing</h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-400">Every new account gets <span className="text-white">all features free for 3 months</span>. After that, splitting stays free forever.</p>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
              <h3 className="font-display text-xl font-bold text-white">Free</h3>
              <p className="mt-1 text-sm text-slate-400">Forever</p>
              <p className="font-display mt-6 text-4xl font-extrabold text-white">₹0</p>
              <ul className="mt-6 space-y-3 text-sm">
                {["Groups & unlimited expenses", "Balances, Smart Debts & settle up", "Any currency", "Friends, chat & activity"].map((t) => (
                  <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="relative rounded-3xl border border-indigo-400/40 bg-gradient-to-b from-indigo-500/15 to-transparent p-8">
              <span className="absolute right-6 top-6 rounded-full bg-indigo-500 px-3 py-1 text-xs font-semibold text-white">3 months free</span>
              <h3 className="font-display text-xl font-bold text-white">SplitIT Plus</h3>
              <p className="mt-1 text-sm text-slate-400">Everything in Free, plus</p>
              <p className="font-display mt-6 text-4xl font-extrabold text-white">₹49<span className="text-base font-semibold text-slate-400"> /month</span></p>
              <p className="mt-1 text-sm text-slate-400">or ₹499 a year (save 15%)</p>
              <ul className="mt-6 space-y-3 text-sm">
                {["My Spending with smart insights", "Borrow Book", "Trip Planner", "Timeline map", "ScrapBook", "Spend Diary"].map((t) => (
                  <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20">
          <h2 className="font-display text-center text-3xl font-bold text-white sm:text-4xl">Questions</h2>
          <div className="mt-10 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group p-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-white">
                  {q}
                  <span className="text-xl text-slate-500 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final call to action */}
        <section className="mx-auto max-w-4xl px-5 pb-24 pt-8">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-600/25 to-teal-500/10 px-6 py-14 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-indigo-200" />
            <h2 className="font-display mt-4 text-3xl font-bold text-white">No more awkward money chats</h2>
            <p className="mx-auto mt-3 max-w-lg text-slate-300">Get SplitIT on your phone and invite your group. It takes a minute.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <StoreButton store="apple" />
              <StoreButton store="google" />
            </div>
            <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400"><Users className="h-4 w-4" /> Free for everyone in your group</p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5 px-5 py-10 text-sm text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/splitit-logo.png" alt="" width={24} height={24} className="h-6 w-6 rounded-md bg-white" />
            <span>© 2026 SplitIT</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-300">Terms of Use</Link>
            <a href="mailto:support.splitit@gmail.com" className="hover:text-slate-300">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
