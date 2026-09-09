import aurora from './aurora.js';
const TABLE = 'Departments';
export const getDepartments = () => aurora.fetchAll(TABLE);
export const createDepartment = (fields) => aurora.create(TABLE, fields);
export const updateDepartment = (id, fields) => aurora.update(TABLE, id, fields);
export const deleteDepartment = (id) => aurora.remove(TABLE, id);
