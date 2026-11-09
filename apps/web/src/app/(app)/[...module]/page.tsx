import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findNavEntry } from '@/components/nav';
import { ModulePage } from '@/components/module/module-page';

type Props = { params: Promise<{ module: string[] }> };

const resolve = async (params: Props['params']) => findNavEntry(`/${(await params).module.join('/')}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await resolve(params);
  return { title: entry ? (entry.leaf ?? entry.section).label : 'Not found' };
}

/** Every module listed in the navigation that has no dedicated page yet renders its roadmap layout here. */
export default async function ModuleRoute({ params }: Props) {
  const entry = await resolve(params);
  if (!entry) notFound();
  return <ModulePage section={entry.section} leaf={entry.leaf} />;
}
