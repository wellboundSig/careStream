import airtable from './airtable.js';

export const getMarketerFacilities = (marketerId) =>
  airtable.fetchAll('MarketerFacilities', {
    filterByFormula: `{marketer_id} = "${marketerId}"`,
  });

export const getMarketerFacilitiesByFacility = (facilityId) =>
  airtable.fetchAll('MarketerFacilities', {
    filterByFormula: `{facility_id} = "${facilityId}"`,
  });

export const createMarketerFacility = (fields) =>
  airtable.create('MarketerFacilities', fields);

export const updateMarketerFacility = (recordId, fields) =>
  airtable.update('MarketerFacilities', recordId, fields);

export const deleteMarketerFacility = (recordId) =>
  airtable.remove('MarketerFacilities', recordId);

export const getFacilities = () => airtable.fetchAll('Facilities');
