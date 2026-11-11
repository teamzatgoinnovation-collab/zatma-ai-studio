'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeft,
  Check,
  CloudOff,
  CopyPlus,
  Download,
  Send,
  Grid3x3,
  History,
  Languages,
  LayoutTemplate,
  Loader2,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Skeleton,
  Tabs,
} from '@zatma/ui';
import { LANGUAGE_FONTS, type BrandKitDto, type DesignDetail, type DesignDocument, type DesignLayer, type DesignVersionSummary, type TextLayer } from '@zatma/validation';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { DesignCanvas, type DesignCanvasHandle } from './design-canvas';
import { buildPdf, dataUrlToBlob, downloadBlob, exportFileName, type ExportFormat } from './export';
import { defaultFontFor, fontStack, GOOGLE_FONTS_HREF, loadFonts } from './fonts';
import { fitScale, nextZoom } from './geometry';
import { AiRewriteMenu, TranslateDesignDialog } from './ai-tools';
import { AddPanel, BackgroundPanel, CopyPanel, LayersPanel, PropertiesPanel } from './panels';
import { editorReducer, initialState, type AlignMode } from './state';

const AUTOSAVE_MS = 1200;
const THUMBNAIL_EVERY_MS = 30_000;

const newLayerId = () => `l-${crypto.randomUUID()}`;

/** Relative luminance check used to pick readable default colours for new text. */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

const baseColor = (doc: DesignDocument) =>
  doc.background.type === 'color' ? doc.background.color : doc.background.type === 'gradient' ? doc.background.from : doc.background.overlay ? doc.background.overlay.color : doc.background.fallbackColor;

const describeError = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Loads an image file's natural size (for placing uploads at their aspect ratio). */
const imageSize = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 400 });
    img.onerror = () => resolve({ width: 400, height: 400 });
    img.src = url;
  });

// ───────────── Route component ─────────────

export function DesignEditor({ designId }: { designId: string }) {
  const qc = useQueryClient();
  const [reloadKey, setReloadKey] = useState(0);
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const design = useQuery({
    queryKey: ['design', designId],
    queryFn: () => api.designs.get(designId),
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.status === 'GENERATING' ? 1500 : false),
  });
  const brandKits = useQuery({ queryKey: ['brand-kits'], queryFn: api.brandKits.list });

  if (design.isPending || org.isPending) return <Skeleton className="h-[70vh]" />;
  if (design.isError) {
    const missing = design.error instanceof ApiError && design.error.status === 404;
    return (
      <ErrorState
        title={missing ? 'Design not found' : 'Could not open this design'}
        description={missing ? 'It may have been deleted, or it belongs to another organization.' : describeError(design.error)}
        onRetry={missing ? undefined : () => void design.refetch()}
      />
    );
  }

  const d = design.data;
  if (d.status === 'GENERATING') return <Generating prompt={d.prompt} />;
  if (d.status === 'FAILED') {
    return (
      <EmptyState
        title="This design could not be generated"
        description={
          <>
            <span className="block">{d.error?.message ?? 'The AI provider returned an error.'}</span>
            {d.error?.code && <span className="mt-1 block font-mono text-xs">{d.error.code}</span>}
          </>
        }
        action={
          <Button asChild>
            <Link href="/studio/design">Try again</Link>
          </Button>
        }
      />
    );
  }

  const perms = new Set(org.data?.permissions ?? []);
  const readOnly = !perms.has('design:write');
  const canAi = !readOnly && perms.has('ai:generate');
  const canSaveCopy = perms.has('copy:write');
  const kit = brandKits.data?.find((k) => k.id === d.brandKitId) ?? brandKits.data?.find((k) => k.isDefault) ?? null;

  return (
    <EditorWorkspace
      key={`${d.id}:${reloadKey}`}
      detail={d}
      readOnly={readOnly}
      canAi={canAi}
      canSaveCopy={canSaveCopy}
      brandKit={kit}
      onReplace={(next) => {
        qc.setQueryData(['design', designId], next);
        setReloadKey((k) => k + 1);
      }}
      onReload={async () => {
        await design.refetch();
        setReloadKey((k) => k + 1);
      }}
    />
  );
}

function Generating({ prompt }: { prompt: string | null }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center" role="status" aria-live="polite">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Loader2 className="size-7 animate-spin" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-semibold">Creating your design…</h1>
      <p className="text-sm text-muted-foreground">Writing the copy, preparing the background and laying out editable layers. This usually takes under a minute.</p>
      {prompt && <p className="rounded-xl bg-muted px-4 py-3 text-sm">“{prompt}”</p>}
    </div>
  );
}

// ───────────── Workspace ─────────────

type LeftTab = 'layers' | 'add' | 'background' | 'copy';

function EditorWorkspace({
  detail,
  readOnly,
  canAi,
  canSaveCopy,
  brandKit,
  onReplace,
  onReload,
}: {
  detail: DesignDetail;
  readOnly: boolean;
  canAi: boolean;
  canSaveCopy: boolean;
  brandKit: BrandKitDto | null;
  onReplace: (d: DesignDetail) => void;
  onReload: () => Promise<void>;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(editorReducer, detail.document, initialState);
  const { doc, selectedId } = state;
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;

  const [assets, setAssets] = useState(detail.assets);
  const [title, setTitle] = useState(detail.title);
  const [titleEdits, setTitleEdits] = useState(0);
  const [leftTab, setLeftTab] = useState<LeftTab>('layers');
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [showGrid, setShowGrid] = useState(false);
  const [fontEpoch, setFontEpoch] = useState(0);
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<{ layer: TextLayer; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const [dialog, setDialog] = useState<'versions' | 'template' | 'translate' | null>(null);

  // Save bookkeeping. `changeKey` grows on every document or title edit.
  const changeKey = state.version + titleEdits;
  const [savedKey, setSavedKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = changeKey !== savedKey;

  const canvasRef = useRef<DesignCanvasHandle>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const live = useRef({ doc, title, changeKey, savedKey, revision: detail.revision, saving: false, conflict: false, lastThumb: 0 });
  useEffect(() => {
    Object.assign(live.current, { doc, title, changeKey, savedKey, conflict });
  });

  const scale = zoom === 'fit' ? fitScale(doc.width, doc.height, viewport.width, viewport.height, 32) : zoom;

  // Viewport size for "fit" zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Make sure every font used by text layers is loaded before Konva measures text.
  const fontKey = useMemo(
    () =>
      [...new Set(doc.layers.flatMap((l) => (l.type === 'text' ? [`${l.fontFamily}|${l.fontWeight}`] : [])))]
        .sort()
        .join(','),
    [doc.layers],
  );
  useEffect(() => {
    let alive = true;
    const specs = fontKey ? fontKey.split(',').map((k) => ({ family: k.split('|')[0]!, weight: Number(k.split('|')[1]) })) : [];
    void loadFonts(specs).then(() => alive && setFontEpoch((e) => e + 1));
    return () => {
      alive = false;
    };
  }, [fontKey]);

  const uploadThumbnail = useCallback(async () => {
    if (readOnly || !canvasRef.current) return;
    live.current.lastThumb = Date.now();
    try {
      const url = canvasRef.current.toDataURL({ mimeType: 'image/jpeg', quality: 0.8, targetWidth: 480 });
      const fileId = await uploadFile(new File([dataUrlToBlob(url)], 'thumbnail.jpg', { type: 'image/jpeg' }), 'THUMBNAIL');
      await api.designs.setThumbnail(detail.id, fileId);
      await qc.invalidateQueries({ queryKey: ['designs'] });
    } catch {
      // Thumbnails are best-effort; the library shows a placeholder without one.
    }
  }, [detail.id, qc, readOnly]);

  /** Sends the latest title + document; re-runs if more edits arrive while saving. */
  const flush = useCallback(async (): Promise<boolean> => {
    const l = live.current;
    if (readOnly || l.conflict) return false;
    if (l.saving || l.changeKey === l.savedKey) return true;
    l.saving = true;
    setSaving(true);
    const key = l.changeKey;
    try {
      const res = await api.designs.update(detail.id, { revision: l.revision, title: l.title.trim() || 'Untitled design', document: l.doc });
      l.revision = res.revision;
      l.savedKey = key;
      setSavedKey(key);
      setSaveError(false);
      setAssets((a) => ({ ...a, ...res.assets }));
      if (Date.now() - l.lastThumb > THUMBNAIL_EVERY_MS) void uploadThumbnail();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        l.conflict = true;
        setConflict(true);
      } else {
        setSaveError(true);
        toast.error(`Couldn't save: ${describeError(e)}`);
      }
      return false;
    } finally {
      l.saving = false;
      setSaving(false);
      if (!l.conflict && l.changeKey !== l.savedKey && l.savedKey === key) void flushRef.current();
    }
  }, [detail.id, readOnly, uploadThumbnail]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Debounced autosave.
  useEffect(() => {
    if (changeKey === 0 || readOnly) return;
    const t = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [changeKey, readOnly]);

  // Save on leave; warn when closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (live.current.changeKey !== live.current.savedKey && !live.current.conflict) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flushRef.current();
    };
  }, []);

  // First thumbnail for freshly generated designs, once fonts and images have had a moment to load.
  useEffect(() => {
    if (detail.thumbnailUrl || readOnly || fontEpoch !== 1) return;
    const t = setTimeout(() => void uploadThumbnail(), 2000);
    return () => clearTimeout(t);
  }, [detail.thumbnailUrl, readOnly, fontEpoch, uploadThumbnail]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      if (readOnly) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      const id = live.current.doc.layers.some((l) => l.id === selectedId) ? selectedId : null;
      if (!id) return;
      if (e.key === 'Escape') dispatch({ type: 'select', id: null });
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'removeLayer', id });
      } else if (mod && key === 'd') {
        e.preventDefault();
        dispatch({ type: 'duplicateLayer', id, newId: newLayerId() });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        dispatch({ type: 'nudge', id, dx, dy });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, selectedId]);

  // ── Layer factories ──
  const addText = (role: 'headline' | 'body') => {
    const fs = Math.round(doc.width / (role === 'headline' ? 13 : 26));
    const lang = LANGUAGE_FONTS[detail.language] ?? LANGUAGE_FONTS.en!;
    const layer: TextLayer = {
      id: newLayerId(),
      type: 'text',
      role,
      x: Math.round(doc.width * 0.1),
      y: Math.round(doc.height * 0.42),
      width: Math.round(doc.width * 0.8),
      height: Math.round(fs * 1.25 * (role === 'headline' ? 1 : 3)),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      text: role === 'headline' ? 'Your headline' : 'Add a short description of your offer.',
      fontFamily: role === 'headline' ? defaultFontFor(detail.language) : lang.body,
      fontSize: fs,
      fontWeight: role === 'headline' ? 700 : 400,
      fill: isDark(baseColor(doc)) ? '#FFFFFF' : '#111827',
      align: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      direction: lang.rtl ? 'rtl' : 'ltr',
    };
    dispatch({ type: 'addLayer', layer });
  };

  const addShape = (shape: 'rect' | 'ellipse') => {
    const s = Math.round(Math.min(doc.width, doc.height) * 0.3);
    dispatch({
      type: 'addLayer',
      layer: { id: newLayerId(), type: 'shape', role: 'decoration', shape, x: Math.round((doc.width - s) / 2), y: Math.round((doc.height - s) / 2), width: s, height: s, rotation: 0, opacity: 1, visible: true, locked: false, fill: '#6366F1', strokeWidth: 0, cornerRadius: shape === 'rect' ? Math.round(s * 0.08) : 0 },
    });
  };

  const placeImage = async (fileId: string, url: string, role: 'product' | 'logo') => {
    const nat = await imageSize(url);
    const max = Math.min(doc.width, doc.height) * (role === 'logo' ? 0.22 : 0.5);
    const k = Math.min(max / nat.width, max / nat.height);
    const width = Math.max(8, Math.round(nat.width * k));
    const height = Math.max(8, Math.round(nat.height * k));
    setAssets((a) => ({ ...a, [fileId]: url }));
    dispatch({
      type: 'addLayer',
      layer: { id: newLayerId(), type: 'image', role, fileId, fit: 'contain', cornerRadius: 0, x: Math.round((doc.width - width) / 2), y: Math.round((doc.height - height) / 2), width, height, rotation: 0, opacity: 1, visible: true, locked: false },
    });
  };

  const upload = async (file: File): Promise<{ fileId: string; url: string } | null> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a PNG, JPG or WebP image.');
      return null;
    }
    setUploading(true);
    try {
      const fileId = await uploadFile(file, 'DESIGN_ASSET');
      return { fileId, url: URL.createObjectURL(file) };
    } catch (e) {
      toast.error(`Upload failed: ${describeError(e)}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  // ── Export ──
  const exportAs = async (format: ExportFormat) => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const blob =
        format === 'pdf'
          ? await buildPdf(c.toDataURL({ mimeType: 'image/jpeg', quality: 0.95 }), doc.width, doc.height)
          : dataUrlToBlob(c.toDataURL({ mimeType: format === 'png' ? 'image/png' : 'image/jpeg', quality: 0.92 }));
      downloadBlob(blob, exportFileName(title, format, doc.width, doc.height));
      toast.success(`Exported ${format.toUpperCase()} (${doc.width}×${doc.height})`);
      void uploadThumbnail();
    } catch (e) {
      toast.error(
        (e as Error).name === 'SecurityError'
          ? 'An image in this design could not be read for export. Check that the storage bucket allows cross-origin GET from this site.'
          : `Export failed: ${(e as Error).message}`,
      );
    }
  };

  const align = (mode: AlignMode) => selectedId && dispatch({ type: 'align', id: selectedId, mode });

  const saveLabel = conflict ? 'Conflict' : saving ? 'Saving…' : saveError ? 'Not saved' : dirty ? 'Unsaved changes' : 'All changes saved';

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.5rem)]">
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to designs">
          <Link href="/studio/design">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-40 flex-1">
          <label htmlFor="design-title" className="sr-only">
            Design title
          </label>
          <input
            id="design-title"
            value={title}
            maxLength={120}
            readOnly={readOnly}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleEdits((n) => n + 1);
            }}
            className="w-full truncate rounded-lg bg-transparent px-2 py-1 text-base font-semibold hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="flex items-center gap-1 px-2 text-xs text-muted-foreground" aria-live="polite">
            {readOnly ? (
              'View only'
            ) : (
              <>
                {saving ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : saveError || conflict ? <CloudOff className="size-3" aria-hidden="true" /> : !dirty && <Check className="size-3" aria-hidden="true" />}
                {saveLabel}
              </>
            )}
            <span aria-hidden="true">·</span> {doc.width}×{doc.height}
          </p>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
              <Undo2 aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
              <Redo2 aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1 rounded-xl border border-border p-0.5">
          <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom out" onClick={() => setZoom(nextZoom(scale, -1))}>
            <Minus aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" className="w-16 tabular-nums" aria-label={`Zoom ${Math.round(scale * 100)}%, fit to screen`} onClick={() => setZoom('fit')}>
            {Math.round(scale * 100)}%
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom in" onClick={() => setZoom(nextZoom(scale, 1))}>
            <Plus aria-hidden="true" />
          </Button>
        </div>

        <Button variant={showGrid ? 'secondary' : 'ghost'} size="icon" aria-label="Toggle grid" aria-pressed={showGrid} onClick={() => setShowGrid((g) => !g)}>
          <Grid3x3 aria-hidden="true" />
        </Button>

        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Align selected layer" disabled={!selected || selected.locked}>
                <AlignCenterHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Align to canvas</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => align('left')}>
                <AlignStartVertical aria-hidden="true" /> Left
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('center')}>
                <AlignCenterVertical aria-hidden="true" /> Centre
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('right')}>
                <AlignEndVertical aria-hidden="true" /> Right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => align('top')}>
                <AlignStartHorizontal aria-hidden="true" /> Top
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('middle')}>
                <AlignCenterHorizontal aria-hidden="true" /> Middle
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('bottom')}>
                <AlignEndHorizontal aria-hidden="true" /> Bottom
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!readOnly && (
          <>
            <Button variant="ghost" size="icon" aria-label="Version history" title="Version history" onClick={() => setDialog('versions')}>
              <History aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Save as template" title="Save as template" onClick={() => setDialog('template')}>
              <LayoutTemplate aria-hidden="true" />
            </Button>
            {canAi && (
              <Button variant="ghost" size="icon" aria-label="Translate design" title="Translate design" onClick={() => setDialog('translate')}>
                <Languages aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Duplicate design"
              title="Duplicate design"
              onClick={async () => {
                if (!(await flush())) return;
                try {
                  const copy = await api.designs.duplicate(detail.id);
                  await qc.invalidateQueries({ queryKey: ['designs'] });
                  router.push(`/studio/design/${copy.id}`);
                } catch (e) {
                  toast.error(describeError(e));
                }
              }}
            >
              <CopyPlus aria-hidden="true" />
            </Button>
          </>
        )}

        {dirty || saving ? (
          <Button variant="outline" disabled title="Wait for the design to save">
            <Send aria-hidden="true" /> Schedule post
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={`/marketing/social/new?design=${detail.id}`}>
              <Send aria-hidden="true" /> Schedule post
            </Link>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Download aria-hidden="true" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              Full resolution · {doc.width}×{doc.height}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void exportAs('png')}>PNG (best quality)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportAs('jpg')}>JPG (smaller file)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportAs('pdf')}>PDF (print)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {conflict && (
        <Alert className="flex flex-wrap items-center justify-between gap-3">
          <span>This design was changed in another tab or by a teammate. Reload to get the latest version — edits made here since the last save will be lost.</span>
          <Button size="sm" variant="outline" onClick={() => void onReload()}>
            Reload design
          </Button>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        {/* Left panel */}
        <aside className="order-2 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:order-1" aria-label="Design tools">
          <div className="border-b border-border p-2">
            <Tabs
              label="Design tools"
              className="w-full [&>button]:flex-1 [&>button]:px-1"
              value={leftTab}
              onChange={(t) => setLeftTab(t as LeftTab)}
              items={[
                { id: 'layers', label: 'Layers' },
                ...(readOnly ? [] : [{ id: 'add', label: 'Add' }]),
                { id: 'background', label: 'Bg' },
                { id: 'copy', label: 'Copy' },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'layers' && <LayersPanel doc={doc} selectedId={selectedId} dispatch={dispatch} readOnly={readOnly} />}
            {leftTab === 'add' && !readOnly && (
              <AddPanel
                onAddText={addText}
                onAddShape={addShape}
                uploading={uploading}
                brandKit={brandKit}
                onUploadImage={async (f) => {
                  const r = await upload(f);
                  if (r) await placeImage(r.fileId, r.url, 'product');
                }}
                onAddLogo={() => brandKit?.logoFileId && brandKit.logoUrl && void placeImage(brandKit.logoFileId, brandKit.logoUrl, 'logo')}
              />
            )}
            {leftTab === 'background' && (
              <BackgroundPanel
                background={doc.background}
                readOnly={readOnly}
                uploading={uploading}
                onChange={(background) => dispatch({ type: 'setBackground', background })}
                onUpload={async (f) => {
                  const r = await upload(f);
                  if (!r) return;
                  setAssets((a) => ({ ...a, [r.fileId]: r.url }));
                  dispatch({ type: 'setBackground', background: { type: 'image', fileId: r.fileId, fit: 'cover', fallbackColor: baseColor(doc).slice(0, 7), overlay: { color: '#000000', opacity: 0.25 } } });
                }}
              />
            )}
            {leftTab === 'copy' && (
              <CopyPanel
                caption={detail.caption}
                hashtags={detail.hashtags}
                onSave={
                  canSaveCopy
                    ? async (kind, content, hashtags) => {
                        try {
                          await api.copyAssets.save({ kind, content, hashtags, language: detail.language as 'en', platform: 'instagram', sourceDesignId: detail.id });
                          await qc.invalidateQueries({ queryKey: ['copy-assets'] });
                          toast.success('Saved to your copy library');
                        } catch (e) {
                          toast.error(describeError(e));
                        }
                      }
                    : undefined
                }
              />
            )}
          </div>
        </aside>

        {/* Canvas */}
        <div
          ref={viewportRef}
          className="relative order-1 min-h-[60vh] overflow-auto rounded-2xl border border-border bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-[length:24px_24px] lg:order-2 lg:min-h-0"
        >
          <div className="grid min-h-full min-w-full place-items-center p-4" style={{ width: 'max-content', height: 'max-content' }}>
            <div className="relative shadow-xl">
              <DesignCanvas
                ref={canvasRef}
                doc={doc}
                assets={assets}
                scale={scale}
                selectedId={selectedId}
                showGrid={showGrid}
                readOnly={readOnly}
                fontEpoch={fontEpoch}
                onSelect={(id) => dispatch({ type: 'select', id })}
                onChange={(id, patch) => dispatch({ type: 'updateLayer', id, patch })}
                onEditText={(layer, rect) => setEditing({ layer, rect })}
              />
              {editing && (
                <InlineTextEditor
                  layer={editing.layer}
                  rect={editing.rect}
                  scale={scale}
                  onDone={(text) => {
                    if (text !== null && text !== editing.layer.text) dispatch({ type: 'updateLayer', id: editing.layer.id, patch: { text } });
                    setEditing(null);
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Properties */}
        <aside className="order-3 min-h-0 overflow-y-auto rounded-2xl border border-border bg-card" aria-label="Properties">
          {selected ? (
            <PropertiesPanel
              key={selected.id}
              layer={selected}
              dispatch={dispatch}
              readOnly={readOnly}
              onDuplicate={() => dispatch({ type: 'duplicateLayer', id: selected.id, newId: newLayerId() })}
              textTools={
                canAi
                  ? (l) => <AiRewriteMenu text={l.text} language={detail.language} disabled={l.locked} onApply={(text) => dispatch({ type: 'updateLayer', id: l.id, patch: { text } })} />
                  : undefined
              }
              onReplaceImage={async (f) => {
                const r = await upload(f);
                if (!r) return;
                setAssets((a) => ({ ...a, [r.fileId]: r.url }));
                dispatch({ type: 'updateLayer', id: selected.id, patch: { fileId: r.fileId } as Partial<DesignLayer> });
              }}
            />
          ) : (
            <div className="space-y-2 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nothing selected</p>
              <p>Click a layer on the canvas or in the Layers list to edit it. Double-click text to type directly on the design.</p>
              {!readOnly && (
                <ul className="list-disc space-y-1 pl-4 text-xs">
                  <li>Arrow keys nudge (Shift for 10px)</li>
                  <li>Delete removes the selected layer</li>
                  <li>Ctrl+Z / Ctrl+Shift+Z undo and redo</li>
                  <li>Ctrl+D duplicates</li>
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      <VersionsDialog
        open={dialog === 'versions'}
        onOpenChange={(o) => setDialog(o ? 'versions' : null)}
        designId={detail.id}
        flush={flush}
        onSaved={() => void uploadThumbnail()}
        onRestored={(d) => {
          setDialog(null);
          toast.success('Version restored');
          onReplace(d);
        }}
      />
      {canAi && (
        <TranslateDesignDialog
          open={dialog === 'translate'}
          onOpenChange={(o) => setDialog(o ? 'translate' : null)}
          designId={detail.id}
          currentLanguage={detail.language}
          flush={flush}
          onTranslated={async (d) => {
            setDialog(null);
            await qc.invalidateQueries({ queryKey: ['designs'] });
            router.push(`/studio/design/${d.id}`);
          }}
        />
      )}
      <TemplateDialog open={dialog === 'template'} onOpenChange={(o) => setDialog(o ? 'template' : null)} designId={detail.id} defaultName={title} flush={flush} />
    </div>
  );
}

// ───────────── Inline text editing ─────────────

function InlineTextEditor({ layer, rect, scale, onDone }: { layer: TextLayer; rect: { x: number; y: number; width: number; height: number }; scale: number; onDone: (text: string | null) => void }) {
  const [value, setValue] = useState(layer.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      dir={layer.direction}
      value={value}
      maxLength={2000}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone(null);
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onDone(value);
        }
      }}
      className="absolute z-10 resize-none rounded-md border-2 border-primary bg-background/95 p-0 text-foreground shadow-lg focus:outline-none"
      style={{
        left: rect.x,
        top: rect.y,
        width: Math.max(80, rect.width),
        minHeight: Math.max(32, rect.height),
        fontFamily: fontStack(layer.fontFamily),
        fontSize: Math.max(12, layer.fontSize * scale),
        fontWeight: layer.fontWeight,
        lineHeight: layer.lineHeight,
        textAlign: layer.align,
      }}
    />
  );
}

// ───────────── Dialogs ─────────────

function VersionsDialog({
  open,
  onOpenChange,
  designId,
  flush,
  onSaved,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  designId: string;
  flush: () => Promise<boolean>;
  onSaved: () => void;
  onRestored: (d: DesignDetail) => void;
}) {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['design', designId, 'versions'], queryFn: () => api.designs.versions(designId), enabled: open });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      if (!(await flush())) return;
      await api.designs.saveVersion(designId, note.trim() || undefined);
      setNote('');
      await qc.invalidateQueries({ queryKey: ['design', designId, 'versions'] });
      toast.success('Version saved');
      onSaved();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (v: DesignVersionSummary) => {
    setBusy(true);
    try {
      if (!(await flush())) return;
      onRestored(await api.designs.restoreVersion(designId, v.id));
      await qc.invalidateQueries({ queryKey: ['design', designId, 'versions'] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Version history" description="Save a named snapshot, or go back to an earlier one. Restoring keeps the current version in history.">
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor="version-note" className="sr-only">
            Version note
          </Label>
          <Input id="version-note" placeholder="Note (optional), e.g. Client approved" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" disabled={busy}>
            Save version
          </Button>
        </form>
        <div className="mt-4 max-h-80 overflow-y-auto">
          {versions.isPending ? (
            <Skeleton className="h-32" />
          ) : versions.isError ? (
            <ErrorState description="Couldn't load versions." onRetry={() => void versions.refetch()} />
          ) : versions.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved versions yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {versions.data.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{v.note ?? `Revision ${v.revision}`}</p>
                    <p className="text-xs text-muted-foreground">
                      Revision {v.revision} · {new Date(v.createdAt).toLocaleString()}
                      {v.createdByName ? ` · ${v.createdByName}` : ''}
                    </p>
                  </div>
                  {confirming === v.id ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => void restore(v)}>
                        Confirm
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirming(v.id)}>
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ open, onOpenChange, designId, defaultName, flush }: { open: boolean; onOpenChange: (o: boolean) => void; designId: string; defaultName: string; flush: () => Promise<boolean> }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState('General');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Save as template" description="Templates are shared with everyone in your organization and can start new designs.">
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim().length < 2) return;
            setBusy(true);
            try {
              if (!(await flush())) return;
              await api.designs.saveAsTemplate(designId, { name: name.trim(), category: category.trim() || 'General' });
              await qc.invalidateQueries({ queryKey: ['templates'] });
              toast.success('Template saved', { action: { label: 'View', onClick: () => router.push('/studio/templates') } });
              onOpenChange(false);
            } catch (err) {
              toast.error(describeError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-category">Category</Label>
            <Input id="template-category" maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Festival, Sale, Real estate" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save template
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

