import type { Metadata } from "next"
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage"

export const metadata: Metadata = { title: "Delete your account — SplitIT" }

// Public account-deletion page required by Google Play's Data safety form and Apple's
// account-deletion guideline. Deletion itself happens in the app or by email request.
const SECTIONS: LegalSection[] = [
  {
    heading: "Delete your account in the app",
    body: [[
      "Open SplitIT and go to the More tab, then Profile.",
      "Scroll to the bottom and tap Delete account.",
      "Confirm. Your account is deleted immediately and you are signed out.",
    ]],
  },
  {
    heading: "Can't open the app?",
    body: [
      "Email support.splitit@gmail.com from the address you signed up with, with the subject \"Delete my account\". We will confirm the request by replying to that address and delete the account within 7 days.",
    ],
  },
  {
    heading: "What gets deleted",
    body: [[
      "Your name, email, phone number, profile photo, password and sign-in links (Google / Apple). You can no longer sign in.",
      "Your friends list, direct chat messages, blocks, Borrow Book entries, trips, Spend Diary, imported bank transactions, budgets, push-notification tokens and sessions.",
      "Groups where you were the only member, including their expenses.",
    ]],
  },
  {
    heading: "What stays, and why",
    body: [
      "Expenses, splits and settlements in groups you shared with other people stay, because they are part of those people's balances too. Your name on them is replaced with \"Deleted user\", and your messages in group chats are removed.",
      "Server logs (IP address, time of request) are kept for up to 30 days for security.",
    ],
  },
  {
    heading: "Subscriptions",
    body: ["Deleting your account does not cancel a SplitIT Plus subscription. Cancel it in the App Store or Google Play subscriptions settings."],
  },
]

export default function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your account"
      updated="9 November 2026"
      intro="You can delete your SplitIT account and its data at any time. This page explains how, and exactly what is removed."
      sections={SECTIONS}
    />
  )
}
