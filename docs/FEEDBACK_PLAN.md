# Feedback plan — doctor portal, RBAC, agent fixes

Source: product feedback (user story full flow, per-doctor login, per-doctor dashboard, agent fixes,
doctor→doctor referral, role-wise authorization, doctor prompts via chatbot + admin approval, per-language
test videos, pain follow-up from last call, medication adherence, severity-gated booking + doctor cancel).

## Current state (what already exists)
- Supabase auth; one tenant per owner (`tenants.auth_user_id`). `tenant_members` (v16) has roles but nothing
  reads them except `getCurrentMembership`. Every `/api/admin/*` route is owner-only (RLS cookie client).
- `providers` (doctors) exist with an optional `user_id` — no login flow. Appointments, follow-up tasks,
  alerts, call summaries, learnings, emotion engine all exist.
- Agent books on request: `book_appointment` has no severity gate. No medication model. The agent does not
  read the previous call's pain report.

## Work items (each ships with tests)

| # | Item | Design |
|---|------|--------|
| 1 | **Role-based authorization** | `lib/auth/permissions.ts` (role → permission matrix, path rules), `lib/auth/access.ts` (`requireAccess(permission)` → db + clientId + role + providerId). Roles: `hospital_admin` (all), `care_coordinator` (patients/appointments/alerts), `auditor` (read-only), `clinician` (doctor portal only, own patients). Admin shell filters nav + shows a forbidden panel; server routes enforce. Patients/appointments/alerts/providers routes switched to `requireAccess`. |
| 2 | **Doctor-wise login** | `POST /api/admin/team` creates a Supabase user (generated temp password, shown once), `tenant_members` row (`clinician`), links `providers.user_id`. Login redirects by role (`clinician` → `/doctor`). `/doctor` is protected in the proxy. Temp-password banner + change-password. |
| 3 | **Doctor dashboard** (`/doctor`) | Overview (today, alerts, adherence risks), My patients, Patient detail (calls, pain history, meds, adherence), Appointments (ranked by severity, cancel), Referrals, Assistant (chatbot). All APIs under `/api/doctor/*`, scoped to the doctor's own provider id. |
| 4 | **Doctor → doctor referral** | `referrals` table. Doctor refers a patient (reason, urgency) to another doctor; target accepts/declines (note); accepting can book + reassigns `primaryProviderId`. Admin sees all. |
| 5 | **Doctor chatbot + admin approval** | Doctor chats; the LLM turns the request into a clean, safe agent instruction ("proposal"). Doctor submits → `agent_instruction_requests` (pending). Admin approves/rejects at `/admin/approvals`. Only **approved** instructions reach the call prompt (patient-scoped or doctor-scoped). |
| 6 | **Pain follow-up from last call** | Call summary extracts `painReported` (location/severity). `lib/agent/care-plan.ts` builds a "LAST CALL" block (age, pain, concerns) and instructs the agent to open by asking about that pain. |
| 7 | **Medication adherence** | `medications` + `medication_adherence` tables; doctor prescribes; agent gets the active list, asks per medicine, records via `record_medication_adherence` tool; summary extraction backfills; doctor sees adherence % and missed-dose streaks; alert on repeated misses. |
| 8 | **Book only if genuinely serious** | `lib/agent/triage.ts` deterministic gate. `book_appointment` requires `severity` + `clinicalReason`; routine requests are declined, a low-priority callback alert is raised instead; doctor-prescribed follow-ups bypass the gate. Appointments store `severity`/`priority_score`. |
| 9 | **Doctor can cancel unimportant appointments** | Doctor appointments view ranks by priority and flags "low priority"; cancel with reason (own appointments only), reminders removed, waitlist backfilled, patient told via follow-up call task. |
| 10 | **User-story flow + per-language tests** | `docs/USER_STORY_FLOW.md` end-to-end story + automated flow test; `docs/LANGUAGE_TEST_SCRIPTS.md` English / Hinglish / Hindi scripts + automated prompt/guard tests. (Videos must be recorded by a person against a live deployment — scripts + shot list provided.) |

## Data model — `sql/migration_v37.sql`
`patients.primaryProviderId`; `appointments.severity/severity_reason/priority_score/cancelled_by_*`;
`medications`; `medication_adherence`; `referrals`; `agent_instruction_requests`. RLS owner policies; doctor
access always goes through server routes (service role + explicit scoping), never direct from the browser.

## Order of work
1 migration → 2 auth lib + tests → 3 team/login + route conversion → 4 agent (care-plan, triage, meds, pain)
→ 5 doctor APIs → 6 doctor UI → 7 referrals + approvals → 8 docs + flow tests → 9 typecheck/lint/test/build.
