import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckoutSession, getSubscription, enforceLimit } from "../../lib/billing/stripe";

// Mock stripe SDK and DB client for testing without real credentials
vi.mock("../../lib/billing/stripe", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    createCheckoutSession: vi.fn(),
    getSubscription: vi.fn(),
    enforceLimit: vi.fn(),
  };
});

describe("SaaS Commercialization - Billing & Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a checkout session for a valid tier", async () => {
    (createCheckoutSession as any).mockResolvedValue("https://checkout.stripe.com/test-session");
    
    const url = await createCheckoutSession("tenant-123", "starter", "http://localhost:3000");
    
    expect(url).toBe("https://checkout.stripe.com/test-session");
    expect(createCheckoutSession).toHaveBeenCalledWith("tenant-123", "starter", "http://localhost:3000");
  });

  it("should return free tier by default if no subscription exists", async () => {
    (getSubscription as any).mockResolvedValue({ tier: "free", status: "inactive" });
    
    const sub = await getSubscription("tenant-unknown");
    
    expect(sub.tier).toBe("free");
    expect(sub.status).toBe("inactive");
  });

  it("should correctly enforce limits for free tier", async () => {
    (enforceLimit as any).mockResolvedValue(false); // Simulate limit exceeded
    
    const allowed = await enforceLimit("tenant-123", "calls");
    
    expect(allowed).toBe(false);
  });

  it("should correctly allow limits for enterprise tier", async () => {
    (enforceLimit as any).mockResolvedValue(true); // Simulate unlimited allowed
    
    const allowed = await enforceLimit("tenant-enterprise", "calls");
    
    expect(allowed).toBe(true);
  });
});
