"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ScriptingReferencePage() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/docs/scripting-reference.md")
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load scripting reference:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-400">Loading documentation...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <article className="prose prose-invert prose-zinc max-w-none prose-headings:font-semibold prose-h1:text-3xl prose-h2:text-2xl prose-h2:border-b prose-h2:border-zinc-800 prose-h2:pb-2 prose-h3:text-xl prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-emerald-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-table:text-sm prose-th:bg-zinc-900 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-zinc-800 prose-th:border-zinc-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
