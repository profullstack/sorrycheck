'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function SubmitForm({ slug }: { slug?: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    const form = new FormData(event.currentTarget);

    const response = await fetch('/api/v1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.get('title'),
        authors: form.get('authors'),
        paperUrl: form.get('paperUrl'),
        sourceUrl: form.get('sourceUrl'),
      }),
    });

    const body = (await response.json()) as { url?: string; error?: string };
    if (response.ok && body.url) {
      setState('done');
      setMessage(body.url);
      return;
    }
    setState('error');
    setMessage(body.error ?? 'Something went wrong.');
  }

  const fields = [
    { name: 'title', label: 'Title', required: true, placeholder: 'The paper or artifact title' },
    { name: 'authors', label: 'Authors', placeholder: 'Comma separated' },
    { name: 'paperUrl', label: 'Paper URL', placeholder: 'https://arxiv.org/abs/…' },
    {
      name: 'sourceUrl',
      label: 'Formalization repository',
      placeholder: 'https://github.com/owner/repo',
    },
  ];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {slug ? <input type="hidden" name="slug" value={slug} /> : null}

      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1.5">
          <label htmlFor={field.name} className="text-sm font-medium">
            {field.label}
            {field.required ? '' : <span className="text-muted-foreground"> (optional)</span>}
          </label>
          <input
            id={field.name}
            name={field.name}
            required={field.required}
            placeholder={field.placeholder}
            className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ))}

      <div>
        <Button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Submitting…' : 'Submit'}
        </Button>
      </div>

      {state === 'done' ? (
        <p className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
          Queued. The page is at{' '}
          <a href={message} className="underline underline-offset-4">
            {message}
          </a>{' '}
          and will fill in once the checker reaches it.
        </p>
      ) : null}

      {state === 'error' ? (
        <p className="rounded-md border border-red-600/40 bg-red-600/10 p-4 text-sm">{message}</p>
      ) : null}
    </form>
  );
}
