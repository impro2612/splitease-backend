import Link from "next/link"
import { ArrowRight, Users, Receipt, TrendingUp, Zap, Shield, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a1a] overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-purple-600/15 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[30%] w-[400px] h-[400px] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-lg">
            💸
          </div>
          <span className="text-xl font-bold text-white">SplitEase</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/signin">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started free</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-32">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-sm font-medium mb-8">
            <Zap className="w-4 h-4" />
            Split bills in seconds, not minutes
          </div>

          <h1 className="text-6xl sm:text-7xl font-bold text-white leading-[1.1] mb-6">
            Split expenses,{" "}
            <span className="gradient-text">not friendships</span>
          </h1>

          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Track shared expenses, split bills fairly, and settle up with friends —
            all in one beautifully simple app. No more awkward money conversations.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="xl" className="group w-full sm:w-auto">
                Start splitting for free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/signin">
              <Button size="xl" variant="outline" className="w-full sm:w-auto">
                Sign in to your account
              </Button>
            </Link>
          </div>

          <p className="mt-4 text-sm text-slate-500">No credit card required · Free forever for small groups</p>
        </div>

        {/* App preview card */}
        <div className="mt-20 max-w-5xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/50 glow-indigo">
            {/* Mock app header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-rose-500/60" />
                <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded-full bg-white/5 text-xs text-slate-400">
                  splitease.app/dashboard
                </div>
              </div>
            </div>
            {/* Mock dashboard */}
            <div className="p-6 grid grid-cols-3 gap-4">
              <div className="col-span-3 sm:col-span-1 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400 mb-1">Total you&apos;re owed</p>
                <p className="text-2xl font-bold text-emerald-400">+$342.50</p>
                <p className="text-xs text-slate-500 mt-1">across 4 groups</p>
              </div>
              <div className="col-span-3 sm:col-span-1 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400 mb-1">You owe others</p>
                <p className="text-2xl font-bold text-rose-400">-$87.20</p>
                <p className="text-xs text-slate-500 mt-1">to 2 friends</p>
              </div>
              <div className="col-span-3 sm:col-span-1 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-slate-400 mb-1">Active groups</p>
                <p className="text-2xl font-bold text-white">7</p>
                <p className="text-xs text-slate-500 mt-1">12 members total</p>
              </div>
              <div className="col-span-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white mb-3">Recent activity</p>
                <div className="space-y-2">
                  {[
                    { user: "Alex", action: "added", expense: "Dinner at Nobu", amount: "$240", group: "NYC Trip" },
                    { user: "Sarah", action: "settled up", expense: "with you", amount: "$45", group: "Apartment" },
                    { user: "You", action: "added", expense: "Uber ride", amount: "$18", group: "Weekend Getaway" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs text-white font-bold">
                          {item.user[0]}
                        </div>
                        <span className="text-xs text-slate-300">
                          <span className="text-white font-medium">{item.user}</span>{" "}
                          {item.action} <span className="text-slate-200">{item.expense}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${item.action === "settled up" ? "text-emerald-400" : "text-slate-300"}`}>
                          {item.amount}
                        </span>
                        <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{item.group}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-32 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              icon: <Users className="w-6 h-6" />,
              title: "Group expenses",
              desc: "Create groups for any occasion — trips, apartments, dinners — and track every expense together.",
            },
            {
              icon: <Receipt className="w-6 h-6" />,
              title: "Smart splitting",
              desc: "Split equally, by percentage, or exact amounts. Works perfectly for any payment scenario.",
            },
            {
              icon: <TrendingUp className="w-6 h-6" />,
              title: "Clear balances",
              desc: "Always know exactly who owes what. Settle up with one tap and keep friendships intact.",
            },
          ].map((f, i) => (
            <div key={i} className="glass rounded-2xl p-6 hover:border-indigo-500/30 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4">
                {f.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="mt-24 glass rounded-2xl p-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {[
              { value: "10K+", label: "Active users" },
              { value: "$2M+", label: "Expenses tracked" },
              { value: "50K+", label: "Bills split" },
              { value: "4.9★", label: "User rating" },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-3xl font-bold gradient-text mb-1">{s.value}</div>
                <div className="text-sm text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Trust */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-slate-500 text-sm">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> Bank-level security</div>
          <div className="flex items-center gap-2"><Globe className="w-4 h-4" /> 150+ currencies</div>
          <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> Real-time sync</div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 text-center text-slate-500 text-sm">
        <p>© 2024 SplitEase. Made with ❤️ for people who hate awkward money chats.</p>
      </footer>
    </div>
  )
}
