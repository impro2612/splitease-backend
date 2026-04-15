"use client"

import { useState, useEffect } from "react"
import { Search, UserPlus, Check, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { getInitials } from "@/lib/utils"

type User = { id: string; name: string | null; email: string; image: string | null }
type FriendRequest = { id: string; requester?: User; addressee?: User; status: string; direction: "sent" | "received" }

export default function FriendsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [friends, setFriends] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [sendingTo, setSendingTo] = useState<string | null>(null)

  async function searchUsers(q: string) {
    if (q.length < 2) { setSearchResults([]); return }
    setLoading(true)
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
    const data = await res.json()
    setSearchResults(data)
    setLoading(false)
  }

  async function fetchFriends() {
    const res = await fetch("/api/friends")
    if (res.ok) {
      const data = await res.json()
      setFriends(data)
    }
  }

  useEffect(() => { fetchFriends() }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchUsers(searchQuery), 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  async function sendRequest(userId: string) {
    setSendingTo(userId)
    await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresseeId: userId }),
    })
    setSendingTo(null)
    fetchFriends()
    setSearchQuery("")
    setSearchResults([])
  }

  async function respondToRequest(requestId: string, action: "accept" | "reject") {
    await fetch(`/api/friends/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    fetchFriends()
  }

  const accepted = friends.filter((f) => f.status === "ACCEPTED")
  const pending = friends.filter((f) => f.status === "PENDING" && f.direction === "received")
  const sent = friends.filter((f) => f.status === "PENDING" && f.direction === "sent")

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Friends</h1>
        <p className="text-slate-400 text-sm mt-1">Manage your friends and requests</p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <label className="text-sm font-medium text-slate-300 block mb-2">Add a friend</label>
        <div className="relative">
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<Search className="w-4 h-4" />}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="mt-2 rounded-xl border border-white/10 bg-slate-900 overflow-hidden shadow-xl">
            {searchResults.map((user) => {
              const alreadyFriend = friends.some(
                (f) => f.requester?.id === user.id || f.addressee?.id === user.id
              )
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={user.image ?? ""} />
                    <AvatarFallback className="text-xs">{getInitials(user.name, user.email)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{user.name ?? user.email}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                  {alreadyFriend ? (
                    <Badge variant="secondary">Added</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => sendRequest(user.id)}
                      loading={sendingTo === user.id}
                    >
                      <UserPlus className="w-3 h-3" />
                      Add
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
            Friend requests
            <span className="bg-indigo-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pending.length}</span>
          </h2>
          <div className="space-y-2">
            {pending.map((req) => {
              const user = req.requester!
              return (
                <div key={req.id} className="flex items-center gap-3 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                  <Avatar>
                    <AvatarImage src={user.image ?? ""} />
                    <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{user.name ?? user.email}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="success" onClick={() => respondToRequest(req.id, "accept")}>
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="destructive" onClick={() => respondToRequest(req.id, "reject")}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">
          {accepted.length} friend{accepted.length !== 1 ? "s" : ""}
        </h2>
        {accepted.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-white/5 bg-white/3">
            <div className="text-4xl mb-3">👋</div>
            <p className="text-slate-400 text-sm">No friends yet. Search above to add some!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accepted.map((req) => {
              const user = req.direction === "sent" ? req.addressee! : req.requester!
              return (
                <div key={req.id} className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/3">
                  <Avatar>
                    <AvatarImage src={user.image ?? ""} />
                    <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-white">{user.name ?? user.email}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Sent requests */}
        {sent.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs text-slate-500 mb-2">Pending sent requests</h3>
            {sent.map((req) => {
              const user = req.addressee!
              return (
                <div key={req.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/3 mb-2">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs">{getInitials(user.name, user.email)}</AvatarFallback>
                  </Avatar>
                  <p className="text-sm text-slate-300 flex-1">{user.name ?? user.email}</p>
                  <Badge variant="warning">Pending</Badge>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
