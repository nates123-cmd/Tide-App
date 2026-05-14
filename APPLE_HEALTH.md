# Apple Health → Tide (Shortcut recipe)

The `health-ingest` edge function accepts a batch of workouts from any source. The cleanest path on iOS is a Shortcut you run on-demand or via automation ("When workout ends").

## 1. Deploy the edge function

In Supabase Dashboard → Edge Functions → Deploy a new function. Name **`health-ingest`**, Verify JWT **off**, paste the contents of `supabase/functions/health-ingest/index.ts`.

The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or falls back to `SUPABASE_ANON_KEY`) from the function's environment — Supabase auto-populates these for you.

## 2. Build the Shortcut

iOS Shortcuts app → **+** → New shortcut → name it **"Sync workouts to Tide"**.

Steps:

1. **Find Workouts** action (Health → Find Workouts).
   - Sort by: Start Date · Order: Latest First
   - Limit: 30
   - Filter (optional): Start Date is within the last 1 days

2. **Repeat with Each** action with the workouts list. Inside the loop:

3. **Dictionary** action — give it these key/value pairs (values come from "Repeat Item"):
   ```
   external_id     ← Repeat Item · UUID
   type            ← Repeat Item · Workout Activity Type
   start           ← Repeat Item · Start Date (formatted as ISO 8601)
   end             ← Repeat Item · End Date (formatted as ISO 8601)
   duration_min    ← Repeat Item · Duration (in minutes)
   distance_m      ← Repeat Item · Distance (in meters)
   energy_kcal     ← Repeat Item · Active Energy (in kilocalories)
   avg_hr          ← Repeat Item · Average Heart Rate
   ```
   To convert Start/End to ISO 8601: use the **Format Date** action with custom format `yyyy-MM-dd'T'HH:mm:ss'Z'` against the workout's Start Date / End Date.

4. **Add to Variable** (Variable name: `workouts_list`) — append the dictionary from step 3 to a list variable.

End the repeat.

5. **Dictionary** action — outer payload:
   ```
   workouts  ←  workouts_list
   ```

6. **Get Contents of URL** action:
   - URL: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/health-ingest`
   - Method: POST
   - Headers:
     - `apikey`: your Supabase anon key (same value the app uses, `SB_KEY` in index.html)
     - `Authorization`: `Bearer ` followed by the same anon key
     - `Content-Type`: `application/json`
   - Request Body: JSON → use the outer dictionary from step 5

7. **Show Notification** (optional): the response is `{ "inserted": N, "skipped": M }` — show it so you can see what landed.

## 3. (Optional) Automate it

Shortcuts → **Automation** tab → + → **When a workout ends** → run "Sync workouts to Tide" → Run Immediately (no confirmation). Now every time you finish a workout in Apple Watch / Apple Health, it shows up in Tide's Train tab a few seconds later.

You can also run the Shortcut manually any time — the edge function dedupes by HealthKit UUID, so running it 10 times in a row only writes a workout once.

## What lands in Tide

Each workout becomes a `tide_activities` row:

- `category` = `cardio` / `strength` / `recovery` based on HealthKit type (Running/Cycling/Walking/etc → cardio; FunctionalStrengthTraining/TraditionalStrengthTraining → strength; Yoga/Pilates/Mindfulness → recovery)
- `type` = friendly name (Run / Walk / Bike / Strength / Yoga / etc.)
- `duration_min` = minutes
- `source` = `apple_health` (shows as `APPLE_HEALTH` badge on the activity card)
- `metadata` = `{ external_id, hk_type, distance_m, energy_kcal, avg_hr }`

Swipe-to-delete still works on auto-imported rows. Edit opens the same activity modal — but unless you also delete the corresponding workout from Apple Health, the Shortcut will re-import it on next run (the dedupe is by UUID).
