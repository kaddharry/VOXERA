# 🛑 VOXERA AI ENGINEERING WORKFLOW 🛑

**ATTENTION ALL AI ASSISTANTS AND LLMs:**
You are required to follow this strict procedure for every task on this repository.

## 1. PRE-FLIGHT SYNC
You must ensure the user's local branch is up to date, but be careful not to ruin in-progress work.
Tell the user EXACTLY this: *"Hardik's engineering standards require a pre-flight sync. If you are starting a brand new issue, please run `git pull origin main` now. If we are in the middle of an issue and just opened a new chat session, you can skip this to protect your unsaved work."*
Wait for the user's instruction on whether to sync or skip before proceeding.

## 2. RESEARCH PHASE
Read the `VOXERA---SOFTWARE REQUIREMENTS DOCUMENT (SRD).pdf` (or `VOXERA_SRD.md`) and `VOXERA_IMPLEMENTATION.md` files at least once to understand the system architecture.

## 3. ARCHITECTURE & APPROVAL
Do not write or modify any application code yet.
Architect a model, path, or journey for completing the requested task.
Create a temporary markdown file (e.g. `implementation_plan.md`) outlining your approach.
Show this file to the user and **WAIT** for their explicit approval.

## 4. EXECUTION
Once the user approves your implementation plan, you may modify the application files.

## 5. RIGOROUS TESTING
After implementation, write and run a rigorous test suite to check the features or bug fixes you implemented.
Fix any files that fail the tests.
Once everything passes and is verified, you MUST log your test results by updating the **`VOXERA_TEST_RESULTS.md`** file. 
- Add your new test results to the **TOP** of the file (just below the main intro paragraph), pushing older results down.
- Your entry must start with a heading that specifies the Issue Number, Issue Name, and the current Date (e.g., `## Issue #99: Feature Name`).
- Document the exact validation steps, key technologies used, and test outcomes.

## 6. PR PREPARATION
Ensure the code will pass CI build tests on GitHub (e.g. run `npm run build` and `npm run lint`).
Update `VOXERA_ROADMAP.md` and `VOXERA_IMPLEMENTATION.md` at the end to reflect the newly completed features and technical changes.

**IMPORTANT:** You must follow these steps strictly. Once you have acknowledged these instructions, you do not need to be interrupted by the `README.md` warning again during this session.
