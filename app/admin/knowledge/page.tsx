"use client";

import { useEffect, useState, useRef } from "react";
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
  FileCheck,
  AlertTriangle
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

  // Fetch documents list
  const fetchDocuments = async (showLoading = true) => {
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
  };

  // Re-fetch on pagination or search change
  useEffect(() => {
    fetchDocuments(true);
  }, [currentPage, searchQuery]);

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
  }, [documents]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadError(null);
      setUploadResult(null);
    }
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
    <div className="p-6 md:p-10 font-body min-h-screen relative text-[var(--color-text-primary)]">
      <header className="mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-gradient">Knowledge Base</h1>
          <p className="text-[14px] text-[var(--color-text-secondary)] mt-2">
            Upload PDFs or TXT documents to feed business facts, rules, and guidelines directly to the AI receptionist.
          </p>
        </div>
        <button 
          onClick={() => fetchDocuments(true)} 
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] hover:text-white transition-all w-fit shrink-0 active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
        {/* Upload Panel */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-secondary)] mb-6">Upload Document</h2>
          <form onSubmit={handleUpload} className="space-y-6">
            <div>
              <div className="flex justify-center px-6 pt-8 pb-8 border-2 border-dashed border-[var(--color-border-subtle)] rounded-xl hover:border-[var(--color-accent-cyan)] transition-colors bg-[var(--color-bg-surface)]">
                <div className="space-y-2 text-center flex flex-col items-center">
                  <UploadCloud className="w-10 h-10 text-[var(--color-text-muted)] mb-2" />
                  <div className="flex text-[14px] text-[var(--color-text-secondary)] justify-center">
                    <label
                      htmlFor="file-upload"
                      className="relative cursor-pointer rounded-md font-semibold text-[var(--color-accent-cyan)] hover:text-white transition-colors focus-within:outline-none"
                    >
                      <span>Upload a file</span>
                      <input
                        id="file-upload"
                        name="file-upload"
                        type="file"
                        accept=".txt,.pdf"
                        className="sr-only"
                        onChange={handleFileChange}
                        disabled={isUploading}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-muted)] font-mono">TXT or PDF up to 5MB</p>
                </div>
              </div>
              {file && (
                <p className="mt-3 text-[13px] text-[var(--color-accent-cyan)] font-mono font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Selected: {file.name}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!file || isUploading}
              className="w-full flex justify-center py-3 px-4 rounded-xl text-[14px] font-semibold text-white btn-gradient shadow-[0_0_15px_var(--color-accent-glow)] hover:scale-[1.02] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {isUploading ? "Uploading & Indexing..." : "Ingest Document"}
            </button>
          </form>

          {uploadError && (
            <div className="mt-6 p-4 bg-red-950/30 border border-red-900/50 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-[14px] font-semibold text-red-400">Upload Error</h3>
                <p className="mt-1 text-[13px] text-red-400/80 leading-relaxed font-mono text-xs">{uploadError}</p>
              </div>
            </div>
          )}

          {uploadResult && (
            <div className="mt-6 p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-[14px] font-semibold text-emerald-400">Success!</h3>
                <p className="mt-1 text-[13px] text-emerald-400/80 leading-relaxed">
                  Document received. Now chunking & indexing in the background. Check the document table for status.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Ingested Documents Table */}
        <div className="xl:col-span-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 shadow-[0_4px_30px_rgba(0,0,0,0.5)] flex flex-col min-h-[480px]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">Documents Manager</h2>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">{totalCount} documents uploaded</p>
            </div>
            
            {/* Search Box */}
            <div className="relative max-w-xs w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1); // Reset page to 1
                }}
                placeholder="Search filenames..."
                className="w-full pl-9 pr-4 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-xl text-[13px] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors text-white"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")} 
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--color-text-muted)] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-x-auto">
            {loadingDocs ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <RefreshCw className="w-8 h-8 text-[var(--color-accent-cyan)] animate-spin" />
                <p className="text-[var(--color-text-muted)] text-[13px] font-mono">Loading documents...</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 border border-dashed border-[var(--color-border-subtle)] rounded-xl bg-[var(--color-bg-surface)]">
                <FileText className="w-8 h-8 text-[var(--color-text-muted)] mb-2" />
                <p className="text-[var(--color-text-muted)] text-[13px] italic">
                  {searchQuery ? "No documents match your search query." : "No knowledge documents found."}
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    <th className="pb-3 pt-1 pl-2">Filename</th>
                    <th className="pb-3 pt-1">Version</th>
                    <th className="pb-3 pt-1">Status</th>
                    <th className="pb-3 pt-1">Chunks</th>
                    <th className="pb-3 pt-1">Uploaded At</th>
                    <th className="pb-3 pt-1 pr-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {documents.map((doc) => {
                    const dateFormatted = new Date(doc.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    });

                    return (
                      <tr key={doc.id} className="text-[13px] hover:bg-[var(--color-bg-surface)] transition-all">
                        <td className="py-4 pl-2 font-medium">
                          <div className="flex items-center gap-2 max-w-[200px] sm:max-w-xs md:max-w-md truncate" title={doc.filename}>
                            <FileText className="w-4 h-4 text-[var(--color-accent-violet)] shrink-0" />
                            <span className="truncate">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="py-4 font-mono text-xs">v{doc.version}</td>
                        <td className="py-4">
                          <StatusBadge doc={doc} onShowError={(filename, msg) => setSelectedError({ filename, message: msg })} />
                        </td>
                        <td className="py-4 font-mono text-xs">
                          {doc.status === "ready" ? `${doc.chunkCount} chunks` : doc.status === "processing" ? "Counting..." : "—"}
                        </td>
                        <td className="py-4 text-[12px] text-[var(--color-text-secondary)]">{dateFormatted}</td>
                        <td className="py-4 pr-2 text-right">
                          <button
                            onClick={() => setDocToDelete(doc)}
                            className="p-1.5 rounded-lg bg-red-950/20 border border-red-950 hover:bg-red-900/40 text-red-400 hover:text-red-300 transition-all active:scale-90"
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
            <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-4 mt-6">
              <span className="text-[12px] text-[var(--color-text-secondary)] font-mono">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-[var(--color-bg-base)] disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-[var(--color-bg-base)] disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-elevated)] border border-red-900/50 rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-in fade-in zoom-in duration-200">
            <button 
              onClick={() => setSelectedError(null)} 
              className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-display font-bold text-lg">Ingestion Failed</h3>
            </div>
            <p className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2">
              File: <span className="text-white font-mono text-xs">{selectedError.filename}</span>
            </p>
            <div className="p-3 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg font-mono text-xs text-red-300 overflow-y-auto max-h-48 leading-relaxed break-words whitespace-pre-wrap">
              {selectedError.message}
            </div>
            <button 
              onClick={() => setSelectedError(null)} 
              className="mt-6 w-full py-2.5 bg-red-900 hover:bg-red-800 text-white rounded-xl text-[13px] font-semibold transition-colors"
            >
              Close Details
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="font-display font-bold text-lg text-white mb-2">Delete Document?</h3>
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              Are you sure you want to delete <span className="text-white font-semibold font-mono text-xs break-all">"{docToDelete.filename}"</span>? This will permanently erase the document metadata and all **{docToDelete.chunkCount} vector chunks** in the AI memory. This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDocToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-[var(--color-bg-base)] hover:bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-white rounded-xl text-[13px] font-semibold border border-[var(--color-border-subtle)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDoc}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
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
  onShowError 
}: { 
  doc: KnowledgeDocument; 
  onShowError: (filename: string, message: string) => void;
}) {
  switch (doc.status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium font-mono bg-emerald-950/30 text-emerald-400 border border-emerald-900/50">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          Ready
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium font-mono bg-blue-950/30 text-blue-400 border border-blue-900/50">
          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
          Processing
        </span>
      );
    case "failed":
      return (
        <button
          type="button"
          onClick={() => onShowError(doc.filename, doc.errorMessage || "Unknown error during ingestion")}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium font-mono bg-red-950/30 hover:bg-red-900/20 text-red-400 border border-red-900/50 cursor-pointer transition-all active:scale-95 text-left"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          Failed (details)
        </button>
      );
    case "superseded":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium font-mono bg-gray-950/30 text-gray-400 border border-gray-900/50 opacity-60">
          Superseded
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium font-mono bg-gray-900/30 text-gray-500 border border-gray-800">
          Unknown
        </span>
      );
  }
}
