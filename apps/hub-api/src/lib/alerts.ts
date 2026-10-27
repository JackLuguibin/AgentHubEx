/** Thresholds match architecture 12.4 and deploy/observability/alerts.yml. */

export type AlertSample = {
  http5xxRatio: number;
  proxyP95Seconds: number;
  instanceUnhealthyMinutes: number;
  provisionP95Seconds: number;
  applyFailedRatio: number;
  quotaRatio: number;
  nodeFreeRatio: number;
};

export function firingAlerts(sample: AlertSample): string[] {
  const fired: string[] = [];
  if (sample.http5xxRatio > 0.02) fired.push("Hub5xxRatioHigh");
  if (sample.proxyP95Seconds > 2) fired.push("HubProxyLatencyHigh");
  if (sample.instanceUnhealthyMinutes > 5) fired.push("HubInstanceUnhealthy");
  if (sample.provisionP95Seconds > 120) fired.push("HubProvisionSlow");
  if (sample.applyFailedRatio > 0.1) fired.push("HubApplyFailedRatio");
  if (sample.quotaRatio >= 1) fired.push("HubTokenQuotaExceeded");
  else if (sample.quotaRatio >= 0.8) fired.push("HubTokenQuotaWarning");
  if (sample.nodeFreeRatio < 0.1) fired.push("NodeCapacityLow");
  return fired;
}

const QUIET: AlertSample = {
  http5xxRatio: 0.01,
  proxyP95Seconds: 0.4,
  instanceUnhealthyMinutes: 1,
  provisionP95Seconds: 30,
  applyFailedRatio: 0.02,
  quotaRatio: 0.2,
  nodeFreeRatio: 0.5,
};

const INCIDENT: AlertSample = {
  http5xxRatio: 0.05,
  proxyP95Seconds: 3,
  instanceUnhealthyMinutes: 6,
  provisionP95Seconds: 180,
  applyFailedRatio: 0.2,
  quotaRatio: 1,
  nodeFreeRatio: 0.05,
};

const EXPECTED = [
  "Hub5xxRatioHigh",
  "HubProxyLatencyHigh",
  "HubInstanceUnhealthy",
  "HubProvisionSlow",
  "HubApplyFailedRatio",
  "HubTokenQuotaExceeded",
  "NodeCapacityLow",
];

/** Synthetic drill: a quiet window stays silent, an incident fires every production page. */
export function runAlertDrill() {
  const quietFired = firingAlerts(QUIET);
  const warningFired = firingAlerts({ ...QUIET, quotaRatio: 0.85 });
  const incidentFired = firingAlerts(INCIDENT);
  const passed =
    quietFired.length === 0 &&
    warningFired.includes("HubTokenQuotaWarning") &&
    !warningFired.includes("HubTokenQuotaExceeded") &&
    EXPECTED.every((name) => incidentFired.includes(name));
  return { passed, quietFired, warningFired, incidentFired };
}
