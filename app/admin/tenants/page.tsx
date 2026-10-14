import { createClient } from "@/lib/db/server";
import { Users, CheckCircle2, AlertCircle, Clock, Building, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/auth/roles";

export const runtime = "nodejs";

export default async function AdminTenantsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isPlatformAdmin(user?.email)) {
    redirect("/admin");
  }

  // Fetch tenants
  const { data: tenants, error: tenantsErr } = await supabase
    .from("tenants")
    .select(`
      id,
      name,
      industry,
      created_at,
      subscriptions (
        tier,
        status,
        current_period_end
      )
    `)
    .order("created_at", { ascending: false });

  // Fetch aggregates for calls and documents per tenant
  const { data: callLogs } = await supabase.from("call_logs").select("tenant_id");
  const { data: documents } = await supabase.from("knowledge_documents").select("tenant_id");

  const tenantStats = (tenants || []).map(tenant => {
    const sub = tenant.subscriptions?.[0] || { tier: "free", status: "inactive" };
    const calls = callLogs?.filter(c => c.tenant_id === tenant.id).length || 0;
    const docs = documents?.filter(d => d.tenant_id === tenant.id).length || 0;
    return { ...tenant, sub, calls, docs };
  });

  return (
    <div className="p-6 md:p-10 font-body min-h-screen max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)] flex items-center gap-3">
            <Users className="w-8 h-8 text-[var(--color-accent-cyan)]" />
            Tenants
          </h1>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-2 max-w-xl">
            Manage platform organizations and subscriptions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title="Total Tenants" value={tenantStats.length.toString()} icon={Building} />
        <StatCard
          title="Active Paid Subscriptions"
          value={tenantStats.filter(t => t.sub.status === "active" && t.sub.tier !== "free").length.toString()}
          icon={CheckCircle2}
        />
        <StatCard
          title="Total API Calls"
          value={(callLogs?.length || 0).toString()}
          icon={Clock}
        />
      </div>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <table className="w-full text-left text-[14px]">
          <thead className="bg-[var(--color-bg-surface)] border-b border-[var(--color-border-subtle)] text-[10.5px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            <tr>
              <th className="px-6 py-4">Tenant Name</th>
              <th className="px-6 py-4">Industry</th>
              <th className="px-6 py-4">Plan</th>
              <th className="px-6 py-4">Usage (Calls/Docs)</th>
              <th className="px-6 py-4">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {tenantStats.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-[var(--color-bg-surface)] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-semibold text-[var(--color-text-primary)]">{tenant.name}</div>
                  <div className="text-[12px] text-[var(--color-text-muted)] font-mono">{tenant.id}</div>
                </td>
                <td className="px-6 py-4 text-[var(--color-text-secondary)] capitalize">{tenant.industry || "Unknown"}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                      tenant.sub.tier === "enterprise" ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                      tenant.sub.tier === "growth" ? "bg-[var(--color-accent-violet)]/10 text-[var(--color-accent-violet)] border border-[var(--color-accent-violet)]/20" :
                      tenant.sub.tier === "starter" ? "bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/20" :
                      "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
                    }`}>
                      {tenant.sub.tier}
                    </span>
                    {tenant.sub.status === "active" && tenant.sub.tier !== "free" && (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-[13px] font-mono text-[var(--color-text-secondary)]">
                  {tenant.calls} / {tenant.docs}
                </td>
                <td className="px-6 py-4 text-[13px] text-[var(--color-text-secondary)]">
                  {tenant.created_at ? new Date(tenant.created_at).toLocaleDateString() : "Unknown"}
                </td>
              </tr>
            ))}
            
            {tenantStats.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-[var(--color-text-secondary)]">
                  <AlertCircle className="w-8 h-8 mx-auto mb-3 text-[var(--color-border-active)]" />
                  <p>No tenants found</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.5)] flex items-start gap-4">
      <div className="p-3 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)]">
        <Icon className="w-6 h-6 text-[var(--color-accent-cyan)]" />
      </div>
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mb-1.5">{title}</h3>
        <p className="text-3xl font-display font-bold text-[var(--color-text-primary)]">{value}</p>
      </div>
    </div>
  );
}
