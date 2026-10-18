import type { Metadata } from "next"
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage"

export const metadata: Metadata = { title: "Privacy Policy — SplitIT" }

const SECTIONS: LegalSection[] = [
  {
    heading: "Information you give us",
    body: [[
      "Account details: your name, email address, phone number (optional) and profile photo. If you sign in with Google or Apple, we receive your name and email from them; we never see your Google or Apple password.",
      "What you create in SplitIT: groups, expenses, splits, settlements, IOUs in Borrow Book, trips and budgets, Spend Diary entries, group notes, reactions and chat messages.",
      "Locations you type for a group (for example \"Manali\"), used to place the group on your Timeline map.",
      "Bank statements you choose to import into My Spending, and the password if the PDF is protected.",
    ]],
  },
  {
    heading: "Information collected automatically",
    body: [[
      "A push-notification token for your device, so we can send you alerts.",
      "Basic technical data our servers log when the app talks to them (IP address, time of request, errors), used for security and fixing problems.",
      "Your subscription status (for example, whether SplitIT Plus is active and until when). We never receive your card or UPI details; payments are handled by Apple or Google.",
    ]],
  },
  {
    heading: "Features that use sensitive phone data",
    body: [[
      "Contacts (only if you tap Sync Contacts): phone numbers from your contacts are sent to our server only to check which of your contacts already use SplitIT. They are not stored, and we never message your contacts.",
      "SMS (Android only, only if you turn on Track Expense for a group): payment messages from your bank are read and parsed on your phone. Nothing is sent to us unless you approve a detected payment and add it as an expense.",
      "Bank statements: an imported PDF is read by our statement service to extract transactions and is then discarded. Only the extracted transactions are saved, and only you can see them. Your bank login is never needed.",
    ]],
  },
  {
    heading: "How we use your information",
    body: [[
      "To run SplitIT: calculate balances, show your groups and history, sync between your devices and send the notifications you allow.",
      "To sort your own transactions into categories and write your spending insights. Transaction descriptions and amounts may be processed by Google's Gemini AI service for this; they are not used to identify you.",
      "To keep the service secure and prevent abuse (for example, rate limits and fraud checks).",
      "To manage your free trial and SplitIT Plus subscription.",
    ], "We do not sell your personal data, and we do not use it for advertising."],
  },
  {
    heading: "Who can see your information",
    body: [[
      "People in your groups see your name, photo and the expenses and settlements in those groups.",
      "Friends see your name, email, photo, chats you send them and IOUs you record with them. People who search for you can find you by name, email or phone number.",
      "Your My Spending data, Spend Diary, trips and Plus status are visible only to you.",
    ]],
  },
  {
    heading: "Service providers we use",
    body: [
      "We share data only with providers that help us run SplitIT, and only what each one needs:",
      [
        "Vercel (app servers) and Turso (database), hosted in India (Mumbai region).",
        "Pusher (real-time updates) and Expo with Apple/Google push services (notifications).",
        "Google (Sign in with Google, Gemini AI insights) and Apple (Sign in with Apple).",
        "Apple App Store, Google Play and RevenueCat (subscriptions and purchase status).",
        "OpenStreetMap services (turning a typed place name into a map location, and map tiles).",
        "Google Gmail (sending password-reset codes).",
      ],
    ],
  },
  {
    heading: "Security",
    body: ["All data travels over encrypted connections (TLS). Passwords are stored only as secure hashes. Chat messages are encrypted at rest; they are not end-to-end encrypted, so our systems could technically access them, but we do not read them. No system is perfectly secure, so please use a strong password and keep your phone locked."],
  },
  {
    heading: "How long we keep data",
    body: ["We keep your data while your account is active. You can delete your account at any time in Profile & settings → Delete Account. Your personal data, chats, IOUs, personal spending data, trips and diary are deleted. Expenses you shared in groups stay for the other members so their balances remain correct, but your name is replaced with \"Deleted user\". Backups are cleared within 30 days."],
  },
  {
    heading: "Your choices and rights",
    body: [[
      "See and edit your profile in the app, and export group statements as PDF.",
      "Turn notifications, contact sync and Track Expense on or off at any time.",
      "Delete your account from the app, or email us to request a copy or correction of your data.",
      "Withdraw consent for optional features at any time. We will respond to requests within 30 days, in line with India's Digital Personal Data Protection Act, 2023 and other laws that apply to you.",
    ]],
  },
  {
    heading: "Children",
    body: ["SplitIT is not meant for children under 13, and we do not knowingly collect their data. If you believe a child has created an account, contact us and we will delete it."],
  },
  {
    heading: "Changes to this policy",
    body: ["If we make important changes, we will tell you in the app before they take effect. The date at the top shows the latest version."],
  },
  {
    heading: "Contact",
    body: ["Questions, requests or complaints about privacy: support.splitit@gmail.com"],
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="19 October 2026"
      intro="SplitIT helps you split shared expenses with friends and keep track of your own spending. This policy explains what information the SplitIT apps and website collect, why, and the choices you have."
      sections={SECTIONS}
    />
  )
}
