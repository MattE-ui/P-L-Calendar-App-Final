/**
 * Foundation stub for future BLS CPI release ingestion.
 * @returns {Promise<Array<{sourceType:string,eventType:string,title:string,summary:string,body:string,country:string,region:string,importance:number,scheduledAt:string,sourceName:string,sourceUrl:string,sourceExternalId:string,metadataJson:object}>>}
 */
async function fetchBlsCpiEvents() {
  return [
    {
      sourceType: 'macro',
      eventType: 'cpi',
      title: 'US CPI Release (stub)',
      summary: 'Placeholder CPI release for phase 2 ingestion.',
      body: 'No live provider integration yet.',
      country: 'US',
      region: 'NA',
      importance: 90,
      scheduledAt: null,
      sourceName: 'Bureau of Labor Statistics',
      sourceUrl: null,
      sourceExternalId: null,
      metadataJson: { provider: 'blsCpiProvider', stub: true }
    }
  ];
}

module.exports = {
  fetchBlsCpiEvents
};
