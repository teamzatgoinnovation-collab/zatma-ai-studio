import type { Paginated } from '@zatma/types';
import type { PaginationInput } from '@zatma/validation';

export const toSkipTake = ({ page, pageSize }: PaginationInput) => ({ skip: (page - 1) * pageSize, take: pageSize });

export function paginate<T>(data: T[], total: number, { page, pageSize }: PaginationInput): Paginated<T> {
  return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}
