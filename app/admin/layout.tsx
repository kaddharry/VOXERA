import { redirect } from "next/navigation";
import { createClient } from "../../lib/db/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  // If there's no authenticated user, redirect to login
  if (!user || error) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-gray-200">
        <div className="h-full px-3 py-4 flex flex-col">
          <div className="mb-6 px-3">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">VOXERA Admin</h2>
          </div>
          <nav className="space-y-1 flex-1">
            <a
              href="/admin"
              className="bg-gray-100 text-gray-900 group flex items-center px-3 py-2 text-sm font-medium rounded-md"
            >
              Dashboard
            </a>
            <a
              href="/admin/knowledge"
              className="text-gray-600 hover:bg-gray-50 hover:text-gray-900 group flex items-center px-3 py-2 text-sm font-medium rounded-md"
            >
              Knowledge Base
            </a>
            <a
              href="/admin/settings"
              className="text-gray-600 hover:bg-gray-50 hover:text-gray-900 group flex items-center px-3 py-2 text-sm font-medium rounded-md"
            >
              Settings
            </a>
          </nav>
          <div className="mt-auto px-3 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
