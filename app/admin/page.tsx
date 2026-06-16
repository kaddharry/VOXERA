"use client";

import { useEffect, useState } from "react";

export default function AnalyticsDashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className="p-10 font-sans text-gray-500 animate-pulse">Loading Analytics...</div>;
  if (data.error) return (
    <div className="p-10 font-sans">
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
        <h2 className="font-bold mb-2">Failed to load analytics</h2>
        <p>{data.error}</p>
        <p className="mt-4 text-sm font-semibold">Note: Did you run the SQL migration script from walkthrough.md in your Supabase SQL editor? The database might be missing required columns like 'clientId'.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-800">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">VOXERA Dashboard</h1>
        <p className="text-gray-500 mt-2">Real-time Analytics & Session Monitoring</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Total Calls</h3>
          <p className="text-4xl font-bold text-blue-600">{data.metrics.totalCalls}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Tool Invocations</h3>
          <p className="text-4xl font-bold text-indigo-600">{data.metrics.totalToolInvocations}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Escalations</h3>
          <p className="text-4xl font-bold text-orange-500">{data.metrics.escalations}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Active Bookings</h3>
          <p className="text-4xl font-bold text-green-600">{data.metrics.activeBookings}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Cancelled</h3>
          <p className="text-4xl font-bold text-red-600">{data.metrics.cancelledBookings}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 lg:col-span-1">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Emotion Distribution</h2>
          <div className="space-y-4">
            {Object.entries(data.emotions).map(([emotion, count]) => (
              <div key={emotion} className="flex items-center justify-between">
                <span className="capitalize font-medium text-gray-700">{emotion}</span>
                <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-semibold">
                  {String(count)}
                </span>
              </div>
            ))}
            {Object.keys(data.emotions).length === 0 && (
              <p className="text-gray-400 text-sm italic">No emotion data available.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 lg:col-span-2">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Recent System Events</h2>
          <div className="overflow-y-auto h-96 pr-4 space-y-4">
            {data.recentEvents.map((ev: any, i: number) => (
              <div key={i} className="flex gap-4 p-4 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
                <div className="flex-none">
                  <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 text-blue-600 font-bold text-xs">
                    {ev.type.substring(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900 capitalize">{ev.type.replace("_", " ")}</span>
                    <span className="text-xs text-gray-400">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono break-all bg-white p-2 rounded border border-gray-100">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
            {data.recentEvents.length === 0 && (
              <p className="text-gray-400 text-sm italic">No recent events found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
