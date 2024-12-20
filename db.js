// db.js
const sqlite3 = require("sqlite3").verbose();

// Sentencias SQL separadas en constantes para mayor legibilidad
const PRAGMA_FOREIGN_KEYS = "PRAGMA foreign_keys = ON";

const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_SIMULATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS Simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parameter_settings TEXT,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
  )
`;

const CREATE_MESSAGE_HISTORY_TABLE = `
  CREATE TABLE IF NOT EXISTS MessageHistory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    simulation_id INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    parameter_TCP TEXT NOT NULL,
    len INTEGER NOT NULL,
    FOREIGN KEY (simulation_id) REFERENCES Simulations(id) ON DELETE CASCADE
  )
`;

const CREATE_MESSAGE_HISTORY_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_messagehistory_simulation_id 
  ON MessageHistory(simulation_id)
`;

// Conexión a la base de datos
const db = new sqlite3.Database("database.db", (err) => {
  if (err) {
    console.error("Error al abrir la base de datos:", err.message);
  }
});

// Uso de serialize() para asegurar el orden de las operaciones
db.serialize(() => {
  // Habilitar llaves foráneas
  db.run(PRAGMA_FOREIGN_KEYS, (err) => {
    if (err) console.error("Error al habilitar las foreign keys:", err.message);
  });

  // Crear tabla Users
  db.run(CREATE_USERS_TABLE, (err) => {
    if (err) {
      console.error("Error al crear la tabla Users:", err.message);
    }
  });

  // Crear tabla Simulations
  db.run(CREATE_SIMULATIONS_TABLE, (err) => {
    if (err) {
      console.error("Error al crear la tabla Simulations:", err.message);
    }
  });

  // Crear tabla MessageHistory
  db.run(CREATE_MESSAGE_HISTORY_TABLE, (err) => {
    if (err) {
      console.error("Error al crear la tabla MessageHistory:", err.message);
    }
  });

  // Crear índice para mejorar consultas por simulation_id en MessageHistory
  db.run(CREATE_MESSAGE_HISTORY_INDEX, (err) => {
    if (err) {
      console.error("Error al crear el índice en MessageHistory:", err.message);
    }
  });
});

// Función para cerrar la base de datos de forma ordenada
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error("Error al cerrar la base de datos:", err.message);
    console.log("Base de datos cerrada correctamente.");
    process.exit(0);
  });
});

module.exports = db;
