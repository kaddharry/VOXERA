# VOXERA Website And SaaS Product Blueprint

## Product Vision

VOXERA should become a self-serve website and SaaS platform where businesses can buy, configure, and deploy AI phone agents for real operational work.

The core promise:

> A business owner visits VOXERA, describes their business, uploads knowledge, chooses what phone workflows the AI should handle, connects tools like phone/calendar/email/CRM, and deploys an AI voice agent that can answer calls, make calls, book appointments, follow up with customers, and escalate to staff when needed.

Example use case:

- A hospital or clinic purchases a post-surgery aftercare AI agent.
- The clinic uploads aftercare instructions, emergency escalation rules, doctor availability, and patient follow-up scripts.
- The AI agent calls patients after surgery, asks recovery questions, detects distress or risk signals, logs the conversation, sends summaries to staff, and escalates urgent cases to a nurse or doctor.

The website should not feel like a generic landing page. It should feel like a serious AI operations platform for businesses that depend on phone workflows but with latest UI/UX improvements and top notch designs

## Refined Product Idea

VOXERA is not only an AI receptionist. It should be positioned as an AI phone workforce platform.

Businesses should be able to create different types of phone agents:

- Receptionist Agent: answers inbound calls, handles FAQs, books appointments, routes calls.
- Booking Agent: manages reservations, appointments, calendars, reminders, and cancellations.
- Aftercare Agent: follows up after medical visits, surgeries, treatments, deliveries, repairs, or services.
- Support Agent: handles common support issues, order questions, refunds, complaints, and escalation.
- Sales Qualification Agent: calls leads, asks qualification questions, books meetings, and updates CRM.
- Reminder Agent: sends or makes reminders for appointments, medication, payments, documents, renewals.
- Survey Agent: collects customer satisfaction, NPS, feedback, and complaint details.

This makes VOXERA useful across hospitals, clinics, restaurants, hotels, salons, real estate, repair businesses, schools, logistics teams, and local service companies.

## Primary Website Flow

1. Visitor lands on VOXERA website.
2. Visitor selects business type or describes their business.
3. Website recommends one or more AI agent templates.
4. Visitor previews what the AI agent can do.
5. Visitor creates an account.
6. Visitor uploads business knowledge:
   - FAQs
   - service/pricing information
   - policies
   - schedules
   - scripts
   - documents/PDFs
   - escalation rules
7. Visitor configures the AI agent:
   - voice persona
   - language
   - greeting
   - working hours
   - call handling rules
   - escalation contact
   - booking rules
8. Visitor connects integrations:
   - phone number
   - calendar
   - email
   - CRM/spreadsheet
   - payment/subscription
9. Visitor tests the agent in browser.
10. Visitor purchases a plan.
11. Visitor deploys the AI agent to a real phone number.
12. Admin dashboard shows calls, bookings, escalations, confidence, CAI, emotion trends, and agent performance.

## Key Actors

- Website Visitor: learns about VOXERA and starts onboarding.
- Business Admin: configures agents, uploads knowledge, manages billing, reviews analytics.
- Business Staff: receives escalations, call summaries, bookings, and alerts.
- Caller/Customer/Patient: talks with the AI agent by phone.
- AI Agent: handles calls, uses business knowledge, invokes tools, logs activity.
- VOXERA Super Admin: monitors platform health, customer accounts, plans, usage, and failures.
- Telephony Provider: handles inbound/outbound calls and phone numbers.
- Integration Providers: calendar, email, CRM, EHR, payment, spreadsheets.

## Use Case Diagram In Text

Business Admin:

- Sign up/login.
- Describe business.
- Select business category.
- Choose AI agent template.
- Upload knowledge.
- Configure voice and greeting.
- Configure workflows.
- Connect integrations.
- Purchase subscription.
- Test AI agent.
- Deploy phone number.
- Review calls and analytics.
- Handle escalations.

Caller/Customer/Patient:

- Calls business phone number.
- Speaks to AI agent.
- Gets answers, bookings, reminders, or support.
- Requests human handoff.
- Receives confirmation by SMS/email if enabled.

AI Agent:

- Receives call context.
- Converts speech to text.
- Detects emotion/confidence.
- Retrieves business knowledge.
- Decides response policy.
- Invokes tools.
- Logs session.
- Escalates when required.
- Sends summary after call.

VOXERA Super Admin:

- Reviews tenant usage.
- Monitors failed calls/tool calls.
- Manages plans and limits.
- Audits abuse/security events.
- Views system health.

## Necessary Website And SaaS Functionality

### 1. Marketing Website

- Clear homepage explaining AI phone agents.
- Industry pages:
  - Healthcare
  - Restaurants
  - Hotels
  - Clinics
  - Salons
  - Real estate
  - Local services
  - Education
- Use case pages:
  - AI receptionist
  - Appointment booking
  - Patient aftercare
  - Lead qualification
  - Customer support
  - Reminder calls
- Pricing page.
- Demo page with simulated call flow.
- Security/compliance page.
- Contact sales page.
- FAQ page.

### 2. Business Onboarding

- Business profile wizard:
  - business name
  - industry
  - location/timezone
  - business hours
  - primary phone number
  - services offered
  - common questions
  - booking rules
  - escalation contacts
- AI recommendation engine:
  - recommends agent template based on business type
  - suggests workflows
  - suggests required integrations
- Guided setup checklist.
- Setup progress indicator.

### 3. Agent Builder

- Agent templates:
  - Receptionist
  - Booking
  - Aftercare
  - Support
  - Sales qualification
  - Reminder
  - Survey
- Voice persona:
  - gender/style
  - formal/friendly/empathetic/casual
  - language/accent later
- Greeting builder.
- Conversation tone rules.
- Human escalation rules.
- Guardrails:
  - forbidden claims
  - compliance disclaimers
  - uncertainty handling
  - emergency routing
- Agent testing console.
- Versioning:
  - draft agent
  - published agent
  - rollback to previous version

### 4. Knowledge Management

- Upload PDFs, text files, FAQs, policies, menus, pricing sheets, aftercare instructions.
- Document list view with:
  - filename
  - status
  - chunk count
  - upload date
  - last indexed date
  - owner
- Delete/re-index documents.
- Manual FAQ editor.
- Knowledge search preview.
- Source citation preview.
- Tenant-isolated knowledge base.
- Knowledge quality checks:
  - duplicate detection
  - empty document warning
  - outdated document flag
  - conflicting policy detection later

### 5. Telephony

- Buy or connect phone number.
- Inbound call routing.
- Outbound call campaigns.
- Business-hours routing.
- Human handoff routing.
- Voicemail fallback.
- Call recording setting.
- Call metadata storage:
  - caller number
  - called number
  - start time
  - end time
  - call duration
  - call status
  - escalation status

Recommended provider:

- Twilio for phone numbers, inbound/outbound calls, call transfer, SMS.
- Alternative providers later: Plivo, Telnyx.

### 6. AI Voice Pipeline

- Speech-to-text.
- Text emotion detection.
- Optional audio emotion detection.
- Confidence classification.
- RAG retrieval from tenant knowledge.
- LLM response generation.
- Tool invocation.
- Output guardrails.
- Text-to-speech.
- Session logging.
- Call summary generation.

Existing stack already supports parts of this through Deepgram, Supabase vector memory, the orchestrator, and LLM tools.

### 7. Workflow Tools

Core tools:

- Check availability.
- Create booking.
- Modify booking.
- Cancel booking.
- Send email confirmation.
- Send SMS confirmation.
- Transfer to human.
- Create support ticket.
- Update spreadsheet.
- Retrieve customer record.
- Create call summary.
- Mark follow-up required.

Healthcare/aftercare tools:

- Ask post-surgery recovery questions.
- Detect red-flag symptoms.
- Escalate urgent symptoms to nurse/doctor.
- Log patient response.
- Schedule follow-up appointment.
- Send aftercare reminder.
- Generate staff summary.

Important healthcare note:

For medical use, VOXERA must avoid diagnosis and must escalate urgent or uncertain cases. Healthcare deployments may require HIPAA-grade controls, business associate agreements, audit logs, encryption policies, and stricter data retention rules.

### 8. Admin Dashboard

Business dashboard:

- Total calls.
- Active calls.
- Missed calls.
- Resolved calls.
- Escalated calls.
- Bookings created.
- Cancellations.
- Average call duration.
- Average CAI.
- Confidence distribution.
- Emotion distribution.
- Peak call hours.
- Conversion rate.
- Revenue influenced later.

Session dashboard:

- List sessions.
- Search by caller, date, status, emotion, escalation.
- Full timeline:
  - transcript
  - emotion
  - confidence
  - CAI
  - retrieved knowledge
  - tool calls
  - escalation events
  - final summary

Agent dashboard:

- Agent status.
- Last deployed version.
- Knowledge health.
- Integration status.
- Recent failures.
- Test call button.

### 9. Billing And Plans

Plan examples:

- Starter:
  - one AI agent
  - limited minutes
  - basic knowledge upload
  - email support
- Growth:
  - multiple agents
  - higher call minutes
  - booking/calendar tools
  - analytics
  - SMS/email confirmations
- Business:
  - advanced workflows
  - multiple phone numbers
  - CRM integrations
  - staff routing
  - custom templates
- Enterprise/Healthcare:
  - compliance controls
  - audit exports
  - custom retention
  - dedicated support
  - custom integrations

Billing features:

- Stripe checkout.
- Subscription management.
- Usage-based call minute tracking.
- Plan limits.
- Invoices.
- Failed payment handling.
- Trial period.

### 10. Security And Compliance

- Server-side tenant resolution.
- Row-level security.
- Audit logs.
- Encrypted secrets.
- Role-based access control:
  - owner
  - admin
  - staff
  - viewer
- Call recording consent settings.
- Data retention settings.
- Secure deletion.
- Export logs.
- PHI/PII redaction option.
- Compliance mode for healthcare.

### 11. Super Admin Console

- Tenant list.
- Tenant usage.
- Failed call monitor.
- Tool failure monitor.
- Model/provider latency monitor.
- Subscription status.
- Manual account support tools.
- Abuse/fraud monitoring.
- System health.

## Recommended Tech Stack

This stack builds on the current project instead of replacing it.

### Frontend

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS
- Server Components for data-heavy admin pages
- Client Components for interactive forms, dashboards, voice agent, and upload flows

### Backend

- Next.js Route Handlers
- Node.js runtime for STT/TTS, file upload, PDF parsing, and tool calls
- Zod for request validation
- Supabase service-role client only in backend-only modules
- Server-side Supabase auth client for authenticated user resolution

### Database And Storage

- Supabase Postgres
- pgvector for knowledge and memory search
- Supabase Auth
- Supabase Storage for uploaded original documents and call recordings
- Add structured tables:
  - tenants
  - business_settings
  - agents
  - agent_versions
  - knowledge_documents
  - call_sessions
  - session_logs
  - tool_invocations
  - reservations
  - subscriptions
  - usage_events
  - escalation_contacts

### AI And Voice

- Deepgram STT
- Deepgram TTS
- Groq or OpenAI-compatible LLM API
- Tenant RAG using pgvector
- Optional later:
  - dedicated embedding model
  - audio emotion model
  - local fallback model for critical flows

### Telephony

- Twilio Programmable Voice for first production telephony integration
- Twilio phone numbers
- Twilio call transfer
- Twilio SMS for confirmations/reminders

### Integrations

- Resend for email
- Google Calendar API
- Microsoft Graph for Outlook Calendar
- Stripe for billing
- Google Sheets API for lightweight CRM/spreadsheet workflows
- HubSpot/Salesforce later
- Healthcare EHR integrations only after compliance design

### Observability

- Sentry for frontend/backend errors
- OpenTelemetry traces later
- Structured logs for every call/session/tool event
- Provider latency metrics:
  - STT latency
  - LLM latency
  - TTS latency
  - tool latency

### Testing

- TypeScript strict build
- ESLint
- Vitest for unit tests
- Playwright for website/admin end-to-end tests
- Integration tests for Supabase routes
- Smoke tests for voice, knowledge, booking, and billing paths

### Deployment

- Vercel for Next.js web app
- Supabase hosted Postgres/Auth/Storage
- Twilio/Deepgram/Groq/Resend/Stripe as managed providers
- Later: separate worker service for long-running outbound call campaigns

## Proposed Data Model Additions

### tenants

- id
- name
- industry
- timezone
- plan
- createdAt
- updatedAt

### business_settings

- id
- clientId
- businessName
- greeting
- voicePersona
- businessHours
- escalationPolicy
- defaultLanguage
- complianceMode

### agents

- id
- clientId
- name
- type
- status
- activeVersionId
- createdAt
- updatedAt

### agent_versions

- id
- agentId
- version
- promptConfig
- workflowConfig
- voiceConfig
- guardrailConfig
- publishedAt

### knowledge_documents

- id
- clientId
- filename
- mimeType
- status
- chunkCount
- storagePath
- errorMessage
- createdAt
- updatedAt

### call_sessions

- id
- clientId
- agentId
- callerPhone
- businessPhone
- direction
- status
- startedAt
- endedAt
- durationSeconds
- summary
- escalated

### tool_invocations

- id
- clientId
- sessionId
- toolName
- status
- inputJson
- outputJson
- errorMessage
- startedAt
- completedAt

### usage_events

- id
- clientId
- eventType
- quantity
- provider
- costEstimate
- createdAt

## Phase-By-Phase Build Plan

Each phase should create a deployable, visible product improvement.

### Phase 1: Public Website And Product Positioning

Goal:

Create the real VOXERA web presence so visitors understand the product and can start onboarding.

Build:

- Homepage.
- Industry/use-case sections.
- Pricing section.
- Demo CTA.
- Login/signup CTA.
- Basic responsive design.
- Clear product messaging around AI phone agents.

Deployable result:

- A professional public website at `/`.
- Visitors can understand VOXERA and start signup.

Success criteria:

- Homepage loads fast.
- Mobile and desktop layouts look polished.
- CTA routes to login/signup or onboarding start.

### Phase 2: Business Onboarding Wizard

Goal:

Allow a new client to describe their business and generate an initial AI-agent setup.

Build:

- Onboarding route.
- Business profile form.
- Industry selection.
- Use-case selection.
- Recommended agent template.
- Save onboarding data to Supabase.
- Setup checklist in admin dashboard.

Deployable result:

- A client can create a business profile and see a recommended AI agent.

Success criteria:

- New tenant data is saved.
- Admin dashboard reflects setup progress.
- No manual database editing needed for a new client.

### Phase 3: Agent Builder MVP

Goal:

Let businesses configure a useful AI phone agent.

Build:

- Agents table and agent settings UI.
- Agent type selection.
- Greeting, tone, voice persona, escalation contact.
- Basic workflow rules:
  - answer FAQ
  - book appointment
  - escalate to human
- Test-agent panel using current `/api/turn`.

Deployable result:

- A business can configure and test an agent from the admin portal.

Success criteria:

- Settings are stored server-side.
- Test call/chat uses selected agent configuration.
- Voice persona is no longer localStorage-only.

### Phase 4: Knowledge Management Upgrade

Goal:

Make knowledge upload manageable and production-friendly.

Build:

- `knowledge_documents` table.
- Store original files in Supabase Storage.
- Link memory chunks to document IDs.
- Document list with status.
- Delete document and associated chunks.
- Re-index document.
- Knowledge search preview.

Deployable result:

- Admins can manage uploaded knowledge like real documents, not anonymous chunks.

Success criteria:

- Upload, list, search, delete, and re-index work.
- Knowledge is tenant-isolated.
- Large knowledge bases do not load all chunks at once.

### Phase 5: Tool Invocation And Audit Logging

Goal:

Make every action the AI takes visible and auditable.

Build:

- Full tool execution context.
- `tool_invocation` session events.
- Optional `tool_invocations` table.
- Tool status in session timeline.
- Booking/email/calendar result logs.
- Redaction for sensitive tool inputs.

Deployable result:

- Admin can open a session and see exactly what tools the AI used and whether they succeeded.

Success criteria:

- Tool calls appear in analytics and session timelines.
- Failures are visible.
- Booking and email actions are traceable.

### Phase 6: Booking And Scheduling Production Pass

Goal:

Make booking reliable enough for real businesses.

Build:

- Tenant-scoped availability checks.
- Tenant-scoped cancellation.
- Transaction-safe booking creation.
- Calendar conflict checking.
- Customer contact collection.
- Email/SMS confirmation.
- Booking dashboard.

Deployable result:

- Businesses can let the AI create and manage real bookings.

Success criteria:

- Double-booking is prevented.
- Confirmations go to real customer contact info.
- Admin can review booking history.

### Phase 7: Telephony MVP

Goal:

Move from browser demo to real phone calls.

Build:

- Twilio inbound webhook.
- Phone number setup.
- Call session creation.
- Real-time STT/TTS bridge.
- Human transfer action.
- Call status logging.
- Call recording consent setting.

Deployable result:

- A real phone number can connect callers to a VOXERA AI agent.

Success criteria:

- Inbound call reaches AI agent.
- Call transcript and events appear in admin.
- Human escalation path works.

### Phase 8: Analytics And Quality Dashboard

Goal:

Turn the admin dashboard into an operations dashboard.

Build:

- Confidence distribution.
- Peak hours.
- Average call duration.
- Escalation reasons.
- Conversion rate.
- Missed bookings.
- Tool failure rate.
- Provider latency metrics.
- Session count over time.

Deployable result:

- Business owners can judge whether their AI agent is working well.

Success criteria:

- Metrics are derived from session/tool/call logs.
- Dashboard handles empty states and malformed data safely.
- Metrics are tenant-scoped.

### Phase 9: Aftercare Agent Vertical

Goal:

Build a standout vertical product for hospitals/clinics.

Build:

- Healthcare aftercare template.
- Patient follow-up workflow builder.
- Red-flag symptom rules.
- Nurse/doctor escalation routing.
- Staff summary format.
- Compliance settings.
- Patient consent language.
- Audit export.

Deployable result:

- A clinic can configure a post-surgery aftercare AI agent.

Success criteria:

- AI avoids diagnosis.
- Urgent symptoms escalate.
- Staff can review summaries.
- Sensitive data handling is stricter than normal business mode.

### Phase 10: Billing And Usage

Goal:

Make VOXERA commercially usable.

Build:

- Stripe checkout.
- Plan selection.
- Subscription management.
- Usage metering by call minutes and agents.
- Billing dashboard.
- Plan limits.
- Trial support.

Deployable result:

- Clients can purchase and manage VOXERA subscriptions.

Success criteria:

- Paid plans unlock correct limits.
- Usage is tracked.
- Failed payments are handled.

### Phase 11: Super Admin And Reliability

Goal:

Make the platform operable by the VOXERA team.

Build:

- Super admin dashboard.
- Tenant search.
- Usage overview.
- Failed calls/tools monitor.
- Provider health monitor.
- Error tracking.
- Audit log viewer.
- Manual support actions.

Deployable result:

- VOXERA team can operate and support customers.

Success criteria:

- Failures can be found quickly.
- Tenant issues can be diagnosed.
- Usage and billing support are visible.

## Recommended First Implementation Sprint

Start with the parts that create visible website progress and prepare the SaaS foundation.

Sprint goals:

1. Build polished public homepage.
2. Add industry/use-case positioning.
3. Add onboarding start page.
4. Add business profile storage.
5. Add server-side business settings table.
6. Move voice persona/greeting from localStorage to server-side settings.

Files likely involved:

- `app/page.tsx`
- `app/globals.css`
- `app/onboarding/page.tsx`
- `app/admin/settings/page.tsx`
- `app/api/settings/route.ts`
- `lib/db/*`
- `sql/migration.sql`

Visible result after sprint:

- VOXERA looks like a real SaaS website.
- A client can start setup.
- Admin settings become tenant-aware and persistent.

## Design Direction

The UI should feel like a serious operations platform:

- Clean, high-trust, modern SaaS.
- Dense enough for business users.
- Clear workflows instead of decorative marketing sections.
- Industry-specific examples.
- Strong admin dashboard hierarchy.
- Human escalation and safety visible.
- Avoid looking like a generic chatbot landing page.

Suggested visual language:

- Neutral light interface with strong accent color.
- Clear product screenshots/mock panels.
- Call timeline visuals.
- Agent status panels.
- Knowledge health indicators.
- Industry template cards.

## Final Product Positioning

Recommended positioning:

> VOXERA builds AI phone agents for businesses that cannot afford to miss calls.

Supporting message:

> Train an AI agent on your business knowledge, connect your phone number, and let it answer calls, book appointments, follow up with customers, and escalate urgent cases to your team.

Best wedge market:

Start with appointment-heavy businesses where phone calls directly affect revenue or care quality:

- clinics
- hospitals
- dental practices
- salons
- restaurants
- hotels
- repair/service businesses

Most impressive vertical:

Healthcare aftercare, because it shows VOXERA is more than a receptionist. It becomes an operational AI agent that can follow up, detect risk, and support staff.
