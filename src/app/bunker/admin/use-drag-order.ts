"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Drag order for a list (issue #54): drag a row by its handle with a finger or the mouse, or focus
 * the handle and use the arrow keys. `onSave` receives every id in the new order once a move ends,
 * only if it changed.
 *
 * It follows the pointer instead of using HTML drag and drop, which does not work with touch on
 * iPhone (a long press on the text opens the system "look up" window instead). Each row carries
 * `data-drag-id`; the row under the pointer is the place the dragged one takes.
 */
export function useDragOrder<T extends { id: string }>(items: readonly T[], onSave: (ids: string[]) => void) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const active = useRef<string | null>(null);

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
  const end = () => {
    if (active.current) save(list.map((item) => item.id));
    active.current = null;
    setDragging(null);
  };

  const rowProps = (id: string, _index: number) => ({
    "data-drag-id": id,
    "data-dragging": dragging === id || undefined
  });

  const handleProps = (id: string, index: number, label: string) => ({
    type: "button" as const,
    "aria-label": `${label} (flechas para mover)`,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      active.current = id;
      setDragging(id);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Optional: the drag follows the pointer by position either way.
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (active.current !== id) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drag-id]");
      const target = row?.getAttribute("data-drag-id");
      if (!target || target === id) return;
      const to = list.findIndex((item) => item.id === target);
      if (to >= 0) move(id, to);
    },
    onPointerUp: end,
    onPointerCancel: end,
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
