import {
  LayoutDashboard,
  Database,
  Settings,
  Sparkles,
  Users,
  PhoneCall,
  Bot,
  UserCheck,
  Radio,
  MessageSquare,
  Lightbulb,
  CalendarDays,
  Wrench,
  ShieldCheck,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { canAccessAdminPath, type HospitalRole } from "../../lib/auth/permissions";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/admin", icon: LayoutDashboard, label: "Overview" },
  { href: "/admin/patients", icon: UserCheck, label: "Patients" },
  { href: "/admin/calendar", icon: CalendarDays, label: "Appointments" },
  { href: "/admin/staff", icon: Users, label: "Staff" },
  { href: "/admin/team", icon: KeyRound, label: "Team & Logins" },
  { href: "/admin/approvals", icon: ShieldCheck, label: "Doctor Requests" },
  { href: "/admin/tools", icon: Wrench, label: "Tools" },
  { href: "/admin/live_dashboard", icon: Radio, label: "Live Calls" },
  { href: "/admin/sessions", icon: MessageSquare, label: "Calls & Insights" },
  { href: "/admin/learning", icon: Lightbulb, label: "Agent Learning" },
  { href: "/admin/agents", icon: Bot, label: "Agent Builder" },
  { href: "/admin/knowledge", icon: Database, label: "Hospital Information & Policies" },
  { href: "/admin/try-call", icon: PhoneCall, label: "Test Agent" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

const PLATFORM_ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin/tenants", icon: Users, label: "Tenants" },
  { href: "/admin/rag", icon: Sparkles, label: "RAG Debugger" },
];

/** The menu a role actually gets: pages their role can't open are not listed (the server still enforces). */
export function navItemsFor(role: HospitalRole, isPlatformAdmin: boolean): NavItem[] {
  const base = BASE_NAV_ITEMS.filter((item) => canAccessAdminPath(role, item.href));
  return isPlatformAdmin ? [...base, ...PLATFORM_ADMIN_NAV_ITEMS] : base;
}
