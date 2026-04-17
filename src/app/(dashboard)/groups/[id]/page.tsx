"use client"

import { useState, useEffect, use } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import {
  ArrowLeft, Plus, Users, Receipt, TrendingUp,
  Trash2, UserPlus, X, ChevronDown, DollarSign
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate, getInitials, CATEGORY_ICONS } from "@/lib/utils"

type User = { id: string; name: string | null; email: string; image: string | null }
type Split = { id: string; userId: string; amount: number; paid: boolean; user: User }
type Expense = {
  id: string; description: string; amount: number; category: string
  paidById: string; paidBy: User; date: string; splits: Split[]
}
type Member = { id: string; userId: string; role: string; user: User }
type Settlement = { id: string; fromUser: User; toUser: User; amount: number; createdAt: string }
type Group = {
  id: string; name: string; description: string | null; color: string; emoji: string
  members: Member[]; expenses: Expense[]; settlements: Settlement[]
}
type Balance = { fromUser: User; toUser: User; amount: number }

const CATEGORIES = ["general", "food", "transport", "accommodation", "entertainment", "shopping", "utilities", "travel"]

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const [group, setGroup] = useState<Group | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])
  const [activeTab, setActiveTab] = useState<"expenses" | "balances" | "members">("expenses")
  const [loading, setLoading] = useState(true)

  // Expense dialog
  const [showExpense, setShowExpense] = useState(false)
  const [expDesc, setExpDesc] = useState("")
  const [expAmount, setExpAmount] = useState("")
  const [expCategory, setExpCategory] = useState("general")
  const [expPaidBy, setExpPaidBy] = useState("")
  const [expSaving, setExpSaving] = useState(false)

  // Member dialog
  const [showMember, setShowMember] = useState(false)
  const [memberEmail, setMemberEmail] = useState("")
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberError, setMemberError] = useState("")

  // Settle dialog
  const [settleTarget, setSettleTarget] = useState<Balance | null>(null)
  const [settleNote, setSettleNote] = useState("")
  const [settleSaving, setSettleSaving] = useState(false)

  async function fetchGroup() {
    const [gRes, bRes] = await Promise.all([
      fetch(`/api/groups/${id}`),
      fetch(`/api/groups/${id}/balances`),
    ])
    const gData = await gRes.json()
    const bData = await bRes.json()
    setGroup(gData)
    setBalances(bData)
    if (gData.members && !expPaidBy) {
      setExpPaidBy(session?.user?.id ?? gData.members[0]?.userId ?? "")
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchGroup()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session?.user?.id && !expPaidBy) setExpPaidBy(session.user.id)
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addExpense() {
    if (!expDesc || !expAmount || !expPaidBy) return
    setExpSaving(true)
    await fetch(`/api/groups/${id}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: expDesc,
        amount: expAmount,
        category: expCategory,
        paidById: expPaidBy,
        splitType: "EQUAL",
      }),
    })
    setShowExpense(false)
    setExpDesc(""); setExpAmount(""); setExpCategory("general")
    setExpSaving(false)
    fetchGroup()
  }

  async function addMember() {
    if (!memberEmail) return
    setMemberSaving(true)
    setMemberError("")
    const res = await fetch(`/api/groups/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: memberEmail }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMemberError(data.error)
    } else {
      setMemberEmail("")
      setShowMember(false)
      fetchGroup()
    }
    setMemberSaving(false)
  }

  async function settle() {
    if (!settleTarget) return
    setSettleSaving(true)
    await fetch(`/api/groups/${id}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toUserId: settleTarget.toUser.id,
        amount: settleTarget.amount,
        note: settleNote,
      }),
    })
    setSettleTarget(null)
    setSettleNote("")
    setSettleSaving(false)
    fetchGroup()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-400">Group not found</p>
        <Link href="/groups"><Button variant="outline" className="mt-4">Back to groups</Button></Link>
      </div>
    )
  }

  const myBalances = balances.filter(
    (b) => b.fromUser.id === session?.user?.id || b.toUser.id === session?.user?.id
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/groups">
          <button className="w-9 h-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: group.color + "33" }}
        >
          {group.emoji}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{group.name}</h1>
          {group.description && <p className="text-sm text-slate-400">{group.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowMember(true)}>
            <UserPlus className="w-4 h-4" />
            Add member
          </Button>
          <Button size="sm" onClick={() => setShowExpense(true)}>
            <Plus className="w-4 h-4" />
            Add expense
          </Button>
        </div>
      </div>

      {/* My balance summary */}
      {myBalances.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/3 p-4 mb-6">
          <p className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wide">Your balances</p>
          <div className="flex flex-wrap gap-3">
            {myBalances.map((b, i) => {
              const iOwe = b.fromUser.id === session?.user?.id
              return (
                <div key={i} className="flex items-center gap-3">
                  <Avatar className="w-7 h-7">
                    <AvatarImage src={(iOwe ? b.toUser : b.fromUser).image ?? ""} />
                    <AvatarFallback className="text-[10px]">
                      {getInitials((iOwe ? b.toUser : b.fromUser).name, (iOwe ? b.toUser : b.fromUser).email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-slate-300">
                    {iOwe ? (
                      <>You owe <span className="text-white font-medium">{b.toUser.name ?? b.toUser.email}</span></>
                    ) : (
                      <><span className="text-white font-medium">{b.fromUser.name ?? b.fromUser.email}</span> owes you</>
                    )}
                  </span>
                  <span className={`text-sm font-bold ${iOwe ? "text-rose-400" : "text-emerald-400"}`}>
                    {formatCurrency(b.amount)}
                  </span>
                  {iOwe && (
                    <Button size="sm" variant="success" onClick={() => setSettleTarget(b)}>
                      Settle up
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 mb-6 w-fit">
        {(["expenses", "balances", "members"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab
                ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {tab === "expenses" && <Receipt className="w-3 h-3 inline mr-1.5" />}
            {tab === "balances" && <TrendingUp className="w-3 h-3 inline mr-1.5" />}
            {tab === "members" && <Users className="w-3 h-3 inline mr-1.5" />}
            {tab}
          </button>
        ))}
      </div>

      {/* Expenses tab */}
      {activeTab === "expenses" && (
        <div>
          {group.expenses.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🧾</div>
              <p className="text-slate-400 mb-4">No expenses yet</p>
              <Button onClick={() => setShowExpense(true)}>
                <Plus className="w-4 h-4" />
                Add first expense
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {group.expenses.map((expense) => {
                const mySplit = expense.splits.find((s) => s.userId === session?.user?.id)
                const isPayer = expense.paidById === session?.user?.id
                const myNet = isPayer
                  ? expense.amount - (mySplit?.amount ?? 0)
                  : -(mySplit?.amount ?? 0)

                return (
                  <div
                    key={expense.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/3 hover:bg-white/5 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl flex-shrink-0">
                      {CATEGORY_ICONS[expense.category] ?? "💸"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{expense.description}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Paid by{" "}
                        <span className="text-slate-300">
                          {isPayer ? "you" : expense.paidBy.name ?? expense.paidBy.email}
                        </span>
                        {" · "}{formatDate(expense.date)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-white">{formatCurrency(expense.amount)}</p>
                      {mySplit && (
                        <p className={`text-xs font-medium mt-0.5 ${myNet >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {myNet >= 0 ? "+" : ""}{formatCurrency(myNet)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Balances tab */}
      {activeTab === "balances" && (
        <div>
          {balances.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">✅</div>
              <p className="text-slate-400">All settled up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {balances.map((b, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={b.fromUser.image ?? ""} />
                      <AvatarFallback className="text-xs">{getInitials(b.fromUser.name, b.fromUser.email)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="text-sm text-white font-medium">{b.fromUser.name ?? b.fromUser.email}</span>
                      <span className="text-sm text-slate-400"> owes </span>
                      <span className="text-sm text-white font-medium">{b.toUser.name ?? b.toUser.email}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-rose-400">{formatCurrency(b.amount)}</span>
                    {b.fromUser.id === session?.user?.id && (
                      <Button size="sm" variant="success" onClick={() => setSettleTarget(b)}>
                        Settle up
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Settlement history */}
          {group.settlements.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-400 mb-3">Settlement history</h3>
              <div className="space-y-2">
                {group.settlements.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <DollarSign className="w-3 h-3 text-emerald-400" />
                      </div>
                      <span className="text-xs text-slate-300">
                        <span className="text-white font-medium">{s.fromUser.name ?? s.fromUser.email}</span>
                        {" paid "}
                        <span className="text-white font-medium">{s.toUser.name ?? s.toUser.email}</span>
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-400">{formatCurrency(s.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members tab */}
      {activeTab === "members" && (
        <div className="space-y-3">
          {group.members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={member.user.image ?? ""} />
                <AvatarFallback>{getInitials(member.user.name, member.user.email)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{member.user.name ?? member.user.email}</p>
                <p className="text-xs text-slate-400">{member.user.email}</p>
              </div>
              <Badge variant={member.role === "ADMIN" ? "default" : "secondary"}>
                {member.role}
              </Badge>
            </div>
          ))}
          <Button variant="outline" className="w-full mt-2" onClick={() => setShowMember(true)}>
            <UserPlus className="w-4 h-4" />
            Add member
          </Button>
        </div>
      )}

      {/* Add Expense Dialog */}
      <Dialog open={showExpense} onOpenChange={setShowExpense}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="What was it for?"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Amount (e.g. 42.50)"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              min="0"
              step="0.01"
            />

            <div>
              <label className="text-xs text-slate-400 block mb-2">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setExpCategory(cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      expCategory === cat
                        ? "bg-indigo-500 text-white"
                        : "bg-white/10 text-slate-300 hover:bg-white/20"
                    }`}
                  >
                    {CATEGORY_ICONS[cat]} {cat}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-2">Paid by</label>
              <div className="flex flex-wrap gap-2">
                {group.members.map((m) => (
                  <button
                    key={m.userId}
                    onClick={() => setExpPaidBy(m.userId)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      expPaidBy === m.userId
                        ? "bg-indigo-500 text-white"
                        : "bg-white/10 text-slate-300 hover:bg-white/20"
                    }`}
                  >
                    <Avatar className="w-4 h-4">
                      <AvatarFallback className="text-[8px]">
                        {getInitials(m.user.name, m.user.email)}
                      </AvatarFallback>
                    </Avatar>
                    {m.userId === session?.user?.id ? "You" : m.user.name ?? m.user.email}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-500">Split equally among all {group.members.length} members</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowExpense(false)}>Cancel</Button>
            <Button onClick={addExpense} loading={expSaving} disabled={!expDesc || !expAmount}>
              Add Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={showMember} onOpenChange={setShowMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="email"
              placeholder="friend@email.com"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
            />
            {memberError && (
              <p className="text-xs text-rose-400">{memberError}</p>
            )}
            <p className="text-xs text-slate-500">Member must already have a SplitEase account</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowMember(false)}>Cancel</Button>
            <Button onClick={addMember} loading={memberSaving} disabled={!memberEmail}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle Up Dialog */}
      <Dialog open={!!settleTarget} onOpenChange={(o) => !o && setSettleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle Up</DialogTitle>
          </DialogHeader>
          {settleTarget && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-4 py-4">
                <Avatar>
                  <AvatarImage src={settleTarget.fromUser.image ?? ""} />
                  <AvatarFallback>{getInitials(settleTarget.fromUser.name, settleTarget.fromUser.email)}</AvatarFallback>
                </Avatar>
                <div className="text-center">
                  <p className="text-2xl font-bold text-rose-400">{formatCurrency(settleTarget.amount)}</p>
                  <p className="text-xs text-slate-400">to {settleTarget.toUser.name ?? settleTarget.toUser.email}</p>
                </div>
                <Avatar>
                  <AvatarImage src={settleTarget.toUser.image ?? ""} />
                  <AvatarFallback>{getInitials(settleTarget.toUser.name, settleTarget.toUser.email)}</AvatarFallback>
                </Avatar>
              </div>
              <Input
                placeholder="Add a note (optional)"
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettleTarget(null)}>Cancel</Button>
            <Button variant="success" onClick={settle} loading={settleSaving}>
              Confirm Settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
