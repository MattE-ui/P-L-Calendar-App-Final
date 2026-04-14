/**
 * Foundation stub for future earnings-event ingestion.
 * @returns {Promise<Array<{sourceType:string,eventType:string,title:string,summary:string,body:string,ticker:string,canonicalTicker:string,country:string,region:string,importance:number,scheduledAt:string,sourceName:string,sourceUrl:string,sourceExternalId:string,metadataJson:object}>>}
 */
async function fetchFmpEarningsEvents() {
  return [
    {
      sourceType: 'earnings',
      eventType: 'earnings',
      title: 'Earnings Event (stub)',
      summary: 'Placeholder earnings item for phase 2 ingestion.',
      body: 'No live provider integration yet.',
      ticker: 'AAPL',
      canonicalTicker: 'AAPL',
      country: 'US',
      region: 'NA',
      importance: 80,
      scheduledAt: null,
      sourceName: 'Financial Modeling Prep',
      sourceUrl: null,
      sourceExternalId: null,
      metadataJson: { provider: 'fmpEarningsProvider', stub: true }
    }
  ];
}

module.exports = {
  fetchFmpEarningsEvents
};
