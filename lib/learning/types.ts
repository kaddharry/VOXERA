/**
 * Call learning: what the agents learn from each call, in three scopes.
 *  - patient: durable facts about ONE patient, shared by every agent that calls them.
 *  - agent:   lessons about how ONE agent should handle calls.
 *  - global:  lessons that held across several agents; applied to all of them.
 * See sql/migration_v36.sql.
 */
export type LearningScope = "patient" | "agent" | "global";
export type LearningStatus = "active" | "pending" | "retired";

export const PATIENT_CATEGORIES = [
  "language_preference",   // language/script they like to talk in
  "contact_preference",    // best time to call, wants shorter calls, family answers, ...
  "health_status",        // symptoms and recovery as THEY reported
  "medication",           // what they take, adherence problems
  "concern",              // worries, fears, emotional state worth remembering
  "personal_context",     // caregiver, work, travel, anything affecting scheduling
  "open_item",            // something promised / still to follow up
  "communication_style",  // brief vs chatty, formal vs casual, needs things repeated
] as const;
export const LESSON_CATEGORIES = ["approach", "scheduling", "escalation", "language", "tone", "information"] as const;

export interface Learning {
  id: string;
  clientId: string;
  scope: LearningScope;
  agentId: string | null;
  patientId: string | null;
  category: string;
  key: string | null;
  text: string;
  evidence: string[];
  sourceCallIds: string[];
  supportCount: number;
  confidence: number;
  status: LearningStatus;
  createdAt: number;
  updatedAt: number;
}

/** Storage seam: Supabase in production, in-memory in tests. */
export interface LearningStore {
  listPatient(clientId: string, patientId: string, statuses?: LearningStatus[]): Promise<Learning[]>;
  listAgent(clientId: string, agentId: string, statuses?: LearningStatus[]): Promise<Learning[]>;
  listGlobal(clientId: string, statuses?: LearningStatus[]): Promise<Learning[]>;
  /** Every patient's facts in the account (for the admin overview), newest first. */
  listAllPatient(clientId: string, limit?: number): Promise<Learning[]>;
  /** Every agent-scope lesson in the account — used to find lessons that repeat across agents. */
  listAllAgentLessons(clientId: string): Promise<Learning[]>;
  insert(row: Learning): Promise<void>;
  update(id: string, patch: Partial<Omit<Learning, "id">>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What the model proposes for one call, before grounding checks and merging. */
export interface ExtractedFact {
  key: string;
  category: string;
  text: string;
  confidence: number;
  evidence: string;
}
export interface ExtractedLesson {
  category: string;
  text: string;
  confidence: number;
  evidence: string;
  /** true when it is generic enough to help every agent (no patient details). */
  general: boolean;
  /** true when it gives medical guidance and so needs a human's approval (see clinical.ts). */
  clinical?: boolean;
}
export interface Extraction {
  patientFacts: ExtractedFact[];
  /** Keys of earlier facts the patient said are no longer true. */
  resolvedKeys: string[];
  lessons: ExtractedLesson[];
}
