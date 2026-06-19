const localHosts = new Set(["localhost", "127.0.0.1", ""]);
const isLocalDev = localHosts.has(window.location.hostname);

const productionWorkerBase = "https://saddle-library-airtable-proxy.phillysaddles.workers.dev";
const localWorkerBase = "http://127.0.0.1:8787";
const workerBase = isLocalDev ? localWorkerBase : productionWorkerBase;

window.SADDLE_CONFIG = {
  proxyUrl: `${workerBase}/api/saddles`,
  checkoutProxyUrl: `${workerBase}/api/checkouts`,
  contactProxyUrl: `${workerBase}/api/contact`,
  // Disable client-side Turnstile requirement locally.
  turnstileSiteKey: isLocalDev ? "" : "0x4AAAAAADfAMIncCjxi533J",
  tableName: "Saddles",
  view: "Grid view",
  pageSize: 100,
  useSampleData: false,
};
