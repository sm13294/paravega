/**
 * pwfilter's parallel filter: ParaWeb's Filter, predicate-kernel form ( with change
 * detection) with a predicate generated from Vega's range and set filters.
 * Only the rows whose state changed are returned, so Vega can update
 * downstream operators and marks incrementally, as with its own filter.
 */
import { PredicateParam, planAggregate } from "./aggregate";
import { filterPredicate } from "./kernel";
import { ColumnTable } from "./table";
import { WorkerPool } from "./pool";
import { FilterDelta, FilterState } from "paraweb-js/resident";
import { filter as pwFilter } from "paraweb-js/resident";

export { FilterState } from "paraweb-js/resident";
export type { FilterDelta } from "paraweb-js/resident";

export async function runFilter(
  pool: WorkerPool, table: ColumnTable, filter: PredicateParam[], state: FilterState,
): Promise<FilterDelta> {
  if (state.n !== table.length) throw new Error("pwfilter: state does not match table length");
  const plan = await planAggregate(pool, table, { filter });
  return pwFilter(filterPredicate(plan.spec.filters), state, {
    pool, cols: plan.cols, args: { fp: plan.fp, sets: plan.sets },
  });
}
