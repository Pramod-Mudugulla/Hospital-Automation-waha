const { db } = require('../server/db');

console.log('=== PATIENTS ===');
console.log(db.prepare('SELECT * FROM patients ORDER BY updated_at DESC LIMIT 5').all());

console.log('\n=== LEADS ===');
console.log(db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5').all());

console.log('\n=== APPOINTMENTS ===');
console.log(db.prepare('SELECT * FROM appointments ORDER BY created_at DESC LIMIT 5').all());

console.log('\n=== COMMUNICATION LOGS ===');
console.log(db.prepare('SELECT * FROM communication_logs ORDER BY sent_at DESC LIMIT 5').all());

console.log('\n=== FOLLOW UPS ===');
console.log(db.prepare('SELECT * FROM follow_ups ORDER BY created_at DESC LIMIT 5').all());

console.log('\n=== EXCEPTIONS ===');
console.log(db.prepare('SELECT * FROM exceptions ORDER BY created_at DESC LIMIT 5').all());
