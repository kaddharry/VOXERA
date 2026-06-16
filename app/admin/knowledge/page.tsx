"use client";

import { useEffect, useState } from "react";

interface KnowledgeEntry {
  id: string;
  topic: string;
  text: string;
  importance: number;
}

export default function KnowledgeBasePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  // Load existing knowledge entries
  useEffect(() => {
    fetch("/api/knowledge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "", listAll: true }),
    })
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.results ?? []);
        setLoadingEntries(false);
      })
      .catch(() => setLoadingEntries(false));
  }, [result]); // re-fetch after successful upload

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setResult(data);
      setFile(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Group entries by topic
  const grouped = entries.reduce<Record<string, KnowledgeEntry[]>>((acc, e) => {
    const topic = e.topic || "general";
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push(e);
    return acc;
  }, {});

  return (
    <div className="p-8 font-sans text-gray-900 bg-white min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-gray-500 mt-2">
          Upload PDFs or Text files to train your AI receptionist.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Panel */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Document</h2>
          <form onSubmit={handleUpload} className="space-y-6">
            <div>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-blue-500 transition-colors bg-white">
                <div className="space-y-1 text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex text-sm text-gray-600 justify-center">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                    >
                      <span>Upload a file</span>
                      <input
                        id="file-upload"
                        name="file-upload"
                        type="file"
                        accept=".txt,.pdf"
                        className="sr-only"
                        onChange={handleFileChange}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">TXT or PDF up to 5MB</p>
                </div>
              </div>
              {file && (
                <p className="mt-2 text-sm text-green-600 font-medium">
                  Selected: {file.name}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!file || isUploading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? "Uploading & Indexing..." : "Ingest Document"}
            </button>
          </form>

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md">
              <h3 className="text-sm font-medium text-red-800">Upload Error</h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          )}

          {result && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-md">
              <h3 className="text-sm font-medium text-green-800">Success!</h3>
              <p className="mt-1 text-sm text-green-700">
                Document ingested. Broken down into {result.chunkCount} semantic chunks.
              </p>
            </div>
          )}
        </div>

        {/* Ingested Knowledge List */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Ingested Knowledge <span className="text-sm font-normal text-gray-500">({entries.length} chunks)</span>
          </h2>
          {loadingEntries ? (
            <p className="text-gray-400 text-sm animate-pulse">Loading...</p>
          ) : Object.keys(grouped).length === 0 ? (
            <p className="text-gray-400 text-sm italic">No knowledge documents ingested yet.</p>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {Object.entries(grouped).map(([topic, items]) => (
                <details key={topic} className="bg-white rounded-lg border border-gray-200">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 rounded-lg flex justify-between items-center">
                    <span className="capitalize">{topic.replace("kb:", "📄 ")}</span>
                    <span className="text-xs text-gray-400">{items.length} chunks</span>
                  </summary>
                  <div className="px-4 pb-3 space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="text-xs text-gray-600 p-2 bg-gray-50 rounded border border-gray-100">
                        <div className="font-mono text-[10px] text-gray-400 mb-1">ID: {item.id}</div>
                        <p className="line-clamp-3">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
