import { FileViewer } from "@/features/files/file-viewer";

export default async function FilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FileViewer fileId={id} />;
}
