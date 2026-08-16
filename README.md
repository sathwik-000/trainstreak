# TrainStreak

**Don’t break the streak.**

TrainStreak is a mobile-first workout consistency app focused on one fast loop:

**Open → See calendar → Tap today → Mark workout → Streak updates → Keep going.**

## Stack

- Node.js 22+
- Built-in `node:sqlite` for persistent SQLite storage
- Vanilla JavaScript SPA for a fast dependency-free client
- Responsive CSS with dark-first premium fitness UI
- Installable PWA manifest

## Run

```bash
node server/index.js
```

Open `http://localhost:4000`.

The app creates `data/trainstreak.db` automatically. No account is required.

## Included

- First-launch onboarding with weekly goal
- One-tap today workout logging
- Duplicate and future-date protection
- Interactive month calendar with previous/next navigation
- Past-date editing, workout removal, and planned rest days
- Schedule-aware streak calculations
- Current/longest streak, weekly/monthly counts, consistency
- Monthly bars, weekly consistency, workout-type breakdown, 365-day heatmap
- Automatic achievements and celebratory unlock modal
- 50 motivational messages
- Weekly and monthly goals
- Schedule, week-start, reminder, theme, export, privacy/about, and reset settings
- SQLite persistence across refreshes and server restarts
- Optional browser reminder notification (once per day, when enabled and permission is granted)
- Useful empty/loading/error states
- Mobile bottom navigation and large touch targets

## Data model

The SQLite database stores settings, unique workout records keyed by date, rest days, schedule, and achievement unlock state.

## Clean first launch

The packaged database is reset to a clean state so the first run shows onboarding.

## Multi-user upgrade

TrainStreak now gives each browser its own anonymous user profile automatically. No signup is required. A secure random HttpOnly cookie (`ts_user`) identifies the browser, and workouts, goals, settings, schedules, and achievements are stored under that user ID.

This prevents two different browsers/devices from seeing each other's TrainStreak data.

Note: the current free Render web-service filesystem is not persistent, so for permanent cloud data storage the app should be connected to a persistent database such as Render Postgres. Render currently offers a free Postgres option with a 30-day lifetime; paid Postgres removes that expiration and supports persistent relational storage. https://render.com/docs/free
