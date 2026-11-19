/**
 * Coalescing of pointer moves while an evaluation is running.
 *
 * Vega's view queues one evaluation per input event (view.events() calls
 * runAsync with a prerun that delivers the event), and runAsync runs every
 * queued evaluation in turn. With stock Vega the evaluation blocks the main
 * thread, so the browser itself merges the pointer moves that arrive in the
 * meantime. With ParaVega the main thread stays free while the workers
 * compute, every move is delivered, and the queue grows: during a drag the
 * views work through every old brush position, and the lag grows with the
 * length of the drag.
 *
 * This patch keeps only the newest pending move of each type, as the browser
 * does for a busy page: a queued move evaluation is skipped (its event is not
 * delivered, so the evaluation has nothing to do) when a newer move of the
 * same type is queued after it. Moves are never merged across other input
 * events, such as a pointerup or a click, so the order of events and the
 * last position before a release are kept. Evaluations that ParaVega or Vega
 * queue themselves (results from the workers, timers, nested runs) are not
 * input, so moves are merged across them.
 */

const MOVES = new Set(["pointermove", "mousemove", "touchmove"]);

interface Entry { type: string | null; event: any; barrier: boolean; skip: boolean }

export function installMoveCoalescing(vega: any): () => void {
  const proto = vega.Dataflow && vega.Dataflow.prototype;
  if (!proto || proto.runAsync.$pwCoalesce) return () => {};
  const original = proto.runAsync;

  const runAsync = function (this: any, encode: any, prerun: any, postrun: any) {
    // Nothing is running: the call starts at once, as in Vega.
    if (!this._running) return original.call(this, encode, prerun, postrun);
    const ev = typeof window !== "undefined" ? (window as any).event : undefined;
    const type = prerun && ev && MOVES.has(ev.type) ? ev.type : null;
    const queue: Entry[] = this._pwQueue || (this._pwQueue = []);
    // An input event other than a move keeps the moves before it.
    const barrier = !type && !!ev && typeof ev.type === "string" && !MOVES.has(ev.type);
    const entry: Entry = { type, event: ev, barrier, skip: false };
    if (type) {
      // Skip older queued moves of the same type, back to the last other input event.
      for (let i = queue.length - 1; i >= 0; --i) {
        const e = queue[i];
        if (e.barrier) break;
        if (e.type === type && e.event !== ev) e.skip = true;
      }
    }
    queue.push(entry);
    const df = this;
    const done = () => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1); };
    const pre = (...args: any[]) => {
      done();
      if (entry.skip) return;
      return prerun ? prerun.apply(df, args) : undefined;
    };
    return original.call(this, encode, pre, postrun);
  };
  (runAsync as any).$pwCoalesce = true;
  proto.runAsync = runAsync;
  return () => { if (proto.runAsync === runAsync) proto.runAsync = original; };
}
