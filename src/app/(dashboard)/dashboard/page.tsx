import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { buildBalanceMap, getUserTotals, centsToDisplay } from "@/lib/balance"
import Link from "next/link"
import { Plus, TrendingUp, TrendingDown, Users, Receipt, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatCurrency, formatRelativeTime, getInitials, CATEGORY_ICONS } from "@/lib/utils"

async function getDashboardData(userId: string) {
  const [groups, expenses, settlements] = await Promise.all([
    prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: true } },
        expenses: {
          include: { splits: true, paidBy: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.expense.findMany({
      where: {
        group: { members: { some: { userId } } },
      },
      include: {
        paidBy: true,
        splits: { include: { user: true } },
        group: true,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.settlement.findMany({
      where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      include: { fromUser: true, toUser: true, group: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ])

  // Calculate net balances using the shared balance engine
  const [allExpenses, allSettlements] = await Promise.all([
    prisma.expense.findMany({
      where: { group: { members: { some: { userId } } } },
      include: { splits: true },
    }),
    prisma.settlement.findMany({
      where: { group: { members: { some: { userId } } } },
    }),
  ])

  const balanceCents = buildBalanceMap(allExpenses, allSettlements, true)
  const { oweCents, owedCents } = getUserTotals(balanceCents, userId)
  const totalOwed = centsToDisplay(owedCents)
  const totalOwe = centsToDisplay(oweCents)

  return { groups, expenses, settlements, totalOwed, totalOwe }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const { groups, expenses, totalOwed, totalOwe } = await getDashboardData(session.user.id)

  const netBalance = totalOwed - totalOwe

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Hey, {session.user.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-slate-400 text-sm mt-1">Here&apos;s your expense overview</p>
        </div>
        <Link href="/groups/new">
          <Button size="sm">
            <Plus className="w-4 h-4" />
            New Group
          </Button>
        </Link>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className={`relative overflow-hidden ${netBalance >= 0 ? "border-emerald-500/20" : "border-rose-500/20"}`}>
          <div className={`absolute inset-0 ${netBalance >= 0 ? "bg-emerald-500/5" : "bg-rose-500/5"}`} />
          <CardContent className="pt-6">
            <p className="text-xs text-slate-400 mb-1">Net balance</p>
            <p className={`text-3xl font-bold ${netBalance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {netBalance >= 0 ? "+" : ""}{formatCurrency(netBalance)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {netBalance >= 0 ? "You're in the clear!" : "Outstanding balance"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-slate-400">You&apos;re owed</p>
            </div>
            <p className="text-3xl font-bold text-emerald-400">+{formatCurrency(totalOwed)}</p>
            <p className="text-xs text-slate-500 mt-1">from friends</p>
          </CardContent>
        </Card>

        <Card className="border-rose-500/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-rose-400" />
              <p className="text-xs text-slate-400">You owe</p>
            </div>
            <p className="text-3xl font-bold text-rose-400">-{formatCurrency(totalOwe)}</p>
            <p className="text-xs text-slate-500 mt-1">to others</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Groups */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Your Groups</h2>
            <Link href="/groups" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {groups.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-slate-400 text-sm mb-4">No groups yet</p>
              <Link href="/groups/new">
                <Button size="sm" variant="outline">Create your first group</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`}>
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-white/5 bg-white/3 hover:bg-white/8 hover:border-white/10 transition-all cursor-pointer">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ backgroundColor: group.color + "33" }}
                    >
                      {group.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{group.name}</p>
                      <p className="text-xs text-slate-400">
                        {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
          </div>

          {expenses.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-4xl mb-3">📝</div>
              <p className="text-slate-400 text-sm">No expenses yet. Add one to get started!</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => {
                const mySplit = expense.splits.find((s) => s.userId === session.user!.id)
                const isPayer = expense.paidById === session.user!.id
                // DB stores amounts in cents; divide by 100 for display
                const expenseDollars = expense.amount / 100
                const mySplitDollars = (mySplit?.amount ?? 0) / 100
                const myAmount = isPayer
                  ? expenseDollars - mySplitDollars
                  : -mySplitDollars

                return (
                  <div
                    key={expense.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/3 hover:bg-white/5 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-lg flex-shrink-0">
                      {CATEGORY_ICONS[expense.category] ?? "💸"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{expense.description}</p>
                      <p className="text-xs text-slate-400">
                        {expense.paidBy.name ?? expense.paidBy.email} • {expense.group.name} • {formatRelativeTime(expense.createdAt)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${myAmount >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {myAmount >= 0 ? "+" : ""}{formatCurrency(myAmount)}
                      </p>
                      <p className="text-xs text-slate-500">{formatCurrency(expenseDollars)} total</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
