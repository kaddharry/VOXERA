# Contributing to VOXERA

Welcome to the VOXERA engineering team! This document outlines how we collaborate, our git workflows, and how to get your local environment running.

## 1. Local Onboarding (One-Command Setup)

To get started developing locally:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/voxera.git
   cd voxera
   ```

2. **Setup your environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   *Ask the engineering lead for the shared development keys to fill in `.env.local`.*

3. **Install and Run:**
   ```bash
   nvm use # Uses Node.js v20 (specified in .nvmrc)
   npm install
   npm run dev
   ```
   *The application will be running at `http://localhost:3000`.*

> **Note on Docker:** We strictly use `npm run dev` for local development because we rely entirely on external managed services (Supabase, Groq, Deepgram). There are no local databases to orchestrate, making Docker an unnecessary overhead for local developer loops. We only use Docker for the final production deployment.

## 2. Branching Strategy

We use a straightforward feature-branch workflow.

- `main` is the primary branch. It is protected and should always be deployable.
- Create feature branches off `main` using the following naming convention:
  - `feature/ticket-number-short-description` (e.g., `feature/VOX-12-booking-ui`)
  - `bugfix/ticket-number-description` (e.g., `bugfix/VOX-45-fix-lint`)

## 3. Pull Request Workflow

1. Commit your changes logically and push your branch to GitHub.
2. Open a Pull Request against `main`.
3. The PR template will automatically populate. Fill it out completely.
4. **CI Checks:** GitHub Actions will automatically run `npm run lint` and `npm run build`. You must fix any failing checks.
5. **Review:** At least 1 approval from a teammate is required before merging.

## 4. Environment Variables

If you introduce a new environment variable:
1. Add it to your `.env.local`.
2. Add a dummy/placeholder version of it to `.env.example`.
3. Inform the team so they can update their local environments.

## 5. Coding Standards

- **Next.js App Router:** We use the `app/` directory for routing. Ensure server/client components are explicitly declared using `"use client"`.
- **TypeScript:** Avoid `any`. Define interfaces in `lib/types.ts`.
- **Styling:** We use Tailwind CSS.
