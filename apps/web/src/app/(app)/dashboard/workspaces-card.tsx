'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Loader2, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label, Skeleton } from '@zatma/ui';
import { createWorkspaceSchema, type CreateWorkspaceInput } from '@zatma/validation';
import { api } from '@/lib/api';

export function WorkspacesCard({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => api.workspaces.list({ pageSize: 50 }) });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateWorkspaceInput>({ resolver: zodResolver(createWorkspaceSchema), defaultValues: { name: '' } });

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['workspaces'] }), qc.invalidateQueries({ queryKey: ['audit-logs'] })]);

  const create = useMutation({
    mutationFn: api.workspaces.create,
    onSuccess: async (ws) => {
      toast.success(`Workspace “${ws.name}” created`);
      reset();
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: api.workspaces.remove,
    onSuccess: async () => {
      toast.success('Workspace deleted');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderKanban className="size-4 text-primary" aria-hidden="true" /> Workspaces
        </CardTitle>
        <CardDescription>Separate brands or clients inside your organization.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canCreate && (
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="flex items-start gap-2" noValidate>
            <div className="flex-1 space-y-1">
              <Label htmlFor="ws-name" className="sr-only">
                Workspace name
              </Label>
              <Input id="ws-name" placeholder="New workspace name" aria-invalid={!!errors.name} aria-describedby="ws-name-error" {...register('name')} />
              <FieldError id="ws-name-error" message={errors.name?.message} />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
              Add
            </Button>
          </form>
        )}

        {workspaces.isPending && <Skeleton className="h-24" />}
        {workspaces.isError && <p className="text-sm text-destructive">Could not load workspaces.</p>}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {workspaces.data?.data.map((ws) => (
            <li key={ws.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ws.name}</p>
                {ws.description && <p className="truncate text-xs text-muted-foreground">{ws.description}</p>}
              </div>
              {ws.isDefault ? (
                <Badge tone="primary">Default</Badge>
              ) : (
                canCreate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${ws.name}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete workspace “${ws.name}”?`)) remove.mutate(ws.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
