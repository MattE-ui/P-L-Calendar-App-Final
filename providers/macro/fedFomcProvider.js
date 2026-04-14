/**
 * Foundation stub for future FOMC calendar ingestion.
 * @returns {Promise<Array<{sourceType:string,eventType:string,title:string,summary:string,body:string,country:string,region:string,importance:number,scheduledAt:string,sourceName:string,sourceUrl:string,sourceExternalId:string,metadataJson:object}>>}
 */
async function fetchFedFomcEvents() {
  return [
    {
      sourceType: 'macro',
      eventType: 'fomc',
      title: 'FOMC Meeting (stub)',
      summary: 'Placeholder event for provider wiring in phase 2.',
      body: 'No live provider integration yet.',
      country: 'US',
      region: 'NA',
      importance: 95,
      scheduledAt: null,
      sourceName: 'Federal Reserve',
      sourceUrl: null,
      sourceExternalId: null,
      metadataJson: { provider: 'fedFomcProvider', stub: true }
    }
  ];
}

module.exports = {
  fetchFedFomcEvents
};
