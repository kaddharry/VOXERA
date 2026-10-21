"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  AlertTriangle,
  Database,
  Clock,
} from "lucide-react";

interface KnowledgeDocument {
  id: string;
  clientId: string;
  filename: string;
  mimeType: string;
  status: "processing" | "ready" | "failed" | "superseded";
  chunkCount: number;
  errorMessage?: string;
  version: number;
  createdAt: number;
}

export default function KnowledgeBasePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Documents state
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Detail states
  const [selectedError, setSelectedError] = useState<{ filename: string; message: string } | null>(null);
  const [docToDelete, setDocToDelete] = useState<KnowledgeDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const limit = 5; // Page size
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch documents list
  const fetchDocuments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingDocs(true);
    try {
      const res = await fetch(
        `/api/knowledge/documents?page=${currentPage}&limit=${limit}&search=${encodeURIComponent(searchQuery)}`
      );
      if (!res.ok) throw new Error("Failed to load documents");
      const data = await res.json();
      setDocuments(data.documents);
      setTotalCount(data.totalCount);
    } catch (err) {
      console.error(err);
    } finally {
      if (showLoading) setLoadingDocs(false);
    }
  }, [currentPage, searchQuery]);

  // Re-fetch on pagination or search change
  useEffect(() => {
    fetchDocuments(true);
  }, [currentPage, searchQuery, fetchDocuments]);

  // Setup auto-polling if any document is processing
  useEffect(() => {
    const hasProcessing = documents.some((doc) => doc.status === "processing");

    if (hasProcessing) {
      if (!pollingInterval.current) {
        pollingInterval.current = setInterval(() => {
          fetchDocuments(false); // Silent reload without triggering full spinner
        }, 2000);
      }
    } else {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, [documents, fetchDocuments]);

  const pickFile = (f: File) => {
    setFile(f);
    setUploadError(null);
    setUploadResult(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) pickFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadResult(null);

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

      setUploadResult(data);
      setFile(null);
      setCurrentPage(1); // Go back to page 1 to see the new document
      await fetchDocuments(false);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDoc = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/knowledge/documents?id=${docToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");

      setDocToDelete(null);
      // If deleted last item on page, go back a page
      const newTotal = totalCount - 1;
      const maxPages = Math.max(Math.ceil(newTotal / limit), 1);
      if (currentPage > maxPages) {
        setCurrentPage(maxPages);
      } else {
        await fetchDocuments(false);
      }
    } catch (err: any) {
      alert(`Error deleting document: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.max(Math.ceil(totalCount / limit), 1);

  return (
    <div className="flex h-full flex-col font-body">
      {/* Compact single-line title — matches the rest of the admin shell;
          the breadcrumb above already names this page. */}
      <header className="flex flex-none items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--color-accent-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Hospital Information & Policies</span>
        </div>
        <button
          onClick={() => fetchDocuments(true)}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 xl:grid-cols-3 xl:overflow-hidden">
        {/* Upload Panel */}
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-2xl p-6 xl:overflow-y-auto">
          <h2 className="text-[12px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mb-5">
            Upload Document
          </h2>
          <form onSubmit={handleUpload} className="space-y-5">
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-9 px-6 cursor-pointer transition-colors text-center ${
                  dragOver
                    ? "border-[var(--color-accent-cyan)] bg-[var(--color-bg-base)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] hover:border-[var(--color-border-active)]"
                }`}
              >
                <UploadCloud className="w-9 h-9 text-[var(--color-text-muted)]" />
                <div className="flex text-[14px] text-[var(--color-text-secondary)] justify-center">
                  <span className="font-semibold text-[var(--color-accent-violet)]">Upload a file</span>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-[11.5px] text-[var(--color-text-muted)] font-mono">
                  TXT · PDF · MD · CSV · JSON · DOCX — up to 10MB
                </p>
                <input
                  ref={fileInputRef}
                  id="file-upload"
                  name="file-upload"
                  type="file"
                  accept=".txt,.pdf,.md,.markdown,.csv,.json,.docx"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </div>
              {file && (
                <p className="mt-3 text-[13px] text-[var(--color-accent-violet)] font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4 flex-none" /> <span className="truncate">Selected: {file.name}</span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!file || isUploading}
              className="w-full flex justify-center py-3 px-4 rounded-xl text-[14px] font-semibold text-white btn-gradient shadow-[0_0_15px_var(--color-accent-glow)] hover:scale-[1.02] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {isUploading ? "Uploading & Indexing…" : "Ingest Document"}
            </button>
          </form>

          {uploadError && (
            <div className="mt-5 p-4 bg-red-950/[0.04] border border-red-500/25 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-[13.5px] font-semibold text-red-600">Upload Error</h3>
                <p className="mt-1 text-[12.5px] text-red-500/90 leading-relaxed font-mono break-words">{uploadError}</p>
              </div>
            </div>
          )}

          {uploadResult && (
            <div className="mt-5 p-4 bg-emerald-950/[0.04] border border-emerald-500/25 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-[13.5px] font-semibold text-emerald-600">Success!</h3>
                <p className="mt-1 text-[12.5px] text-emerald-600/80 leading-relaxed">
                  Document received. Now chunking &amp; embedding in the background — check the table for status.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Ingested Documents Table */}
        <div className="flex min-h-[420px] flex-col rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 xl:col-span-2 xl:min-h-0">
          <div className="flex flex-none flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
            <div>
              <h2 className="text-[12px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
                Documents Manager
              </h2>
              <p className="text-[12.5px] text-[var(--color-text-muted)] mt-1">{totalCount} documents uploaded</p>
            </div>

            {/* Search Box */}
            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1); // Reset page to 1
                }}
                placeholder="Search filenames…"
                className="w-full pl-8 pr-8 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg text-[12.5px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-violet)] transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="min-h-0 flex-1 overflow-auto">
            {loadingDocs ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <RefreshCw className="w-6 h-6 text-[var(--color-accent-cyan)] animate-spin" />
                <p className="text-[var(--color-text-muted)] text-[13px]">Loading documents…</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 border border-dashed border-[var(--color-border-subtle)] rounded-xl bg-[var(--color-bg-base)]">
                <FileText className="w-7 h-7 text-[var(--color-text-muted)] mb-2" />
                <p className="text-[var(--color-text-muted)] text-[13px]">
                  {searchQuery ? "No documents match your search query." : "No knowledge documents yet."}
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="pb-3 pt-1 pl-1">Filename</th>
                    <th className="pb-3 pt-1">Version</th>
                    <th className="pb-3 pt-1">Status</th>
                    <th className="pb-3 pt-1">Chunks</th>
                    <th className="pb-3 pt-1">Uploaded</th>
                    <th className="pb-3 pt-1 pr-1 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {documents.map((doc) => {
                    const dateFormatted = new Date(doc.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });

                    return (
                      <tr key={doc.id} className="text-[13px] hover:bg-[var(--color-bg-elevated)] transition-colors">
                        <td className="py-3.5 pl-1 font-medium text-[var(--color-text-primary)]">
                          <div className="flex items-center gap-2 max-w-[200px] sm:max-w-xs md:max-w-md truncate" title={doc.filename}>
                            <FileText className="w-4 h-4 text-[var(--color-accent-violet)] shrink-0" />
                            <span className="truncate">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="py-3.5 font-mono text-[11.5px] text-[var(--color-text-secondary)]">v{doc.version}</td>
                        <td className="py-3.5">
                          <StatusBadge doc={doc} onShowError={(filename, msg) => setSelectedError({ filename, message: msg })} />
                        </td>
                        <td className="py-3.5 font-mono text-[11.5px] text-[var(--color-text-secondary)]">
                          {doc.status === "ready" ? `${doc.chunkCount} chunks` : doc.status === "processing" ? "counting…" : "—"}
                        </td>
                        <td className="py-3.5 text-[12px] text-[var(--color-text-secondary)]">{dateFormatted}</td>
                        <td className="py-3.5 pr-1 text-right">
                          <button
                            onClick={() => setDocToDelete(doc)}
                            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-all active:scale-90"
                            title="Delete document"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Footer */}
          {!loadingDocs && totalCount > limit && (
            <div className="flex flex-none items-center justify-between border-t border-[var(--color-border-subtle)] pt-4 mt-4">
              <span className="text-[12px] text-[var(--color-text-secondary)] font-mono">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-30 disabled:hover:border-[var(--color-border-subtle)] disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error detail panel / modal */}
      {selectedError && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-elevated)] border border-red-500/25 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => setSelectedError(null)}
              className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-display font-bold text-lg text-[var(--color-text-primary)]">Ingestion Failed</h3>
            </div>
            <p className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2">
              File: <span className="text-[var(--color-text-primary)] font-mono text-[11.5px]">{selectedError.filename}</span>
            </p>
            <div className="p-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-lg font-mono text-[11.5px] text-red-600 overflow-y-auto max-h-48 leading-relaxed break-words whitespace-pre-wrap">
              {selectedError.message}
            </div>
            <button
              onClick={() => setSelectedError(null)}
              className="mt-6 w-full py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[13px] font-semibold transition-colors"
            >
              Close Details
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="font-display font-bold text-lg text-[var(--color-text-primary)] mb-2">Delete Document?</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="text-[var(--color-text-primary)] font-semibold font-mono text-[11.5px] break-all">
                "{docToDelete.filename}"
              </span>
              ? This permanently erases the document metadata and all <strong>{docToDelete.chunkCount} vector chunks</strong> in
              the AI's memory. This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDocToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-xl text-[13px] font-semibold border border-[var(--color-border-subtle)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDoc}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-red-300 text-white rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Yes, Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  doc,
  onShowError,
}: {
  doc: KnowledgeDocument;
  onShowError: (filename: string, message: string) => void;
}) {
  switch (doc.status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          Ready
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/25">
          <Clock className="w-3 h-3 animate-pulse shrink-0" />
          Processing
        </span>
      );
    case "failed":
      return (
        <button
          type="button"
          onClick={() => onShowError(doc.filename, doc.errorMessage || "Unknown error during ingestion")}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-red-500/10 hover:bg-red-500/15 text-red-600 border border-red-500/25 cursor-pointer transition-all active:scale-95 text-left"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          Failed (details)
        </button>
      );
    case "superseded":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
          Superseded
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
          Unknown
        </span>
      );
  }
}
