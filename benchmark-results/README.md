# Benchmark results

The results reported in the paper, measured in Chrome on a 16-core laptop
(Vega 6.4.0, Vega-Lite 6.5.0).

| File | Contents |
|---|---|
| `vega/chrome-*-vega6-20261118T202245Z.json` | Ten unchanged specifications (`bench/operators-browser.cjs`): 1M and 10M rows, 1 and 16 workers, the pre-aggregation index |
| `vega/dense-browser-1m-vega6-20261118T104818Z.json` | Dense symbol marks at 1M rows |
| `vega/campaign-20261118T215755-vega6/` | Brushing campaign (`bench/run-campaign.sh --reps=5`): three-view, six-view and scatterplot dashboards against Vega, Vega's crossfilter transform, Mosaic and Falcon; accuracy check; machine state during the runs; `NOTES.md` lists what was rerun separately |

Each JSON file records the environment of its run (`env`), the raw result of
every repetition (`results`) and a summary with mean, standard deviation and
95% confidence interval per configuration (`summary`).
