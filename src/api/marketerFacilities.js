import airtable from './airtable.js';

export const getMarketerFacilities = (marketerId) =>
  airtable.fetchAll('MarketerFacilities', {
    filterByFormula: `{marketer_id} = "${marketerId}"`,
  });

export const getFacilities = () => airtable.fetchAll('Facilities');
