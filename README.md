# TrainStreak

Mobile-first workout consistency app.

## Production stack

- Node.js server
- PostgreSQL (Supabase)
- Anonymous per-browser user ID via HttpOnly cookie
- Responsive PWA UI

## Render environment variable

Set `DATABASE_URL` to the Supabase Session Pooler connection string (port 5432). Never commit it to GitHub.

## Local

```bash
npm install
DATABASE_URL=postgresql://... npm start
```

## Important

The database schema must exist before the server starts. See the Supabase SQL schema used during setup for:

- `users`
- `user_settings`
- `workouts`
- `rest_days`
- `achievements`
- `schedule`


## Performance update
Workout logging uses an optimistic UI: the Today button updates instantly and reconciles with PostgreSQL in the background. The API also avoids recalculating stats twice in the workout request.
