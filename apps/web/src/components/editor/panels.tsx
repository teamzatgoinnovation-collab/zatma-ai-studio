'use client';

import {
  ArrowDown,
  Bookmark,
  ArrowUp,
  BringToFront,
  Copy,
  Eye,
  EyeOff,
  ImageIcon,
  Lock,
  SendToBack,
  Shapes,
  Square,
  Trash2,
  Type,
  Unlock,
  Upload,
} from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button, cn, Input, Label, Select } from '@zatma/ui';
import type { BrandKitDto, DesignBackground, DesignDocument, DesignLayer, ImageLayer, ShapeLayer, TextLayer } from '@zatma/validation';
import { FONT_OPTIONS } from './fonts';
import type { EditorAction } from './state';

type Dispatch = (a: EditorAction) => void;

const layerLabel = (l: DesignLayer) =>
  l.name ?? (l.type === 'text' ? l.text.split('\n')[0]!.slice(0, 32) || 'Text' : l.type === 'image' ? (l.role === 'logo' ? 'Logo' : 'Image') : l.shape === 'ellipse' ? 'Ellipse' : 'Rectangle');

const LayerIcon = ({ layer }: { layer: DesignLayer }) =>
  layer.type === 'text' ? <Type className="size-3.5 shrink-0" aria-hidden="true" /> : layer.type === 'image' ? <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" /> : <Shapes className="size-3.5 shrink-0" aria-hidden="true" />;

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border p-4 last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input id={id} type="color" value={value.slice(0, 7)} disabled={disabled} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded-md border border-input bg-background p-0.5 disabled:cursor-not-allowed" />
        <span className="w-16 font-mono text-xs text-muted-foreground">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        className="h-8 px-2 text-sm"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === '' || !Number.isFinite(n)) return;
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
    </div>
  );
}

// ───────────── Layers ─────────────

export function LayersPanel({ doc, selectedId, dispatch, readOnly }: { doc: DesignDocument; selectedId: string | null; dispatch: Dispatch; readOnly: boolean }) {
  const ordered = [...doc.layers].reverse();
  if (ordered.length === 0) return <p className="p-4 text-sm text-muted-foreground">No layers yet. Add text, a shape or an image.</p>;
  return (
    <ul className="space-y-1 p-2" aria-label="Layers">
      {ordered.map((l, i) => {
        const selected = l.id === selectedId;
        return (
          <li key={l.id} className={cn('group flex items-center gap-1 rounded-lg pr-1', selected ? 'bg-primary/10' : 'hover:bg-muted')}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={selected}
              onClick={() => dispatch({ type: 'select', id: l.id })}
            >
              <LayerIcon layer={l} />
              <span className={cn('truncate', !l.visible && 'text-muted-foreground line-through')}>{layerLabel(l)}</span>
            </button>
            {!readOnly && (
              <>
                <IconButton label={l.visible ? `Hide ${layerLabel(l)}` : `Show ${layerLabel(l)}`} onClick={() => dispatch({ type: 'updateLayer', id: l.id, patch: { visible: !l.visible } })}>
                  {l.visible ? <Eye /> : <EyeOff />}
                </IconButton>
                <IconButton label={l.locked ? `Unlock ${layerLabel(l)}` : `Lock ${layerLabel(l)}`} onClick={() => dispatch({ type: 'updateLayer', id: l.id, patch: { locked: !l.locked } })}>
                  {l.locked ? <Lock /> : <Unlock />}
                </IconButton>
                <IconButton label={`Move ${layerLabel(l)} up`} disabled={i === 0} onClick={() => dispatch({ type: 'moveLayer', id: l.id, to: 'up' })}>
                  <ArrowUp />
                </IconButton>
                <IconButton label={`Move ${layerLabel(l)} down`} disabled={i === ordered.length - 1} onClick={() => dispatch({ type: 'moveLayer', id: l.id, to: 'down' })}>
                  <ArrowDown />
                </IconButton>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

// ───────────── Add ─────────────

export function AddPanel({
  onAddText,
  onAddShape,
  onUploadImage,
  brandKit,
  onAddLogo,
  uploading,
}: {
  onAddText: (role: 'headline' | 'body') => void;
  onAddShape: (shape: 'rect' | 'ellipse') => void;
  onUploadImage: (file: File) => void;
  brandKit: BrandKitDto | null;
  onAddLogo: () => void;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <PanelSection title="Text">
        <div className="grid gap-2">
          <Button variant="outline" className="justify-start" onClick={() => onAddText('headline')}>
            <Type aria-hidden="true" /> Add heading
          </Button>
          <Button variant="outline" className="justify-start" onClick={() => onAddText('body')}>
            <Type aria-hidden="true" /> Add paragraph
          </Button>
        </div>
      </PanelSection>
      <PanelSection title="Shapes">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => onAddShape('rect')}>
            <Square aria-hidden="true" /> Rectangle
          </Button>
          <Button variant="outline" onClick={() => onAddShape('ellipse')}>
            <Shapes aria-hidden="true" /> Ellipse
          </Button>
        </div>
      </PanelSection>
      <PanelSection title="Images">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Upload image"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onUploadImage(f);
          }}
        />
        <Button variant="outline" className="w-full justify-start" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload image'}
        </Button>
        {brandKit?.logoFileId && brandKit.logoUrl ? (
          <Button variant="outline" className="w-full justify-start" onClick={onAddLogo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandKit.logoUrl} alt="" className="size-4 object-contain" /> Add {brandKit.name} logo
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Add a logo to your brand kit to place it here in one click.</p>
        )}
      </PanelSection>
    </div>
  );
}

// ───────────── Background ─────────────

export function BackgroundPanel({
  background,
  onChange,
  onUpload,
  uploading,
  readOnly,
}: {
  background: DesignBackground;
  onChange: (bg: DesignBackground) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const typeId = useId();
  const base = background.type === 'color' ? background.color : background.type === 'gradient' ? background.from : background.fallbackColor;
  return (
    <div>
      <PanelSection title="Background">
        <div className="space-y-1.5">
          <Label htmlFor={typeId}>Type</Label>
          <Select
            id={typeId}
            value={background.type}
            disabled={readOnly}
            onChange={(e) => {
              const t = e.target.value;
              if (t === 'color') onChange({ type: 'color', color: base });
              else if (t === 'gradient') onChange({ type: 'gradient', from: base, to: '#111827', angle: 135 });
              else fileRef.current?.click();
            }}
          >
            <option value="color">Solid colour</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
          </Select>
        </div>
        {background.type === 'color' && <ColorField label="Colour" value={background.color} disabled={readOnly} onChange={(color) => onChange({ ...background, color })} />}
        {background.type === 'gradient' && (
          <>
            <ColorField label="From" value={background.from} disabled={readOnly} onChange={(from) => onChange({ ...background, from })} />
            <ColorField label="To" value={background.to} disabled={readOnly} onChange={(to) => onChange({ ...background, to })} />
            <NumberField label="Angle (°)" value={background.angle} min={0} max={360} disabled={readOnly} onChange={(angle) => onChange({ ...background, angle })} />
          </>
        )}
        {background.type === 'image' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${typeId}-fit`}>Fit</Label>
              <Select id={`${typeId}-fit`} value={background.fit} disabled={readOnly} onChange={(e) => onChange({ ...background, fit: e.target.value as 'cover' | 'contain' })}>
                <option value="cover">Fill (crop)</option>
                <option value="contain">Fit (letterbox)</option>
              </Select>
            </div>
            <ColorField label="Fallback colour" value={background.fallbackColor} disabled={readOnly} onChange={(fallbackColor) => onChange({ ...background, fallbackColor })} />
            <ColorField
              label="Overlay"
              value={background.overlay?.color ?? '#000000'}
              disabled={readOnly}
              onChange={(color) => onChange({ ...background, overlay: { color, opacity: background.overlay?.opacity ?? 0.35 } })}
            />
            <NumberField
              label="Overlay opacity (%)"
              value={Math.round((background.overlay?.opacity ?? 0) * 100)}
              min={0}
              max={100}
              disabled={readOnly}
              onChange={(v) => onChange({ ...background, overlay: { color: background.overlay?.color ?? '#000000', opacity: v / 100 } })}
            />
          </>
        )}
        {!readOnly && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Upload background image"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUpload(f);
              }}
            />
            <Button variant="outline" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" /> {uploading ? 'Uploading…' : background.type === 'image' ? 'Replace image' : 'Upload image'}
            </Button>
          </>
        )}
      </PanelSection>
    </div>
  );
}

// ───────────── Copy ─────────────

export function CopyPanel({ caption, hashtags, onSave }: { caption: string | null; hashtags: string[]; onSave?: (kind: 'caption' | 'hashtags', content: string, hashtags: string[]) => void }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.');
    }
  };
  if (!caption && hashtags.length === 0) return <p className="p-4 text-sm text-muted-foreground">AI-generated designs include a social caption and hashtags here.</p>;
  const tags = hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  return (
    <div>
      {caption && (
        <PanelSection title="Caption">
          <p className="whitespace-pre-wrap text-sm">{caption}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(caption, 'Caption')}>
              <Copy aria-hidden="true" /> Copy caption
            </Button>
            {onSave && (
              <Button size="sm" variant="outline" onClick={() => onSave('caption', caption, hashtags)}>
                <Bookmark aria-hidden="true" /> Save to library
              </Button>
            )}
          </div>
        </PanelSection>
      )}
      {hashtags.length > 0 && (
        <PanelSection title="Hashtags">
          <p className="text-sm text-primary">{tags}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(tags, 'Hashtags')}>
              <Copy aria-hidden="true" /> Copy hashtags
            </Button>
            {onSave && (
              <Button size="sm" variant="outline" onClick={() => onSave('hashtags', tags, [])}>
                <Bookmark aria-hidden="true" /> Save to library
              </Button>
            )}
          </div>
        </PanelSection>
      )}
    </div>
  );
}

// ───────────── Properties ─────────────

const WEIGHTS = [400, 500, 600, 700, 800] as const;

export function PropertiesPanel({
  layer,
  dispatch,
  readOnly,
  onReplaceImage,
  onDuplicate,
  textTools,
}: {
  layer: DesignLayer;
  dispatch: Dispatch;
  readOnly: boolean;
  onReplaceImage: (file: File) => void;
  onDuplicate: () => void;
  /** Extra controls under the text content (e.g. AI rewrite). */
  textTools?: (layer: TextLayer) => ReactNode;
}) {
  const disabled = readOnly || layer.locked;
  const set = (patch: Partial<DesignLayer>) => dispatch({ type: 'updateLayer', id: layer.id, patch });
  return (
    <div>
      <PanelSection title={layer.type === 'text' ? 'Text' : layer.type === 'image' ? 'Image' : 'Shape'}>
        {layer.type === 'text' && <TextProps layer={layer} set={set} disabled={disabled} tools={textTools?.(layer)} />}
        {layer.type === 'shape' && <ShapeProps layer={layer} set={set} disabled={disabled} />}
        {layer.type === 'image' && <ImageProps layer={layer} set={set} disabled={disabled} onReplace={onReplaceImage} />}
      </PanelSection>
      <PanelSection title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={layer.x} disabled={disabled} onChange={(x) => set({ x })} />
          <NumberField label="Y" value={layer.y} disabled={disabled} onChange={(y) => set({ y })} />
          <NumberField label="Width" value={layer.width} min={1} disabled={disabled} onChange={(width) => set({ width })} />
          <NumberField label="Height" value={layer.height} min={1} disabled={disabled} onChange={(height) => set({ height })} />
          <NumberField label="Rotation (°)" value={layer.rotation} min={-360} max={360} disabled={disabled} onChange={(rotation) => set({ rotation })} />
          <NumberField label="Opacity (%)" value={Math.round(layer.opacity * 100)} min={0} max={100} disabled={disabled} onChange={(v) => set({ opacity: v / 100 })} />
        </div>
      </PanelSection>
      {!readOnly && (
        <PanelSection title="Arrange">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'moveLayer', id: layer.id, to: 'front' })}>
              <BringToFront aria-hidden="true" /> To front
            </Button>
            <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'moveLayer', id: layer.id, to: 'back' })}>
              <SendToBack aria-hidden="true" /> To back
            </Button>
            <Button size="sm" variant="outline" onClick={onDuplicate}>
              <Copy aria-hidden="true" /> Duplicate
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => dispatch({ type: 'removeLayer', id: layer.id })}>
              <Trash2 aria-hidden="true" /> Delete
            </Button>
          </div>
        </PanelSection>
      )}
    </div>
  );
}

function TextProps({ layer, set, disabled, tools }: { layer: TextLayer; set: (p: Partial<TextLayer>) => void; disabled: boolean; tools?: ReactNode }) {
  const id = useId();
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-text`}>Content</Label>
        <textarea
          id={`${id}-text`}
          rows={3}
          maxLength={2000}
          dir={layer.direction}
          value={layer.text}
          disabled={disabled}
          onChange={(e) => set({ text: e.target.value })}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>
      {tools}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-font`}>Font</Label>
        <Select id={`${id}-font`} value={layer.fontFamily} disabled={disabled} onChange={(e) => set({ fontFamily: e.target.value as TextLayer['fontFamily'] })}>
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Size" value={layer.fontSize} min={6} max={600} disabled={disabled} onChange={(fontSize) => set({ fontSize })} />
        <div className="space-y-1">
          <Label htmlFor={`${id}-weight`} className="text-xs font-normal text-muted-foreground">
            Weight
          </Label>
          <Select id={`${id}-weight`} className="h-8 text-sm" value={layer.fontWeight} disabled={disabled} onChange={(e) => set({ fontWeight: Number(e.target.value) as TextLayer['fontWeight'] })}>
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </div>
        <NumberField label="Line height" value={layer.lineHeight} min={0.7} max={3} step={0.05} disabled={disabled} onChange={(lineHeight) => set({ lineHeight })} />
        <NumberField label="Letter spacing" value={layer.letterSpacing} min={-20} max={50} disabled={disabled} onChange={(letterSpacing) => set({ letterSpacing })} />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium" id={`${id}-align`}>
          Alignment
        </span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-labelledby={`${id}-align`}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <Button key={a} size="sm" variant={layer.align === a ? 'primary' : 'outline'} aria-pressed={layer.align === a} disabled={disabled} onClick={() => set({ align: a })} className="capitalize">
              {a}
            </Button>
          ))}
        </div>
      </div>
      <ColorField label="Text colour" value={layer.fill} disabled={disabled} onChange={(fill) => set({ fill })} />
      {layer.background ? (
        <>
          <ColorField label="Pill colour" value={layer.background.fill} disabled={disabled} onChange={(fill) => set({ background: { ...layer.background!, fill } })} />
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set({ background: undefined })}>
            Remove pill
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => set({ background: { fill: '#6366F1', cornerRadius: 500, padding: Math.round(layer.fontSize * 0.4) } })}>
          Add button pill
        </Button>
      )}
    </>
  );
}

function ShapeProps({ layer, set, disabled }: { layer: ShapeLayer; set: (p: Partial<ShapeLayer>) => void; disabled: boolean }) {
  return (
    <>
      <ColorField label="Fill" value={layer.fill} disabled={disabled} onChange={(fill) => set({ fill })} />
      <ColorField label="Border" value={layer.stroke ?? '#000000'} disabled={disabled} onChange={(stroke) => set({ stroke, strokeWidth: layer.strokeWidth || 2 })} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Border width" value={layer.strokeWidth} min={0} max={100} disabled={disabled} onChange={(strokeWidth) => set({ strokeWidth })} />
        {layer.shape === 'rect' && <NumberField label="Corner radius" value={layer.cornerRadius} min={0} max={2000} disabled={disabled} onChange={(cornerRadius) => set({ cornerRadius })} />}
      </div>
    </>
  );
}

function ImageProps({ layer, set, disabled, onReplace }: { layer: ImageLayer; set: (p: Partial<ImageLayer>) => void; disabled: boolean; onReplace: (f: File) => void }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-fit`}>Fit</Label>
        <Select id={`${id}-fit`} value={layer.fit} disabled={disabled} onChange={(e) => set({ fit: e.target.value as ImageLayer['fit'] })}>
          <option value="contain">Fit inside</option>
          <option value="cover">Fill (crop)</option>
        </Select>
      </div>
      <NumberField label="Corner radius" value={layer.cornerRadius} min={0} max={2000} disabled={disabled} onChange={(cornerRadius) => set({ cornerRadius })} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Replace image"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onReplace(f);
        }}
      />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>
        <Upload aria-hidden="true" /> Replace image
      </Button>
    </>
  );
}
