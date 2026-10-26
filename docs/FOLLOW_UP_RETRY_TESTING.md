# Testing follow-up retries with real calls

How to check, with real phone calls, that a follow-up retries correctly:
3 attempts per day, 1 minute apart, retrying unless a real conversation
completes the follow-up.

## Setup (once)

1. **Run the migrations** in the Supabase SQL editor, in order, if they
   haven't been run yet:
   - `sql/migration_v23.sql` (planned date/time per day, from the Follow-ups upgrade)
   - `sql/migration_v24.sql` (`call_logs."answeredBy"` for voicemail detection)
2. **`.env.local`**
   - `NEXT_PUBLIC_BASE_URL` = your ngrok HTTPS URL (step 3), not `localhost`.
     The scheduler refuses to run on a localhost URL because Twilio can't reach it.
   - Twilio credentials and number as usual.
   - Optional: `FOLLOWUP_AMD=off` turns voicemail detection off. It's on by
     default for scheduled follow-up calls and is billed per call by Twilio.
3. **Start ngrok:** `ngrok http 3000`. Copy the HTTPS URL into
   `NEXT_PUBLIC_BASE_URL`.
4. **Start the app with `npm run dev:full`.** Plain `npm run dev` does not run
   the scheduler or handle phone audio, so scheduled calls are never placed.
   On start-up you should see:
   ```
   [Scheduler] Follow-up dispatch loop started (every 30s, plus on-time wake-ups for tasks due sooner).
   ```
5. **Test patient:** use your own phone number. On a Twilio trial account it must
   be a Verified Caller ID (Twilio Console → Phone Numbers → Verified Caller
   IDs), and the country must be enabled under Voice → Settings → Geo permissions.

## Watching the database

Keep this query open in the Supabase SQL editor and re-run it between steps
(replace the patient id):

```sql
select id, status, "attemptCount", "maxAttempts", "retryDelayMinutes",
       to_timestamp("nextAttemptAt" / 1000.0) at time zone timezone as next_attempt_local,
       "lastOutcome", "claimedBy"
from follow_up_tasks
where "patientId" = '<patient id>'
order by "nextAttemptAt";

select id, status, "answeredBy", "durationMs",
       to_timestamp("startedAt" / 1000.0) as started, to_timestamp("endedAt" / 1000.0) as ended
from call_logs
where "followUpTaskId" in (select id from follow_up_tasks where "patientId" = '<patient id>')
order by "startedAt";
```

## Test 1: hang up without talking (the reported bug)

1. On the Patients page, open **Schedule** for the test patient: today, a time
   2–3 minutes from now, **Max attempts / day = 3**, **Retry after = 1 min**,
   pick an agent.
2. When the call comes, answer and **hang up straight away** without speaking.

**Terminal logs, in order** (ids and times will differ):
```
[Scheduler] Placed follow-up call CAaaaa — task <taskId>, attempt 1.
[Telephony/AMD] CallSid=CAaaaa answeredBy=human after 2100ms        (may also say unknown)
[Telephony/Status] CallSid=CAaaaa, status=completed, duration=3s
[Scheduler] task <taskId> attempt 1/3 ended (no_conversation) → retry 2/3 at <time> (59s from now).
```

**Database after attempt 1, before attempt 2:**

| Field | Expected |
|---|---|
| `status` | `scheduled` (not `needs_review`) |
| `attemptCount` | `1` (2 of 3 attempts still available) |
| `maxAttempts` | `3` |
| `lastOutcome` | `no_conversation` |
| `next_attempt_local` | about 1 minute after the call ended |
| `claimedBy` | empty |
| call_logs `status` | `completed`, with `ended` set |

**Follow-ups panel:** the day shows **Retrying**, "1 of 3 attempts made · next
try …".

3. About 1 minute after hanging up (expect a few seconds of variance, plus the
   time Twilio takes to ring), the second call arrives:
   ```
   [Scheduler] Placed follow-up call CAbbbb — task <taskId>, attempt 2.
   ```
4. Hang up again. Attempt 3 arrives about 1 minute later. Hang up again.
5. After attempt 3:
   ```
   [Scheduler] task <taskId> attempt 3/3 ended (no_conversation) — no attempts left; final action: needs_review.
   ```
   `status` = `needs_review`, `attemptCount` = `3`, and an alert says
   "All 3 attempts for the day were used without completing the follow-up
   (last result: …)". **No 4th call.**

## Test 2: don't answer

Schedule again and let it ring out. Expected: `lastOutcome` = `no-answer`,
then the same retry pattern as Test 1.

## Test 3: voicemail

Schedule again and let it go to voicemail (or reject the call so it diverts).

```
[Telephony/AMD] CallSid=CA… answeredBy=machine_start after 3800ms
[Telephony/AMD] Voicemail/machine answered CA… — hung up; the follow-up will be retried.
[Scheduler] task <taskId> attempt 1/3 ended (voicemail) → retry 2/3 at …
```
call_logs `answeredBy` = `machine_start`. Detection is Twilio's own and isn't
perfect: if it reports `human` or `unknown` for a voicemail, the transcript
still decides, and an unclear call is retried rather than completed.

## Test 4: a real conversation completes the day

Schedule again, answer, and have the full check-in conversation until the
agent wraps up. A few seconds after hanging up:
```
[Scheduler] task <taskId> attempt 1/3: follow-up completed — no more calls today.
```
`status` = `completed`, `lastOutcome` = `resolved`. **No further calls today.**
Other days in the range stay `scheduled`.

If the AI summary isn't sure the follow-up was completed (very short or
confusing call), the day is retried instead (`lastOutcome` = `outcome_unclear`).
That's intentional: an unclear call is never counted as a success.

## Test 5: do-not-contact

Answer and say clearly: "Please stop calling me." Expected: `status` =
`cancelled`, `lastOutcome` = `do_not_contact`, the patient is marked Do Not
Contact, their other scheduled days are cancelled, and no retry is made.

## Timing tolerance

A retry is placed 60–61 seconds after the previous call ended (60s delay, plus
a 0.25s wake-up margin, plus a database round trip), then Twilio takes a few
seconds to ring the phone. If the server is busy or restarting, the 30-second
poll is the fallback, so worst case is about 30 seconds late. A retry that
would land outside the calling window moves to the window's next opening.

## If something looks wrong

- **No call at all:** check the start-up log above. `NEXT_PUBLIC_BASE_URL`
  must be the ngrok URL, and the app must run with `npm run dev:full`.
- **Status stays `calling`:** the status callback didn't arrive (ngrok URL
  changed?). Within about 3–4 minutes the scheduler asks Twilio for the call's
  real status and continues; check for `[Scheduler]` lines.
- **No `[Telephony/AMD]` line:** voicemail detection is off (`FOLLOWUP_AMD=off`)
  or migration v24 isn't applied. Retries still work, using the transcript.
