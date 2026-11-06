export function monitoringPolicies(config, workerName, adminName, siteName) {
  const channels = config.notificationChannels
  if (
    !Array.isArray(channels) ||
    !channels.length ||
    channels.some(x => !new RegExp(`^projects/${config.projectId}/notificationChannels/[0-9]+$`).test(x))
  )
    throw Error('Supply a verified, target-project owner notification channel before enabling scheduling.')
  const base = {
    combiner: 'OR',
    enabled: true,
    notificationChannels: channels,
    userLabels: { cms_installation: config.servicePrefix.replaceAll('-', '_') },
  }
  return [
    {
      ...base,
      displayName: config.servicePrefix + ' — runtime or backup failure',
      conditions: [
        {
          displayName: 'CMS runtime failure log',
          conditionMatchedLog: {
            filter: `((resource.type="cloud_run_revision" AND resource.labels.service_name=~"^${config.servicePrefix}-(admin|site|worker)$") OR (resource.type="cloud_run_job" AND resource.labels.job_name="${config.servicePrefix}-backup")) AND (severity>=ERROR OR jsonPayload.event="worker.pass.failed" OR jsonPayload.event="backup.failed" OR (jsonPayload.event="cms.operations" AND jsonPayload.status!="healthy"))`,
          },
        },
      ],
      alertStrategy: { notificationRateLimit: { period: '300s' }, autoClose: '1800s' },
    },
    {
      ...base,
      displayName: config.servicePrefix + ' — worker response missing',
      conditions: [
        {
          displayName: 'No worker success for five minutes',
          conditionAbsent: {
            filter: `metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="${workerName}" AND metric.labels.response_code_class="2xx"`,
            duration: '300s',
            aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' }],
            trigger: { count: 1 },
          },
        },
      ],
    },
    {
      ...base,
      displayName: config.servicePrefix + ' — public errors or saturation',
      conditions: [
        {
          displayName: 'Five errors/rejections in five minutes',
          conditionThreshold: {
            filter: `metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND (resource.labels.service_name="${adminName}" OR resource.labels.service_name="${siteName}") AND (metric.labels.response_code_class="5xx" OR metric.labels.response_code="429")`,
            comparison: 'COMPARISON_GT',
            thresholdValue: 4,
            duration: '0s',
            aggregations: [
              { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' },
            ],
            trigger: { count: 1 },
          },
        },
      ],
    },
    {
      ...base,
      displayName: config.servicePrefix + ' — backup missing',
      conditions: [
        {
          displayName: 'No completed backup for 23.5 hours',
          conditionAbsent: {
            filter: `metric.type="logging.googleapis.com/user/${config.servicePrefix}-backup-success" AND resource.type="cloud_run_job"`,
            duration: '84600s',
            aggregations: [
              { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' },
            ],
            trigger: { count: 1 },
          },
        },
      ],
    },
  ]
}
