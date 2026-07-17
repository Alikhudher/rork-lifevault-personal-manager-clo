import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CloudUpload, FileImage, FileText, FolderOpen, Plus, Search, Trash2 } from "lucide-react";
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
import { DocStatusBadge } from "@/components/lifevault/StatusBadge";
import { CategoryBubble, DOCUMENT_META } from "@/components/lifevault/category-meta";
import { useApp } from "@/context/AppContext";
import { daysUntil, daysUntilLabel, documentStatus, formatDate } from "@/lib/format";
import {
  DOCUMENT_CATEGORIES,
  REMINDER_OPTIONS,
  type DocumentCategory,
  type DocumentStatus,
  type FileKind,
  type ReminderDays,
  type VaultDocument,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | DocumentStatus;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
];

interface DocFormState {
  name: string;
  category: DocumentCategory;
  issueDate: string;
  expiryDate: string;
  notes: string;
  reminderDays: ReminderDays;
  fileName: string | null;
  fileKind: FileKind;
}

const EMPTY_FORM: DocFormState = {
  name: "",
  category: "ID",
  issueDate: "",
  expiryDate: "",
  notes: "",
  reminderDays: 30,
  fileName: null,
  fileKind: "pdf",
};

function kindFromFile(file: File): FileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  return "doc";
}

export default function Documents() {
  const { documents, addDocument, updateDocument, deleteDocument } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<"All" | DocumentCategory>("All");
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DocFormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditingId(null);
      setForm(EMPTY_FORM);
      setSheetOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    return documents
      .filter((doc) => {
        if (status !== "all" && documentStatus(doc) !== status) return false;
        if (category !== "All" && doc.category !== category) return false;
        if (query.trim()) {
          const q = query.trim().toLowerCase();
          return (
            doc.name.toLowerCase().includes(q) ||
            doc.category.toLowerCase().includes(q) ||
            doc.notes.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const aExp = a.expiryDate ? daysUntil(a.expiryDate) : Number.MAX_SAFE_INTEGER;
        const bExp = b.expiryDate ? daysUntil(b.expiryDate) : Number.MAX_SAFE_INTEGER;
        return aExp - bExp;
      });
  }, [documents, status, category, query]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  };

  const openEdit = (doc: VaultDocument) => {
    setEditingId(doc.id);
    setForm({
      name: doc.name,
      category: doc.category,
      issueDate: doc.issueDate ?? "",
      expiryDate: doc.expiryDate ?? "",
      notes: doc.notes,
      reminderDays: doc.reminderDays,
      fileName: doc.fileName,
      fileKind: doc.fileKind,
    });
    setSheetOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error("Enter a document name");
      return;
    }
    const payload = {
      name: form.name.trim(),
      category: form.category,
      issueDate: form.issueDate || null,
      expiryDate: form.expiryDate || null,
      notes: form.notes.trim(),
      reminderDays: form.reminderDays,
      fileName: form.fileName,
      fileKind: form.fileKind,
    };
    if (editingId) {
      updateDocument(editingId, payload);
      toast.success("Document updated");
    } else {
      addDocument(payload);
      toast.success("Document added to your vault");
    }
    setSheetOpen(false);
  };

  const handleDelete = () => {
    if (!editingId) return;
    deleteDocument(editingId);
    setConfirmDelete(false);
    setSheetOpen(false);
    toast.success("Document deleted");
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Documents"
        subtitle={`${documents.length} stored securely`}
        actions={
          <Button size="icon" onClick={openAdd} aria-label="Add document" className="h-10 w-10 rounded-full shadow-md shadow-primary/20">
            <Plus className="h-5 w-5" />
          </Button>
        }
      />

      {/* Search */}
      <div className="px-4 pt-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-xl bg-card pl-10"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="px-4 pt-3">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatus(tab.value)}
              className={cn(
                "rounded-lg py-1.5 text-[12.5px] font-bold transition-all",
                status === tab.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category chips */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pt-3">
        {(["All", ...DOCUMENT_CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-all active:scale-95",
              category === cat
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2.5 px-4 pt-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-card py-14 text-center shadow-sm ring-1 ring-border">
            <FolderOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-[15px] font-bold">No documents found</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Try a different search or add a new document.</p>
            <Button onClick={openAdd} className="mt-4 rounded-xl font-bold">
              <Plus className="mr-1 h-4 w-4" /> Add Document
            </Button>
          </div>
        ) : (
          filtered.map((doc) => {
            const docStatus = documentStatus(doc);
            return (
              <button
                key={doc.id}
                onClick={() => openEdit(doc)}
                className="flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.99]"
              >
                <CategoryBubble meta={DOCUMENT_META[doc.category]} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-bold">{doc.name}</p>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    {doc.fileKind === "image" ? (
                      <FileImage className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {doc.category}
                    {doc.expiryDate && (
                      <>
                        {" · "}
                        {docStatus === "expired"
                          ? `Expired ${daysUntilLabel(doc.expiryDate)}`
                          : `Expires ${daysUntilLabel(doc.expiryDate)}`}
                      </>
                    )}
                  </p>
                </div>
                <DocStatusBadge status={docStatus} />
              </button>
            );
          })
        )}
      </div>

      {/* Add / Edit sheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingId ? "Edit Document" : "Add Document"}
        description={editingId ? undefined : "Store a document and get reminded before it expires."}
      >
        <div className="space-y-4">
          {/* Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setForm((f) => ({
                  ...f,
                  fileName: file.name,
                  fileKind: kindFromFile(file),
                  name: f.name || file.name.replace(/\.[^.]+$/, ""),
                }));
                toast.success(`"${file.name}" attached`);
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-secondary/50 px-4 py-4 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-foreground">
              <CloudUpload className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">
                {form.fileName ?? "Upload a file"}
              </span>
              <span className="block text-[12px] text-muted-foreground">PDF, image or document</span>
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
            <ChipPicker
              options={REMINDER_OPTIONS}
              value={form.reminderDays}
              onChange={(reminderDays) => setForm((f) => ({ ...f, reminderDays }))}
              render={(days) => `${days} days`}
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

          {editingId && form.expiryDate && (
            <p className="text-[13px] text-muted-foreground">
              Expires {formatDate(form.expiryDate)} ({daysUntilLabel(form.expiryDate)})
            </p>
          )}

          <div className="flex gap-3 pt-1">
            {editingId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                className="h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete document"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Button onClick={handleSave} className="h-12 flex-1 rounded-xl text-[15px] font-bold shadow-md shadow-primary/20">
              {editingId ? "Save Changes" : "Add Document"}
            </Button>
          </div>
        </div>
      </FormSheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove it from your vault. This action cannot be undone.
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
