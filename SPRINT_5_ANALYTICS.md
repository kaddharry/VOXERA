# Sprint 5 — Analytics Dashboard v2 Documentation

This document covers the details of **Sprint 5 — Analytics Dashboard v2** for the VOXERA platform.

---

## 1. Objectives & Features

The primary objective of Sprint 5 was to expand the admin monitoring dashboard with rich, real-time analytics indicators, fix the tool invocation logging bug, and implement robust calculations for the following advanced operational metrics:
- **Peak Hours Heatmap:** Dynamic client-side calculation representing call arrivals grouped by hour (0–23).
- **Daily Call Trends Chart:** Visual bar trend tracking the count of call sessions across different dates.
- **Booking Conversion Rate:** Calculated percentage of call sessions that successfully resulted in synchronized reservations.
- **Missed Bookings Counter:** Total count of failed `create_booking` attempts.
- **SER Confidence Distribution:** Segmentation of classified Speech Emotion Recognition confidence ratings into "High", "Medium", and "Low".
- **Average Session Duration:** Track the average duration of user call sessions in minutes and seconds.

---

## 2. Architecture & Modified Components

### 2.1 Tool Invocation Logger (`lib/agent/tools.ts`)
- Refactored `dispatchToolCall` to log the `tool_invocation` event precisely once.
- Prevents double-logging by writing `success: true` only on successful completion of the tool execution instead of at the start.
- Captures `success: false` and the respective error message inside the `catch` block on failure.

### 2.2 Analytics Backend API (`app/api/analytics/route.ts`)
- Extracts and aggregates the unique sessions, calculating start/end times and mapping them to:
  - Daily session frequencies.
  - 24-hour peak heatmaps.
  - Conversion rates (using the presence of `calendar_sync` events indicating a successful booking creation).
  - Missed booking events where `create_booking` failed.
  - Confidence distributions dynamically bucketed based on model scores (High >= 0.8, Medium >= 0.5, Low < 0.5).
- Returns fallback defensive payloads on empty collections.

### 2.3 Premium UI Dashboard Components (`app/admin/page.tsx`)
- Constructed CSS/SVG-based data charts (without third-party charting dependencies like recharts/chart.js to keep bundle lightweight and avoid compatibility issues):
  - **Heatmap:** 24-bar vertical chart with responsive hover tooltips and progressive color gradients (emerald to cyan).
  - **Trend Chart:** Date-labeled vertical bars depicting relative call volumes per day.
  - **Conversion Rate:** Radial SVG progress circle with a transition stroke offset indicating percentage.
  - **Confidence Segments:** Horizontal progress bar with three distinct segmented colors (Emerald, Amber, Red).
- Built defensive guards to safely load empty state mock placeholders if metrics are undefined.

---

## 3. Verification & Testing

### 3.1 Unit Testing (`__tests__/analytics/route.test.ts`)
- Created a new mock-driven test suite validating:
  - Unauthorized access handling (rejecting with `401`).
  - Correct execution and mathematical calculation of all basic and advanced metrics.
  - Fault tolerance, error logging, and standard response formats on DB queries failure (returning a `500`).

### 3.2 Verification Logs
All 122 tests passed successfully:
```bash
$ npm run test:run

 RUN  v4.1.9 /Users/vikasverma/Desktop/VOXERA

 ✓ __tests__/telephony/audio-codec.test.ts (14 tests)
 ✓ __tests__/emotion/persona.test.ts (27 tests)
 ✓ __tests__/emotion/policy-escalation.test.ts (19 tests)
 ✓ __tests__/reservations/workflows.test.ts (6 tests)
 ✓ __tests__/knowledge/ingestion.test.ts (4 tests)
 ✓ __tests__/analytics/route.test.ts (3 tests)
 ✓ __tests__/telephony/queue-manager.test.ts (11 tests)
 ✓ __tests__/telephony/routes.test.ts (11 tests)
 ✓ __tests__/emotion/context-prompt.test.ts (12 tests)
 ✓ __tests__/telephony/twiml-builders.test.ts (15 tests)

 Test Files  10 passed (10)
      Tests  122 passed (122)
```

TypeScript code is checked and verified:
```bash
$ npx tsc --noEmit
# Success (no warnings or compilation errors)
```
