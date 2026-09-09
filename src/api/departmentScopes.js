import aurora from './aurora.js';
const TABLE = 'DepartmentScopes';
export const getDepartmentScopes = () => aurora.fetchAll(TABLE);
export const createDepartmentScope = (fields) => aurora.create(TABLE, fields);
export const updateDepartmentScope = (id, fields) => aurora.update(TABLE, id, fields);
export const deleteDepartmentScope = (id) => aurora.remove(TABLE, id);
