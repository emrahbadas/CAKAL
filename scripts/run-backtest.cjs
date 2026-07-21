const path = require('path');
const { buildBacktestSummary, loadBacktestDataset, runFinanceSignalBacktest } = require('../apps/desktop/electron/backtest-runner.cjs');

function main() {
  const datasetArg = process.argv[2];
  if (!datasetArg) {
    console.error('Kullanım: node scripts/run-backtest.cjs <dataset.json>');
    process.exit(1);
  }

  const datasetPath = path.resolve(process.cwd(), datasetArg);
  const dataset = loadBacktestDataset(datasetPath);
  const report = runFinanceSignalBacktest(dataset);
  console.log(buildBacktestSummary(report));
  console.log(JSON.stringify(report.metrics, null, 2));
}

main();