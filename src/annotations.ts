// Annotation model. Invariant 5: point/rect/arrow share ONE auto-incrementing
// number sequence — the number is positional (index + 1), so deleting an entry
// renumbers everything after it automatically.

export type Tool = "point" | "rect" | "arrow";

export interface Annotation {
  kind: Tool;
  // Source-image natural pixels, origin top-left (converted to final saved
  // pixels only at encode/burn-in time via DownscalePlan.factor).
  // point uses (x1,y1) only; rect is two opposite corners (normalized when
  // drawn/encoded); arrow is tail (x1,y1) -> head (x2,y2).
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  note: string;
}

export class AnnotationStore {
  private items: Annotation[] = [];
  private undoStack: Annotation[][] = [];

  get all(): readonly Annotation[] {
    return this.items;
  }

  get count(): number {
    return this.items.length;
  }

  /** 1-based join key burned into the image and written as [n]. */
  numberOf(index: number): number {
    return index + 1;
  }

  add(a: Annotation): number {
    this.snapshot();
    this.items.push(a);
    return this.items.length - 1;
  }

  remove(index: number): void {
    if (index < 0 || index >= this.items.length) return;
    this.snapshot();
    this.items.splice(index, 1);
  }

  setNote(index: number, note: string): void {
    const item = this.items[index];
    if (!item || item.note === note) return;
    this.snapshot();
    this.items[index] = { ...item, note };
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.items = prev;
    return true;
  }

  clear(): void {
    this.items = [];
    this.undoStack = [];
  }

  private snapshot(): void {
    this.undoStack.push(this.items.map((a) => ({ ...a })));
  }
}

/** Rect corners normalized to top-left / bottom-right. */
export function normalizedRect(a: Annotation): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  return {
    x1: Math.min(a.x1, a.x2),
    y1: Math.min(a.y1, a.y2),
    x2: Math.max(a.x1, a.x2),
    y2: Math.max(a.y1, a.y2),
  };
}
