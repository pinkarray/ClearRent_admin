# ClearRent Admin Dashboard

A Next.js admin dashboard for the ClearRent platform. Connects to the same Firebase backend as the Flutter mobile app.

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** with dark/light/system theme
- **Firebase** (Firestore + Auth)
- **Recharts** (for analytics — coming soon)
- **Lucide React** (icons)
- **Deployed on Vercel**

## Getting Started

### 1. Prerequisites

- Node.js 18+ installed
- Your ClearRent Firebase project credentials

### 2. Clone / create the project

Copy this entire `clearrent-admin` folder into a new directory on your machine, then open it in VS Code.

### 3. Install dependencies

```bash
npm install
```

### 4. Configure Firebase

Open `.env.local` and fill in your Firebase config values. You can find these in:

**Firebase Console → Project Settings → General → Your apps → Web app**

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=clearrent-xxxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=clearrent-xxxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=clearrent-xxxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef

NEXT_PUBLIC_ADMIN_UID=hEKsYuKKdzLlPD0QWOP2CvAxYlq2
```

**Important:** If you haven't already added a **Web app** to your Firebase project, do it now:
1. Go to Firebase Console → Project Settings
2. Click "Add app" → Web (</> icon)
3. Register it (name: "ClearRent Admin")
4. Copy the config values into `.env.local`

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll see the login page.

Sign in with the same email/password you use for your admin account in the Flutter app.

### 6. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or connect the GitHub repo to Vercel for automatic deployments.

**Don't forget** to add your `.env.local` variables in Vercel's project settings → Environment Variables.

## Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout (providers, theme)
│   ├── page.tsx            # Root redirect (→ /dashboard or /login)
│   ├── globals.css         # Tailwind + ClearRent brand styles
│   ├── login/
│   │   └── page.tsx        # Admin login page
│   └── dashboard/
│       ├── layout.tsx      # Dashboard shell (sidebar + main content)
│       ├── page.tsx        # Dashboard home (stats + activity)
│       ├── users/          # User management (coming next)
│       ├── verifications/  # Verification center
│       ├── payments/       # Payment management
│       ├── payouts/        # Agent payouts
│       ├── properties/     # Property management
│       ├── issues/         # Issues & disputes
│       ├── analytics/      # Revenue & growth charts
│       ├── announcements/  # System announcements
│       └── settings/       # Admin settings
├── components/
│   ├── layout/
│   │   └── dashboard-shell.tsx  # Sidebar + nav + theme switcher
│   ├── ui/                 # Reusable UI components
│   └── dashboard/          # Dashboard-specific components
├── hooks/
│   └── use-stats.ts        # Live Firestore dashboard data
├── lib/
│   ├── firebase.ts         # Firebase config + initialization
│   ├── auth-context.tsx    # Auth provider + admin gate
│   └── utils.ts            # Utility functions
└── types/                  # TypeScript type definitions
```

## Features (Phase 1 — Current)

- [x] Firebase Auth with admin-only access gate
- [x] Dashboard home with live Firestore stats
- [x] Real-time pending verifications & open issues counters
- [x] Recent activity feed
- [x] Quick action navigation
- [x] Dark / Light / System theme
- [x] Responsive sidebar with collapse
- [x] Mobile-friendly layout

## Coming Next (Phase 2+)

- [ ] User management table with search & filters
- [ ] Verification center with document viewer
- [ ] Payment verification & management
- [ ] Agent payout management
- [ ] Property overview & health dashboard
- [ ] Issues & dispute resolution
- [ ] Revenue & growth analytics with charts
- [ ] System announcements
- [ ] Admin settings
