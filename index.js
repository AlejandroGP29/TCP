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

// Inicialización de nodos
const nodeA = new TCPNode("A");
const nodeB = new TCPNode("B");
nodeA.setPartner(nodeB);
nodeB.setPartner(nodeA);

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

// Registro y autenticación de usuarios
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || password.length < 6) {
    return res.status(400).json({ error: "Datos inválidos. La contraseña debe tener al menos 6 caracteres." });
  }
  const hashedPassword = bcrypt.hashSync(password, 12);

  db.run("INSERT INTO Users (username, password) VALUES (?, ?)", [username, hashedPassword], (err) => {
    if (err) return res.status(400).json({ error: "El usuario ya existe." });
    res.json({ success: true, message: "Usuario registrado correctamente." });
  });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM Users WHERE username = ?", [username], (err, user) => {
    if (err || !user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: "Credenciales incorrectas." });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: "1h" });
    res.json({ success: true, token });
  });
});

// Iniciar la simulación de mensajes
app.post("/transition/:nodeId", authenticateToken, (req, res) => {
  const { action } = req.body;
  try {
    const node = req.params.nodeId === "A" ? nodeA : nodeB;
    node.transition(action, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error("Error en la transicion:", error);
    res.status(500).json({ success: false, error: "Error al iniciar al hacer la transicion." });
  }
});

// Iniciar la simulación de mensajes
app.post("/start-message-exchange/:nodeId", authenticateToken, (req, res) => {
  const { dataSize } = req.body;
  try {
    const node = req.params.nodeId === "A" ? nodeA : nodeB;
    node.dataToSend = dataSize;
    node.sendData(dataSize, req.user.id)
    res.json({ success: true, message: "Intercambio de mensajes iniciado." });
  } catch (error) {
    console.error("Error en el intercambio:", error);
    res.status(500).json({ success: false, error: "Error al iniciar el intercambio de mensajes." });
  }
});

// Estado y detalles del nodo
app.get("/state/:nodeId", authenticateToken, (req, res) => {
  try {
    const node = req.params.nodeId === "A" ? nodeA : nodeB;
    res.json({ state: node.state});
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el estado del nodo" });
  }
});

// Historial de mensajes del nodo
app.get("/history/:nodeId", authenticateToken, (req, res) => {
  try {
    const nodeId = req.params.nodeId;
    const userId = req.user.id;
    db.all(`SELECT * FROM TransferHistory WHERE node_id = ? AND user_id = ? ORDER BY timestamp`, [nodeId, userId], (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: "No se pudo recuperar el historial." });
      res.json({ success: true, history: rows });
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el historial de mensajes" });
  }
});

// Estado y detalles del nodo
app.get("/param/:nodeId", authenticateToken, (req, res) => {
  try {
    const node = req.params.nodeId === "A" ? nodeA : nodeB;
    res.json({ seqNum: node.seqNum, ackNum: node.ackNum, windowSize: node.windowSize, ttl: node.ttl});
  } catch (error) {
    res.status(500).json({ error: "Error al obtener el estado del nodo" });
  }
});

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));