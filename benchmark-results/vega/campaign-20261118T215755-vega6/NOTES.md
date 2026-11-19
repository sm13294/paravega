# Notes

This campaign repeats the brushing suites of campaign-20261118T120339-vega6 after
commit 6e4d5b2, which measures frame gaps with performance.now() instead of the
timestamp passed to requestAnimationFrame callbacks (the rAF timestamp was stale
after long busy periods, which inflated the stock drag gap at 1M rows).

The campaign's accuracy check printed the three-view synthetic rows only up to
mosaic-nopreagg and no three-view flights rows. The three-view rows in
accuracy.txt come from separate runs of test/backends-browser.cjs
(DASHBOARD=three, DATASETS=synthetic and DATASETS=flights, 1M rows) on
2026-11-19 at about 02:00, after the campaign; the original output is
accuracy-campaign.txt. The results are the same as in the previous campaign.

Two Mosaic runs timed out in the browser protocol (crossfilter-flights:
mosaic-nopreagg at 10M rows in rep 1, mosaic at 5M rows in rep 4); those
configurations report four repetitions.

tests-*.txt, copycost.json and scenes-*.json are copied from
campaign-20261118T120339-vega6 (Chromium; not part of the brushing suites).
