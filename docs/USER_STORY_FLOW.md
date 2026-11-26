# User story — the full flow

One patient, one doctor, one hospital admin, from setup to the next call.
Every step below is exercised by `__tests__/e2e/doctor-user-story.test.ts` (it runs the real route handlers and agent tools).

## Cast
| Who | Login | Lands on |
|---|---|---|
| **Meera** — hospital admin (the account owner) | email + password | `/admin` |
| **Dr. Anita Rao** — general physician | her own email + a temporary password Meera gives her | `/doctor` |
| **Dr. Bhavesh Shah** — cardiologist | his own login | `/doctor` |
| **Asha Verma** — patient, recovering after a knee operation | none — she is phoned | — |

## The story

1. **Meera adds the doctors and gives each a login** — *Team & Logins → Doctors without a login → Create login*.
   The page shows a one-time temporary password; Meera passes it to Dr. Rao privately. (Roles: hospital admin, care coordinator,
   auditor (read-only), doctor — see [Roles](#roles).)
2. **Dr. Rao signs in.** The login page sends her to `/doctor` (not the admin dashboard) and asks her to choose her own password first.
3. **Meera assigns Asha to Dr. Rao** — *Patients → edit → Primary doctor*. Asha now appears in Dr. Rao's *My patients*, and in nobody else's.
4. **Dr. Rao prescribes** Metformin 500 mg, twice a day — *My patients → Asha → Medication → + Prescribe*.
5. **The agent calls Asha.** Before it speaks, the prompt carries a **care plan** (`lib/agent/care-plan.ts`):
   * *Pain from the last call* — "last call (3 days ago): pain in the lower back, about 6/10, worse at night. **Start by asking how it is now.**"
   * *Medicines* — "Metformin 500 mg, twice a day — not asked yet. Ask one at a time; record the answer."
   * *Doctor instructions* — only ones an admin approved (step 10).
6. **Asha answers.** The agent asks about the pain first, then about the medicine; when Asha says she forgot the tablet it calls
   `record_medication_adherence(missed)`. Two misses in a row → a **medication alert** for Dr. Rao (*Today → Medication not being taken*).
7. **Asha asks for an appointment.**
   * *"Can I get a check-up sometime next week?"* — **not booked.** The agent says the care team will arrange it, and staff see a
     low-priority "Appointment requested (routine)" alert.
   * *"The pain is unbearable and my leg is swollen."* — **booked.** The agent must rate the severity; the server checks it against what
     Asha actually said, the emotion engine's pain reading, her risk level and the last call (`lib/agent/triage.ts`). The visit is stored
     with its severity and a priority score.
8. **Dr. Rao's calendar ranks the visits.** *Appointments* shows each with severity and score; a routine visit sharing a day with a more
   important one is flagged **"low priority — consider cancelling"**. She cancels it (reason required, patient texted, reminder calls removed,
   slot offered to the waitlist). She can't cancel another doctor's visits.
9. **Dr. Rao refers Asha to Dr. Shah** (*patient page → Refer to a doctor*, urgency: urgent). Dr. Shah sees it under *Referrals*, accepts, and
   Asha now appears in his patient list with her history.
10. **Dr. Rao instructs the agent** — *Agent assistant*: "check the stitches each call". The assistant turns it into a clean instruction
    (and refuses diagnosing / prescribing / dose changes / attempts to rewrite the agent's rules). She submits it.
    **Nothing changes yet.** Meera sees it under *Doctor Requests* and approves (or rejects with a reason).
11. **Next call:** the care plan now includes the approved instruction, last call's pain (updated from the previous call's summary) and the
    latest medicine answers.

## Roles
| Role | Can | Cannot |
|---|---|---|
| Hospital admin | everything, incl. team logins, doctor-request approvals, agent builder, settings | — |
| Care coordinator | patients, appointments, alerts, call history, insights | team, approvals, agents, settings, doctor profiles |
| Auditor | read-only view of patients, appointments, alerts, calls, insights | any change |
| Doctor | `/doctor` only: own patients, own calendar, own referrals, assistant | every admin page and API; other doctors' patients (a 404) |

The menu hides what a role can't use, but the **API routes are the enforcement** (`lib/auth/access.ts`'s `requireAccess`,
`__tests__/auth/route-guards.test.ts` signs in as each role and calls the real handlers).

## Setup checklist
1. Run `sql/migration_v37.sql` in the Supabase SQL editor (adds `patients.primaryProviderId`, appointment severity columns, `medications`,
   `medication_adherence`, `referrals`, `agent_instruction_requests`). The app degrades gracefully without it (no severity, no doctor portal data) but the new features need it.
2. In **Agent Builder**, enable the tools the agent should use: `book_appointment` (+ the other appointment tools) and `record_medication_adherence`.
3. Create doctors under *Staff*, give them logins under *Team & Logins*, assign patients.
