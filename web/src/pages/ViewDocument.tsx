import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  Clock,
  Download,
  Edit3,
  FileImage,
  FileText,
  FolderOpen,
  Minimize2,
  Pencil,
  Share2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { ChipPicker, Field, FormSheet } from "@/components/lifevault/FormSheet";
import { ReminderDaysPicker } from "@/components/lifevault/ReminderPicker";
import { DocStatusBadge } from "@/components/lifevault/StatusBadge";
import { CategoryBubble, DOCUMENT_META } from "@/components/lifevault/category-meta";
import { useApp } from "@/context/AppContext";
import { daysUntilLabel, documentStatus, formatDate } from "@/lib/format";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type FileKind,
  type ReminderDays,
  type VaultDocument,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { shareDocument } from "@/lib/share";
import { loadFileData } from "@/lib/file-store";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface DocFormState {
  name: string;
  category: DocumentCategory;
  issueDate: string;
  expiryDate: string;
  notes: string;
  reminderDays: ReminderDays;
  fileName: string | null;
  fileKind: FileKind;
  fileData: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function kindFromFile(file: File): FileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  return "doc";
}

/** Reads a File as a data URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Triggers a download from a data URL. */
function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName || "document";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ------------------------------------------------------------------ */
/* Pinch-zoom image viewer                                             */
/* ------------------------------------------------------------------ */

interface TouchPoint {
  x: number;
  y: number;
}

function PinchZoomImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startDistRef = useRef<number>(0);
  const startScaleRef = useRef<number>(1);
  const startOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTouchRef = useRef<TouchPoint | null>(null);
  const pinchActiveRef = useRef<boolean>(false);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(s + 0.5, 5));
  }, []);
  const zoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(s - 0.5, 1);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        startDistRef.current = Math.hypot(dx, dy);
        startScaleRef.current = scale;
        startOffsetRef.current = offset;
        pinchActiveRef.current = true;
        lastTouchRef.current = null;
      } else if (e.touches.length === 1 && scale > 1) {
        lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    },
    [scale, offset],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchActiveRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (startDistRef.current > 0) {
          const ratio = dist / startDistRef.current;
          const newScale = Math.min(Math.max(startScaleRef.current * ratio, 1), 5);
          setScale(newScale);
          if (newScale === 1) setOffset({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && lastTouchRef.current && scale > 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - lastTouchRef.current.x;
        const dy = e.touches[0].clientY - lastTouchRef.current.y;
        setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
        lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    },
    [scale],
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchActiveRef.current = false;
    }
    if (e.touches.length === 0) {
      lastTouchRef.current = null;
    }
    if (e.touches.length === 1) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);

  // Double-tap to toggle zoom
  const lastTapRef = useRef<number>(0);
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scale > 1) {
        reset();
      } else {
        setScale(2.5);
      }
    }
    lastTapRef.current = now;
  }, [scale, reset]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Image viewport */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-900/95 dark:bg-black"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleDoubleTap}
        style={{ touchAction: "none" }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
        />
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card/95 px-1.5 py-1.5 shadow-lg ring-1 ring-border backdrop-blur-xl">
        <button
          onClick={zoomOut}
          disabled={scale <= 1}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors disabled:opacity-30 active:scale-90"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <span className="min-w-[48px] text-center text-[12px] font-bold tabular text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          disabled={scale >= 5}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors disabled:opacity-30 active:scale-90"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <button
          onClick={reset}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors active:scale-90"
          aria-label="Reset zoom"
        >
          <Minimize2 className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PDF viewer with zoom                                               */
/* ------------------------------------------------------------------ */

function PdfViewer({ src, fileName }: { src: string; fileName: string }) {
  const [zoom, setZoom] = useState<number>(100);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const zoomIn = () => setZoom((z) => Math.min(z + 25, 300));
  const zoomOut = () => setZoom((z) => Math.max(z - 25, 50));

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-neutral-200 dark:bg-neutral-800">
      <div ref={containerRef} className="flex-1 overflow-auto">
        <embed
          src={`${src}#toolbar=0&navpanes=0&view=FitH&zoom=${zoom}`}
          type="application/pdf"
          className="border-0"
          style={{
            width: `${(containerWidth * zoom) / 100}px`,
            height: "100%",
            minHeight: "100%",
          }}
          aria-label={fileName}
        />
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card/95 px-1.5 py-1.5 shadow-lg ring-1 ring-border backdrop-blur-xl">
        <button
          onClick={zoomOut}
          disabled={zoom <= 50}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors disabled:opacity-30 active:scale-90"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <span className="min-w-[48px] text-center text-[12px] font-bold tabular text-muted-foreground">
          {zoom}%
        </span>
        <button
          onClick={zoomIn}
          disabled={zoom >= 300}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors disabled:opacity-30 active:scale-90"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main View Document page                                            */
/* ------------------------------------------------------------------ */

export default function ViewDocument() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { documents, updateDocument, deleteDocument } = useApp();

  const doc = useMemo<VaultDocument | undefined>(
    () => documents.find((d) => d.id === id),
    [documents, id],
  );

  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [form, setForm] = useState<DocFormState>(getEmptyForm());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const docStatus = doc ? documentStatus(doc) : "active";

  /* ---- Edit handlers ---- */

  const openEdit = useCallback(() => {
    if (!doc) return;
    setForm({
      name: doc.name,
      category: doc.category,
      issueDate: doc.issueDate ?? "",
      expiryDate: doc.expiryDate ?? "",
      notes: doc.notes,
      reminderDays: doc.reminderDays,
      fileName: doc.fileName,
      fileKind: doc.fileKind,
      fileData: doc.fileData ?? null,
    });
    setEditOpen(true);
  }, [doc]);

  const handleSave = useCallback(() => {
    if (!doc) return;
    if (!form.name.trim()) {
      toast.error("Enter a document name");
      return;
    }
    updateDocument(doc.id, {
      name: form.name.trim(),
      category: form.category,
      issueDate: form.issueDate || null,
      expiryDate: form.expiryDate || null,
      notes: form.notes.trim(),
      reminderDays: form.reminderDays,
      fileName: form.fileName,
      fileKind: form.fileKind,
      fileData: form.fileData,
    });
    toast.success("Document updated");
    setEditOpen(false);
  }, [doc, form, updateDocument]);

  const handleDelete = useCallback(() => {
    if (!doc) return;
    deleteDocument(doc.id);
    setConfirmDelete(false);
    setEditOpen(false);
    toast.success("Document deleted");
    navigate("/documents", { replace: true });
  }, [doc, deleteDocument, navigate]);

  /* ---- Action handlers ---- */

  const handleShare = useCallback(async () => {
    if (!doc) return;
    // fileData may not be hydrated from IndexedDB yet — load it on demand.
    const fileData = doc.fileData ?? (await loadFileData(doc.id));
    await shareDocument({
      title: doc.name,
      text: doc.notes || `${doc.name} — ${doc.category}`,
      fileData,
      fileName: doc.fileName ?? `${doc.name}`,
    });
  }, [doc]);

  const handleDownload = useCallback(() => {
    if (!doc) return;
    if (doc.fileData) {
      downloadDataUrl(doc.fileData, doc.fileName ?? `${doc.name}`);
      toast.success("Download started");
    } else {
      toast.info("No file attached to this document");
    }
  }, [doc]);

  /* ---- Not found ---- */

  if (!doc) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
        <p className="mt-4 text-[17px] font-bold">Document not found</p>
        <p className="mt-1 text-[14px] text-muted-foreground">
          This document may have been deleted.
        </p>
        <Button onClick={() => navigate("/documents")} className="mt-6 rounded-xl font-bold">
          Back to Documents
        </Button>
      </div>
    );
  }

  const meta = DOCUMENT_META[doc.category];
  const hasFile = Boolean(doc.fileData);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <PageHeader
        title={doc.name}
        subtitle={doc.category}
        back
        actions={
          <button
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete document"
            className="-me-1 flex h-10 w-10 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10 active:scale-95"
          >
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>
        }
      />

      {/* Document display area */}
      <div className="flex flex-1 flex-col">
        {hasFile && doc.fileKind === "image" && doc.fileData ? (
          <PinchZoomImage src={doc.fileData} alt={doc.name} />
        ) : hasFile && doc.fileKind === "pdf" && doc.fileData ? (
          <PdfViewer src={doc.fileData} fileName={doc.fileName ?? doc.name} />
        ) : hasFile && doc.fileData ? (
          /* Generic/doc file — show in a text reading view if it's text, otherwise a download card */
          <TextReadingView doc={doc} />
        ) : (
          /* No file attached — show metadata-only card */
          <NoFilePlaceholder doc={doc} onEdit={openEdit} />
        )}
      </div>

      {/* Metadata card (always visible) */}
      <div className="space-y-3 px-4 pb-6 pt-4">
        {/* Status + dates */}
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CategoryBubble meta={meta} size="lg" />
              <div>
                <p className="text-[15px] font-bold">{doc.name}</p>
                <p className="text-[12.5px] text-muted-foreground">{doc.category}</p>
              </div>
            </div>
            <DocStatusBadge status={docStatus} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {doc.issueDate && (
              <div className="rounded-xl bg-secondary/50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Calendar className="h-3 w-3" /> Issue Date
                </p>
                <p className="mt-0.5 text-[14px] font-bold">{formatDate(doc.issueDate)}</p>
              </div>
            )}
            {doc.expiryDate && (
              <div className="rounded-xl bg-secondary/50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Clock className="h-3 w-3" /> Expiry Date
                </p>
                <p className="mt-0.5 text-[14px] font-bold">{formatDate(doc.expiryDate)}</p>
                <p
                  className={cn(
                    "mt-0.5 text-[11px] font-semibold",
                    docStatus === "expired"
                      ? "text-destructive"
                      : docStatus === "expiring"
                        ? "text-warning"
                        : "text-muted-foreground",
                  )}
                >
                  {daysUntilLabel(doc.expiryDate)}
                </p>
              </div>
            )}
          </div>

          {doc.notes && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="text-[11px] font-semibold text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
                {doc.notes}
              </p>
            </div>
          )}

          {doc.fileName && (
            <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
              {doc.fileKind === "image" ? (
                <FileImage className="h-4 w-4 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground" />
              )}
              <p className="truncate text-[12.5px] text-muted-foreground">{doc.fileName}</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-2.5">
          <ActionButton
            icon={Edit3}
            label="Edit"
            onClick={openEdit}
            primary
          />
          <ActionButton
            icon={Share2}
            label="Share"
            onClick={handleShare}
          />
          <ActionButton
            icon={Download}
            label="Download"
            onClick={handleDownload}
            disabled={!hasFile}
          />
          <ActionButton
            icon={Trash2}
            label="Delete"
            onClick={() => setConfirmDelete(true)}
            danger
          />
        </div>
      </div>

      {/* Edit sheet */}
      <FormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit Document"
      >
        <div className="space-y-4">
          {/* Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                try {
                  const dataUrl = await readFileAsDataUrl(file);
                  setForm((f) => ({
                    ...f,
                    fileName: file.name,
                    fileKind: kindFromFile(file),
                    fileData: dataUrl,
                    name: f.name || file.name.replace(/\.[^.]+$/, ""),
                  }));
                  toast.success(`"${file.name}" attached`);
                } catch {
                  toast.error("Could not read this file");
                }
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-secondary/50 px-4 py-4 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-foreground">
              {form.fileKind === "image" ? (
                <FileImage className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">
                {form.fileName ?? "Upload a file"}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {form.fileData ? "Tap to replace" : "PDF, image or document"}
              </span>
            </span>
          </button>

          <Field label="Document name">
            <Input
              placeholder="e.g. Australian Passport"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-12 rounded-xl"
            />
          </Field>

          <Field label="Category">
            <ChipPicker
              options={DOCUMENT_CATEGORIES}
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date">
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label="Expiry date">
              <Input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
          </div>

          <Field label="Remind me before expiry">
            <ReminderDaysPicker
              value={form.reminderDays}
              onChange={(reminderDays) => setForm((f) => ({ ...f, reminderDays }))}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              placeholder="Policy numbers, renewal details..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="min-h-[80px] rounded-xl"
            />
          </Field>

          {form.expiryDate && (
            <p className="text-[13px] text-muted-foreground">
              Expires {formatDate(form.expiryDate)} ({daysUntilLabel(form.expiryDate)})
            </p>
          )}

          <Button
            onClick={handleSave}
            className="h-12 w-full rounded-xl text-[15px] font-bold shadow-md shadow-primary/20"
          >
            Save Changes
          </Button>
        </div>
      </FormSheet>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{doc.name}" from your vault. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function getEmptyForm(): DocFormState {
  return {
    name: "",
    category: "ID",
    issueDate: "",
    expiryDate: "",
    notes: "",
    reminderDays: 30,
    fileName: null,
    fileKind: "pdf",
    fileData: null,
  };
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  primary,
  danger,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl py-3 transition-all active:scale-95",
        "shadow-sm ring-1 ring-border",
        primary && "bg-primary text-primary-foreground ring-primary",
        danger && "bg-destructive/10 text-destructive ring-destructive/20",
        !primary && !danger && "bg-card text-foreground",
        disabled && "opacity-40",
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={2.2} />
      <span className="text-[11.5px] font-bold">{label}</span>
    </button>
  );
}

/** Clean reading view for text-based documents. */
function TextReadingView({ doc }: { doc: VaultDocument }) {
  const fileData = doc.fileData!;
  const [textContent, setTextContent] = useState<string>("");

  useEffect(() => {
    // Try to decode text content from the data URL
    try {
      const commaIdx = fileData.indexOf(",");
      const base64 = commaIdx >= 0 ? fileData.slice(commaIdx + 1) : fileData;
      const decoded = atob(base64);
      // Check if it's printable text (not binary)
      const printable = decoded.slice(0, 1000).replace(/[^\x20-\x7E\n\r\t]/g, "");
      if (printable.length > decoded.length * 0.7) {
        setTextContent(decoded);
      } else {
        setTextContent("");
      }
    } catch {
      setTextContent("");
    }
  }, [fileData]);

  if (textContent) {
    return (
      <div className="flex-1 overflow-y-auto bg-background px-5 py-6">
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-foreground">
            {textContent}
          </pre>
        </article>
      </div>
    );
  }

  // Binary document — show download card
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-secondary/30 px-6 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary dark:text-foreground">
        <FileText className="h-8 w-8" strokeWidth={2} />
      </span>
      <p className="mt-4 text-[15px] font-bold">{doc.fileName ?? "Document"}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        This file type can't be previewed. Download to view it.
      </p>
    </div>
  );
}

/** Placeholder shown when a document has no file attached. */
function NoFilePlaceholder({
  doc,
  onEdit,
}: {
  doc: VaultDocument;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-secondary/30 px-6 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
        <FolderOpen className="h-8 w-8" strokeWidth={2} />
      </span>
      <p className="mt-4 text-[15px] font-bold">No file attached</p>
      <p className="mt-1 max-w-[240px] text-[13px] text-muted-foreground">
        This document doesn't have an uploaded file. Add one by editing.
      </p>
      <Button
        onClick={onEdit}
        variant="outline"
        className="mt-5 rounded-xl font-bold"
      >
        <Pencil className="mr-1.5 h-4 w-4" /> Add File
      </Button>
    </div>
  );
}
