'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Dialog, DialogContent, Input, Label, Select } from '@zatma/ui';
import type { ImportInput, ImportPreview } from '@zatma/validation';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { describeError } from './shared';

type Entity = ImportInput['entity'];
const ENTITY_LABEL: Record<Entity, string> = { leads: 'leads', contacts: 'contacts', companies: 'companies' };

/** Required fields that no column is mapped to. */
export function missingRequired(preview: ImportPreview, mapping: Record<string, string | null>): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return preview.fields.filter((f) => f.required && !mapped.has(f.field)).map((f) => f.label);
}

/** Changing one column's field clears any other column mapped to the same field. */
export function remap(mapping: Record<string, string | null>, header: string, field: string | null): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  for (const [h, f] of Object.entries(mapping)) next[h] = field && f === field && h !== header ? null : f;
  next[header] = field;
  return next;
}

export function ImportDialog({ open, onOpenChange, entity }: { open: boolean; onOpenChange: (o: boolean) => void; entity: Entity }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [dedupe, setDedupe] = useState<'skip' | 'update' | 'create'>('skip');
  const [tag, setTag] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const reset = () => {
    setFileId(null);
    setPreview(null);
    setMapping({});
    setJobId(null);
    setTag('');
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Choose a .csv file');
      if (file.size > 2 * 1024 * 1024) throw new Error('CSV files can be up to 2 MB');
      const id = await uploadFile(new File([file], file.name, { type: 'text/csv' }), 'IMPORT');
      return { id, preview: await api.crm.imports.preview(id, entity) };
    },
    onSuccess: ({ id, preview: p }) => {
      setFileId(id);
      setPreview(p);
      setMapping(p.mapping);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const start = useMutation({
    mutationFn: () => api.crm.imports.start({ fileId: fileId!, entity, mapping, dedupe, ...(tag.trim() ? { tag: tag.trim() } : {}) }),
    onSuccess: (s) => setJobId(s.id),
    onError: (e) => toast.error(describeError(e)),
  });

  const status = useQuery({
    queryKey: ['crm', 'import', jobId],
    queryFn: () => api.crm.imports.status(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ['SUCCEEDED', 'FAILED'].includes(q.state.data.status) ? false : 800),
  });
  const finished = status.data && ['SUCCEEDED', 'FAILED'].includes(status.data.status);
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: ['crm'] });
  }, [finished, qc]);

  const missing = preview ? missingRequired(preview, mapping) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent title={`Import ${ENTITY_LABEL[entity]}`} description="Upload a CSV (up to 5,000 rows, 2 MB). Columns are matched automatically; you can adjust them before importing." className="max-w-2xl">
        {!preview && (
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload.mutate(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-8 text-sm text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {upload.isPending ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : <FileUp className="size-6" aria-hidden="true" />}
              {upload.isPending ? 'Reading file…' : 'Choose a CSV file'}
            </button>
          </div>
        )}

        {preview && !jobId && (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!missing.length) start.mutate();
            }}
          >
            <p className="text-sm">
              <strong>{preview.rowCount.toLocaleString()}</strong> rows found. Match each column to a field:
            </p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Column mapping</caption>
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Column
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Example
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Field
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h, i) => (
                    <tr key={h} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">{preview.sample[0]?.[i] ?? ''}</td>
                      <td className="px-3 py-2">
                        <Label htmlFor={`map-${i}`} className="sr-only">
                          Field for column {h}
                        </Label>
                        <Select id={`map-${i}`} className="h-9" value={mapping[h] ?? ''} onChange={(e) => setMapping((m) => remap(m, h, e.target.value || null))}>
                          <option value="">Don’t import</option>
                          {preview.fields.map((f) => (
                            <option key={f.field} value={f.field}>
                              {f.label}
                              {f.required ? ' *' : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && <Alert>Map a column to: {missing.join(', ')}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-dedupe">If a record already exists</Label>
                <Select id="import-dedupe" value={dedupe} onChange={(e) => setDedupe(e.target.value as typeof dedupe)}>
                  <option value="skip">Skip it</option>
                  <option value="update">Fill in its empty fields</option>
                  <option value="create">Create a duplicate</option>
                </Select>
                <p className="text-xs text-muted-foreground">{entity === 'companies' ? 'Matched by company name.' : 'Matched by email or phone.'}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-tag">Tag imported records (optional)</Label>
                <Input id="import-tag" maxLength={40} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. expo-2026" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={reset}>
                Choose another file
              </Button>
              <Button type="submit" disabled={start.isPending || missing.length > 0}>
                Import {preview.rowCount.toLocaleString()} rows
              </Button>
            </div>
          </form>
        )}

        {jobId && (
          <div className="mt-4 space-y-4" aria-live="polite">
            {!finished ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Importing… {status.data ? `${status.data.processed} of ${status.data.total}` : ''}
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={status.data?.total ?? 100} aria-valuenow={status.data?.processed ?? 0}>
                  <div className="h-full bg-primary transition-all" style={{ width: `${status.data?.total ? (status.data.processed / status.data.total) * 100 : 5}%` }} />
                </div>
              </div>
            ) : status.data?.status === 'FAILED' ? (
              <Alert>Import failed: {status.data.error}</Alert>
            ) : (
              <div className="space-y-3">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-5 text-success-text" aria-hidden="true" /> Import complete
                </p>
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {(
                    [
                      ['Created', status.data!.created],
                      ['Updated', status.data!.updated],
                      ['Skipped', status.data!.skipped],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-muted p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="text-xl font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                {status.data!.errors.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium">Rows that were not imported</p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2 text-xs">
                      {status.data!.errors.map((e) => (
                        <li key={e.row}>
                          <span className="font-medium">Row {e.row}:</span> {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {finished && (
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    reset();
                  }}
                >
                  Done
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
