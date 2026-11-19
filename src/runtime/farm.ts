/**
 * Concurrent evaluation of independent operators (ParaWeb Farm).
 *
 * Vega's dataflow evaluates operators in rank order and awaits every
 * operator that returns a promise before it dequeues the next one, so the
 * views of a dashboard are computed one after the other even when their
 * aggregations run in workers. This evaluation loop keeps Vega's rank order
 * but does not wait for ParaVega's parallel operators: when one returns a
 * promise, the loop continues with the queued parallel operators that do
 * not depend, directly or through other operators, on a pending or held
 * one. A parallel operator reads only its pulse source and its operator
 * parameters (including non-reactive ones, which have no `_targets` edge),
 * so these are all its dependencies. Vega's own operators can also depend
 * on shared state, such as the scenegraph that marks write and layout
 * reads, which is ordered by rank alone; they therefore run only when no
 * operator is pending or held, which is Vega's order. The result of every
 * operator is the same as with Vega's loop, and independent parallel
 * operators, such as the aggregates of the views of a dashboard, run in
 * the workers at the same time.
 *
 * Everything around the loop (pending data sets, prerun, postrun, runAfter
 * callbacks, non-blocking async results) follows Vega's evaluate.
 */

function uniqueList(id: (x: any) => any): any[] {
  const list: any = [];
  const ids: Record<string, number> = {};
  list.add = (x: any) => { const k = id(x); if (!ids[k]) { ids[k] = 1; list.push(x); } return list; };
  list.remove = (x: any) => {
    const k = id(x);
    if (ids[k]) { ids[k] = 0; const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); }
    return list;
  };
  return list;
}

async function asyncCallback(df: any, cb: (df: any) => any) {
  try { await cb.call(df, df); } catch (err) { df.error(err); }
}

/** Operators an operator reads: its pulse sources and every operator parameter (reactive or not). */
function upstream(op: any, visit: (x: any) => boolean | void): boolean {
  const src = op.source;
  if (src) {
    if (Array.isArray(src)) { for (const x of src) if (visit(x)) return true; } else if (visit(src)) return true;
  }
  const argops = op._argops;
  if (argops) for (const a of argops) if (visit(a.op)) return true;
  return false;
}

export interface FarmStats {
  /** Largest number of operators pending at the same time, per evaluation. */
  maxConcurrent: number;
}

/**
 * Replace Dataflow.prototype.evaluate (which View.evaluate calls) with the
 * concurrent loop. Returns the function that restores Vega's loop.
 */
export function installFarm(vega: any, onStats?: (s: FarmStats) => void, concurrent = true): () => void {
  const proto = vega.Dataflow.prototype;
  const original = proto.evaluate;
  if (original.$pwFarm) return () => {};
  const Pulse = vega.Pulse;
  const id = vega.id;

  const evaluate = async function (this: any, encode: any, prerun: any, postrun: any) {
    const df = this;
    const async: any[] = [];
    if (df._pulse) { df.error("Dataflow already running. Use runAsync() to chain invocations."); return df; }
    if (df._pending) await df._pending;
    if (prerun) await asyncCallback(df, prerun);
    if (!df._touched.length) { df.debug("Dataflow invoked, but nothing to do."); return df; }

    const stamp = ++df._clock;
    df._pulse = new Pulse(df, stamp, encode);
    const Stop = df._pulse.StopPropagation;
    df._touched.forEach((op: any) => df._enqueue(op, true));
    df._touched = uniqueList(id);

    let count = 0;
    let error: { err: any } | null = null;
    let maxConcurrent = 0;
    const pending = new Map<any, Promise<void>>();
    const held: any[] = [];
    const heldSet = new Set<any>();
    // Memo of the upstream walk, valid until the next await: a source has a
    // lower rank than its targets and the heap pops by rank, so an operator
    // that becomes pending or held later in the same pass is never upstream
    // of one already visited.
    let memo = new Map<any, boolean>();
    const blocked = (op: any): boolean => {
      let b = memo.get(op);
      if (b !== undefined) return b;
      memo.set(op, false);
      b = upstream(op, x => pending.has(x) || heldSet.has(x) || blocked(x));
      memo.set(op, b);
      return b;
    };
    const finish = (op: any, next: any) => {
      if (next !== Stop && op._targets) op._targets.forEach((t: any) => df._enqueue(t));
      ++count;
    };

    try {
      for (;;) {
        while (!error && df._heap.size() > 0) {
          const op = df._heap.pop();
          if (op.rank !== op.qrank) { df._enqueue(op, true); continue; }
          if ((pending.size || held.length) && (!concurrent || !op._pwParallel || blocked(op))) { held.push(op); heldSet.add(op); memo.set(op, true); continue; }
          let next: any;
          df._pwInRun = true;
          try { next = op.run(df._getPulse(op, encode)); } finally { df._pwInRun = false; }
          if (next.then) {
            const done = next.then(
              (r: any) => { pending.delete(op); finish(op, r); },
              (err: any) => { pending.delete(op); if (!error) error = { err }; },
            );
            pending.set(op, done);
            memo.set(op, true);
            if (pending.size > maxConcurrent) maxConcurrent = pending.size;
            continue;
          }
          if (next.async) { async.push(next.async); next = Stop; }
          finish(op, next);
        }
        if (!pending.size) break;
        await Promise.race(pending.values());
        if (error) { await Promise.all(pending.values()); break; }
        // Operators held back may be free now; the heap orders them by rank again.
        for (const op of held) df._heap.push(op);
        held.length = 0;
        heldSet.clear();
        memo = new Map();
      }
    } catch (err) {
      if (!error) error = { err };
      await Promise.all(pending.values());
    }
    if (error) df._heap.clear();

    df._input = {};
    df._pulse = null;
    df.debug(`Pulse ${stamp}: ${count} operators`);
    if (onStats) onStats({ maxConcurrent });
    if (error) { df._postrun = []; df.error((error as { err: any }).err); }

    if (df._postrun.length) {
      const pr = df._postrun.sort((a: any, b: any) => b.priority - a.priority);
      df._postrun = [];
      // A callback can start another evaluation with the synchronous run(), as Vega-Lite's
      // modify() does for selection stores. Vega's run() completes it before returning when no
      // operator is asynchronous; here operators are, so this evaluation waits for it.
      // With Vega, nothing outside the dataflow runs between this evaluation and the nested one.
      // Here something can, while the workers compute: a brush moved in the meantime touches
      // its signal. Those touches are kept for the next queued evaluation and not taken into
      // the nested one, as with Vega. Otherwise the nested evaluation takes the new brush
      // position, its own callbacks start another nested one, and during a drag the evaluation
      // does not return (so the view is not drawn) until the brush stops.
      const outer = df._pwNested;
      const external = df._touched;
      df._pwNested = [];
      df._touched = uniqueList(id);
      try {
        for (let i = 0; i < pr.length; ++i) {
          await asyncCallback(df, pr[i].callback);
          while (df._pwNested.length) await df._pwNested.shift();
        }
      } finally {
        df._pwNested = outer;
        external.forEach((op: any) => df._touched.add(op));
      }
    }
    if (postrun) await asyncCallback(df, postrun);
    if (async.length) {
      Promise.all(async).then(cb => df.runAsync(null, () => {
        cb.forEach((f: any) => { try { f(df); } catch (err) { df.error(err); } });
      }));
    }
    return df;
  };
  const entry = function (this: any, ...args: any[]) {
    // The list of the evaluation whose callback starts this one, read before this evaluation
    // runs (it runs synchronously up to its first await and sets up a list of its own).
    const parent = this._pwNested;
    const p = (evaluate as any).apply(this, args);
    if (parent) parent.push(p.catch(() => {}));
    return p;
  };
  (entry as any).$pwFarm = true;
  proto.evaluate = entry;
  // Vega adds an operator touched during an evaluation to that evaluation. With Vega only the
  // operators of the evaluation can touch then, since it holds the main thread. Here the
  // evaluation waits for the workers, and an input that arrives meanwhile, such as a brush
  // moved by the pointer, would join it: the evaluation then takes every new position and
  // does not end (and the view is not drawn) until the brush stops. A touch from outside the
  // running operators is therefore queued for the next evaluation, as Vega queues a touch
  // between evaluations.
  const originalTouch = proto.touch;
  const touch = function (this: any, op: any, options?: any) {
    if (!this._pulse || this._pwInRun) return originalTouch.call(this, op, options);
    this._touched.add(op);
    if (options && options.skip) op.skip(true);
    return this;
  };
  proto.touch = touch;
  return () => {
    if (proto.evaluate === entry) proto.evaluate = original;
    if (proto.touch === touch) proto.touch = originalTouch;
  };
}
