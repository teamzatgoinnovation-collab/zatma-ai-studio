import type { Metadata } from 'next';
import { EditorLoader } from './editor-loader';

export const metadata: Metadata = { title: 'Design editor' };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <EditorLoader designId={id} />;
}
