// index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const TCPNode = require("./tcpNode");

const app = express();
const PORT = 3000;
const SECRET_KEY = process.env.SECRET_KEY || "clave_secreta_predeterminada";

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

let simulations = {};

function initNodes(simulationId) {
  const nodeA = new TCPNode("A");
  const nodeB = new TCPNode("B");
  nodeA.setPartner(nodeB);
  nodeB.setPartner(nodeA);
  nodeB.state = nodeB.states.LISTEN; // Nodo B inicia en estado LISTEN
  simulations[simulationId] = { nodeA, nodeB };
}

// Middleware de autenticación
function authenticateToken(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ error: "Acceso denegado" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: "Token inválido" });
    req.user = user;
    next();
  });
}

// Registro de usuarios
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  // Validación de entradas
  if (!username || !password || password.length < 6) {
    return res
      .status(400)
      .json({ error: "Datos inválidos. La contraseña debe tener al menos 6 caracteres." });
  }

  const hashedPassword = bcrypt.hashSync(password, 12);

  const query = "INSERT INTO Users (username, password_hash) VALUES (?, ?)";
  db.run(query, [username, hashedPassword], function (err) {
    if (err) {
      return res.status(400).json({ error: "El usuario ya existe." });
    }
    res.json({ success: true, message: "Usuario registrado correctamente." });
  });
});

// Inicio de sesión
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get("SELECT * FROM Users WHERE username = ?", [username], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(400).json({ error: "Credenciales incorrectas." });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, {
      expiresIn: "1h",
    });
    res.json({ success: true, token });
  });
});

// Obtener simulaciones del usuario
app.get("/simulations", authenticateToken, (req, res) => {
  db.all("SELECT * FROM Simulations WHERE user_id = ?", [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al cargar simulaciones." });
    res.json({ success: true, simulations: rows });
  });
});

// Crear nueva simulación
app.post("/createSimulations", authenticateToken, (req, res) => {
  const query = "INSERT INTO Simulations (user_id) VALUES (?)";
  db.run(query, [req.user.id], function (err) {
    if (err) return res.status(500).json({ error: "Error al crear la simulación." });
    res.json({ success: true, message: "Simulación creada correctamente." });
  });
});

// Entrar en una simulación
app.post("/enterSimulation", authenticateToken, (req, res) => {
  const { simulator_id } = req.body;

  db.get(
    "SELECT * FROM Simulations WHERE id = ? AND user_id = ?",
    [simulator_id, req.user.id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: "Simulación no encontrada." });
      }

      if (row.parameter_settings == null) {
        initNodes(simulator_id);
      } else {
        const param = JSON.parse(row.parameter_settings);
        const nodeA = new TCPNode("A");
        const nodeB = new TCPNode("B");
        nodeA.setNodeParameter(param.nodeA);
        nodeB.setNodeParameter(param.nodeB);
        nodeA.setPartner(nodeB);
        nodeB.setPartner(nodeA);
        simulations[simulator_id] = { nodeA, nodeB };
      }

      const token = jwt.sign(
        { id: req.user.id, username: req.user.username, simulation: simulator_id },
        SECRET_KEY,
        { expiresIn: "1h" }
      );
      res.json({ success: true, token });
    }
  );
});

// Iniciar simulación
app.post("/start-simulation", authenticateToken, (req, res) => {
  const { dataSizeA, dataSizeB, windowSize } = req.body;
  const simulationId = req.user.simulation;
  const sim = simulations[simulationId];

  if (!sim) {
    return res.status(400).json({ error: "Simulación no inicializada." });
  }

  try {
    sim.nodeA.windowSize = parseInt(windowSize) || 1024;
    sim.nodeB.windowSize = parseInt(windowSize) || 1024;

    // Limpiar el historial de mensajes de la simulación actual
    const deleteQuery = "DELETE FROM MessageHistory WHERE simulation_id = ?";
    db.run(deleteQuery, [simulationId], (err) => {
      if (err) {
        console.error("Error al limpiar el historial de mensajes:", err);
        return res.status(500).json({ error: "Error al iniciar la simulación." });
      }

      // Iniciar la simulación en ambos nodos con datos pendientes
      sim.nodeA.startSimulation(parseInt(dataSizeA) || 0, simulationId);
      sim.nodeB.startSimulation(parseInt(dataSizeB) || 0, simulationId);

      res.json({ success: true, message: "Simulación iniciada." });
    });
  } catch (error) {
    console.error("Error al iniciar la simulación:", error);
    res.status(500).json({ error: "Error al iniciar la simulación." });
  }
});

// Obtener estado del nodo
app.get("/state/:nodeId", authenticateToken, (req, res) => {
  const simulationId = req.user.simulation;
  const sim = simulations[simulationId];

  if (!sim) {
    return res.status(400).json({ error: "Simulación no inicializada." });
  }

  try {
    const node = req.params.nodeId === "A" ? sim.nodeA : sim.nodeB;
    res.json({ state: node.state });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el estado del nodo." });
  }
});

// Obtener historial de mensajes
app.get("/history", authenticateToken, (req, res) => {
  try {
    const simulationId = req.user.simulation;
    db.all(
      "SELECT * FROM MessageHistory WHERE simulation_id = ? ORDER BY timestamp",
      [simulationId],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "No se pudo recuperar el historial." });
        res.json({ success: true, history: rows });
      }
    );
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el historial de mensajes." });
  }
});

// Obtener parámetros del nodo
app.get("/param/:nodeId", authenticateToken, (req, res) => {
  const simulationId = req.user.simulation;
  const sim = simulations[simulationId];

  if (!sim) {
    return res.status(400).json({ error: "Simulación no inicializada." });
  }

  try {
    const node = req.params.nodeId === "A" ? sim.nodeA : sim.nodeB;
    res.json(node.getParameters());
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los parámetros del nodo." });
  }
});

// Volver a selección de simulación
app.get("/goBack", authenticateToken, (req, res) => {
  const simulationId = req.user.simulation;
  delete simulations[simulationId];
  const token = jwt.sign({ id: req.user.id, username: req.user.username }, SECRET_KEY, {
    expiresIn: "1h",
  });
  res.json({ success: true, token });
});

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
