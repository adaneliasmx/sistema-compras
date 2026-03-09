const fs = require('fs');
const path = require('path');
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './database/app.json');

function ensure() {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify({ users: [], suppliers: [], cost_centers: [], sub_cost_centers: [], catalog_items: [], requisitions: [], requisition_items: [], status_history: [] }, null, 2));
  }
}
function read() { ensure(); return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
function write(data) { ensure(); fs.writeFileSync(dbPath, JSON.stringify(data, null, 2)); }
function nextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id || 0)) + 1 : 1; }
module.exports = { read, write, nextId, dbPath };
