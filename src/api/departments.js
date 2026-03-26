import airtable from './airtable.js';
const TABLE = 'Departments';
export const getDepartments = () => airtable.fetchAll(TABLE);
export const createDepartment = (fields) => airtable.create(TABLE, fields);
export const updateDepartment = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteDepartment = (id) => airtable.remove(TABLE, id);
