import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Plus, Users, Receipt, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatCurrency, getInitials, formatRelativeTime } from "@/lib/utils"

export default async function GroupsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: session.user.id } } },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
      expenses: {
        include: { splits: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { expenses: true } },
    },
    orderBy: { updatedAt: "desc" },
  })

  // Calculate balance per group for current user (DB amounts are in cents, divide by 100 for display)
  function getGroupBalance(group: typeof groups[0]) {
    let owedCents = 0
    let owesCents = 0
    for (const expense of group.expenses) {
      const mySplit = expense.splits.find((s) => s.userId === session.user!.id)
      if (!mySplit) continue
      if (expense.paidById === session.user!.id) {
        for (const split of expense.splits) {
          if (split.userId !== session.user!.id && !split.paid) owedCents += split.amount
        }
      } else if (!mySplit.paid) {
        owesCents += mySplit.amount
      }
    }
    return (owedCents - owesCents) / 100
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Groups</h1>
          <p className="text-slate-400 text-sm mt-1">{groups.length} group{groups.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/groups/new">
          <Button>
            <Plus className="w-4 h-4" />
            New Group
          </Button>
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">👥</div>
          <h2 className="text-xl font-semibold text-white mb-2">No groups yet</h2>
          <p className="text-slate-400 mb-6">Create a group to start splitting expenses with friends</p>
          <Link href="/groups/new">
            <Button>
              <Plus className="w-4 h-4" />
              Create your first group
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((group) => {
            const balance = getGroupBalance(group)
            return (
              <Link key={group.id} href={`/groups/${group.id}`}>
                <div className="rounded-2xl border border-white/10 bg-white/3 p-5 hover:bg-white/8 hover:border-white/20 transition-all cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                        style={{ backgroundColor: group.color + "33" }}
                      >
                        {group.emoji}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
                          {group.name}
                        </h3>
                        {group.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{group.description}</p>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors mt-1" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {group.members.length} members
                      </span>
                      <span className="flex items-center gap-1">
                        <Receipt className="w-3 h-3" />
                        {group._count.expenses} expenses
                      </span>
                    </div>
                    <div className={`text-sm font-semibold ${balance > 0 ? "text-emerald-400" : balance < 0 ? "text-rose-400" : "text-slate-400"}`}>
                      {balance > 0 ? `+${formatCurrency(balance)}` : balance < 0 ? formatCurrency(balance) : "settled up"}
                    </div>
                  </div>

                  {/* Members avatars */}
                  <div className="flex items-center mt-3 -space-x-2">
                    {group.members.slice(0, 5).map((m) => (
                      <Avatar key={m.id} className="w-6 h-6 border-2 border-slate-900">
                        <AvatarImage src={m.user.image ?? ""} />
                        <AvatarFallback className="text-[9px]">
                          {getInitials(m.user.name, m.user.email)}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {group.members.length > 5 && (
                      <div className="w-6 h-6 rounded-full bg-white/10 border-2 border-slate-900 flex items-center justify-center text-[9px] text-slate-400">
                        +{group.members.length - 5}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
