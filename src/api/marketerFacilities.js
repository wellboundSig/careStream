import aurora from './aurora.js';

export const getMarketerFacilities = (marketerId) =>
  aurora.fetchAll('MarketerFacilities', {
    filterByFormula: `{marketer_id} = "${marketerId}"`,
  });

export const getMarketerFacilitiesByFacility = (facilityId) =>
  aurora.fetchAll('MarketerFacilities', {
    filterByFormula: `{facility_id} = "${facilityId}"`,
  });

export const createMarketerFacility = (fields) =>
  aurora.create('MarketerFacilities', fields);

export const updateMarketerFacility = (recordId, fields) =>
  aurora.update('MarketerFacilities', recordId, fields);

export const deleteMarketerFacility = (recordId) =>
  aurora.remove('MarketerFacilities', recordId);

export const getFacilities = () => aurora.fetchAll('Facilities');
