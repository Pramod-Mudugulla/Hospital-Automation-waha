const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const execData = db.prepare('SELECT data FROM execution_data WHERE executionId = 85').get();

// n8n flattens objects into an array with index pointers
const arr = JSON.parse(execData.data);

function unflatten(val) {
  if (typeof val === 'string' && !isNaN(val) && arr[val] !== undefined) {
    return unflatten(arr[val]);
  }
  if (Array.isArray(val)) {
    return val.map(unflatten);
  }
  if (val && typeof val === 'object') {
    const res = {};
    for (const k of Object.keys(val)) {
      res[k] = unflatten(val[k]);
    }
    return res;
  }
  return val;
}

const root = unflatten(arr[0]);
console.log('Unflattened Execution 85:');
const runData = root.resultData.runData;
console.log('WAHA Webhook Inbound Output:', JSON.stringify(runData['WAHA Webhook Inbound'], null, 2).slice(0, 1500));
console.log('Parse WAHA Output:', JSON.stringify(runData['Parse WAHA Payload & Guardrails'], null, 2).slice(0, 1500));
console.log('Confirm in DemoCare HMS Output:', JSON.stringify(runData['Confirm in DemoCare HMS'], null, 2).slice(0, 1500));
