"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, X } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GROUP_EMOJIS, GROUP_COLORS } from "@/lib/utils"

export default function NewGroupPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [emoji, setEmoji] = useState("💰")
  const [color, setColor] = useState("#6366f1")
  const [memberEmail, setMemberEmail] = useState("")
  const [members, setMembers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  function addMember() {
    const email = memberEmail.trim()
    if (!email || members.includes(email)) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email")
      return
    }
    setMembers([...members, email])
    setMemberEmail("")
    setError("")
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Group name is required")
      return
    }
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, emoji, color }),
      })

      const group = await res.json()
      if (!res.ok) {
        setError(group.error)
        setLoading(false)
        return
      }

      // Add members
      for (const email of members) {
        await fetch(`/api/groups/${group.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        })
      }

      router.push(`/groups/${group.id}`)
    } catch {
      setError("Something went wrong")
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/groups">
          <button className="w-9 h-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Create Group</h1>
          <p className="text-slate-400 text-sm">Set up a new expense group</p>
        </div>
      </div>

      {/* Preview */}
      <div className="flex items-center gap-4 p-5 rounded-2xl border border-white/10 bg-white/3 mb-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
          style={{ backgroundColor: color + "33" }}
        >
          {emoji}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{name || "Group name"}</h3>
          <p className="text-sm text-slate-400">{description || "No description"}</p>
        </div>
      </div>

      {/* Group details */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">Group name *</label>
          <Input
            placeholder="e.g. NYC Trip, Apartment, Team Lunch"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300 block mb-2">Description (optional)</label>
          <Input
            placeholder="What's this group for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Emoji picker */}
      <div className="mb-6">
        <label className="text-sm font-medium text-slate-300 block mb-2">Icon</label>
        <div className="flex flex-wrap gap-2">
          {GROUP_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all ${
                emoji === e
                  ? "bg-indigo-500/30 border-2 border-indigo-500 scale-110"
                  : "bg-white/5 border border-white/10 hover:bg-white/10"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker */}
      <div className="mb-6">
        <label className="text-sm font-medium text-slate-300 block mb-2">Color</label>
        <div className="flex flex-wrap gap-2">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-lg transition-all ${
                color === c ? "scale-125 ring-2 ring-white/50 ring-offset-2 ring-offset-slate-900" : "hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Add members */}
      <div className="mb-6">
        <label className="text-sm font-medium text-slate-300 block mb-2">Invite members</label>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="friend@email.com"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
          />
          <Button variant="outline" onClick={addMember}>
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-1">Members must already have an account</p>

        {members.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {members.map((email) => (
              <div
                key={email}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-sm text-indigo-300"
              >
                {email}
                <button
                  onClick={() => setMembers(members.filter((m) => m !== email))}
                  className="text-indigo-400 hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-400 mb-4">
          {error}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={handleCreate}
        loading={loading}
        disabled={!name.trim()}
      >
        Create Group
      </Button>
    </div>
  )
}
