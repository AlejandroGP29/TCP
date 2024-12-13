// db.js
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("database.db", (err) => {
  if (err) console.error("Error al abrir la base de datos:", err.message);
});

db.run("PRAGMA foreign_keys = ON");

db.run(`CREATE TABLE IF NOT EXISTS Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS Simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  parameter_settings TEXT,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
)`);

db.run(`CREATE TABLE IF NOT EXISTS MessageHistory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  simulation_id INTEGER NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  parameter_TCP TEXT NOT NULL,
  len INTEGER NOT NULL,
  FOREIGN KEY (simulation_id) REFERENCES Simulations(id) ON DELETE CASCADE
)`);

module.exports = db;
