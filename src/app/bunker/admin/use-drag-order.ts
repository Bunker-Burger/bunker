"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";

/**
 * Drag-and-drop order for a list (issue #54): drag a row by its handle, or focus the handle and use
 * the arrow keys. `onSave` receives every id in the new order once a move ends, only if it changed.
 */
export function useDragOrder<T extends { id: string }>(items: readonly T[], onSave: (ids: string[]) => void) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const list: T[] = (() => {
    if (!order) return [...items];
    const byId = new Map(items.map((item) => [item.id, item]));
    const listed = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    return [...listed, ...items.filter((item) => !order.includes(item.id))];
  })();

  const move = (id: string, to: number) => {
    const ids = list.map((item) => item.id);
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return null;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setOrder(ids);
    return ids;
  };
  const save = (ids: string[]) => {
    if (ids.join() !== items.map((item) => item.id).join()) onSave(ids);
  };

  const rowProps = (id: string, index: number) => ({
    draggable: armed === id,
    "data-dragging": dragging === id || undefined,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      setDragging(id);
    },
    onDragOver: (event: DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (dragging !== id) move(dragging, index);
    },
    onDragEnd: () => {
      if (dragging) save(list.map((item) => item.id));
      setDragging(null);
      setArmed(null);
    }
  });

  const handleProps = (id: string, index: number, label: string) => ({
    type: "button" as const,
    "aria-label": `${label} (flechas para mover)`,
    onPointerDown: () => setArmed(id),
    onPointerUp: () => setArmed(null),
    onKeyDown: (event: KeyboardEvent) => {
      const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
      if (!step) return;
      event.preventDefault();
      const ids = move(id, index + step);
      if (ids) save(ids);
    }
  });

  return { list, rowProps, handleProps };
}
