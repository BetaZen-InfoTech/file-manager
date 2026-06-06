'use client';

import { useState } from 'react';

type F = { _id: string; originalName: string; sizeBytes: number; deletedAt: string };

export default function TrashList({ initial }: { initial: F[] }) {
  const [items, setItems] = useState<F[]>(initial);

  async function restore(id: string) {
    const res = await fetch(`/api/v1/files/${id}/restore`, { method: 'POST' });
    if (res.ok) setItems((p) => p.filter((f) => f._id !== id));
  }

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Deleted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <tr key={f._id}>
              <td className="font-medium">{f.originalName}</td>
              <td className="font-mono text-xs">{(f.sizeBytes / 1024).toFixed(1)} KB</td>
              <td className="font-mono text-xs">
                {new Date(f.deletedAt).toISOString().slice(0, 19).replace('T', ' ')}
              </td>
              <td>
                <button className="text-xs text-accent hover:underline" onClick={() => restore(f._id)}>
                  Restore
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-sm text-gray-500">
                Trash is empty.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
