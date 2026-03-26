import airtable from './airtable.js';
const TABLE = 'DepartmentScopes';
export const getDepartmentScopes = () => airtable.fetchAll(TABLE);
export const createDepartmentScope = (fields) => airtable.create(TABLE, fields);
export const updateDepartmentScope = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteDepartmentScope = (id) => airtable.remove(TABLE, id);
