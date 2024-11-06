// db.js
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("database.db", (err) => {
  if (err) console.error("Error al abrir la base de datos:", err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS TransferHistory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  node_id TEXT,
  seq_num INTEGER,
  ack_num INTEGER,
  data_size INTEGER,
  message TEXT,
  src_port INTEGER,
  dest_port INTEGER,
  ttl INTEGER,
  flags TEXT,
  checksum INTEGER,
  data_offset INTEGER,
  reserved INTEGER,
  urgent_pointer INTEGER,
  options TEXT,
  padding INTEGER,
  window_size INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT
)`);

module.exports = db;
