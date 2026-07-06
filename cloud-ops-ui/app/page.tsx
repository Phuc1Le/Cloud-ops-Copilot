'use client';
import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Append empty assistant message that we'll stream into
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages }),
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => 'Request failed');
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = { role: 'assistant', content: errorText };
        return updated;
      });
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: updated[updated.length - 1].content + chunk,
        };
        return updated;
      });
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen flex-col bg-zinc-50 p-6 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            Cloud Ops Copilot
          </p>
          <h1 className="text-3xl font-semibold">☁️ Cloud Ops Copilot</h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Ask about your AWS environment, recent incidents, or how to investigate a problem.
          </p>
        </header>

        <section className="flex flex-1 flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex-1 space-y-3 overflow-auto">
            {messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                Ask about your AWS infrastructure to get started.
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`rounded-xl p-3 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto max-w-[85%] bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'mr-auto max-w-[85%] bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                }`}
              >
                {m.content}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask about your AWS infrastructure..."
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading}
              className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {loading ? '...' : 'Send'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
