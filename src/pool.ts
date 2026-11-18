/**
 * The worker pool is ParaWeb's resident runtime (src/resident in ParaWeb).
 * paraweb-vega adds no worker code of its own: the Vega-specific kernels
 * are generated here as source strings and compiled by ParaWeb's generic
 * resident worker.
 */
export {
  ResidentPool as WorkerPool, Priority, LOW_SHARE,
  browserWorkerFactory, nodeWorkerFactory, inlineWorkerFactory, defaultThreads,
} from "paraweb-js/resident";
export type { PriorityLevel, WorkerFactory, WorkerLike } from "paraweb-js/resident";
