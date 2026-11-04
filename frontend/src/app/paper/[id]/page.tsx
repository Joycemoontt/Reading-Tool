"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const Reader = dynamic(() => import("@/components/Reader"), { ssr: false });
export default function PaperPage() {
  const params = useParams<{ id: string }>();
  return <Reader paperId={params.id}/>;
}
