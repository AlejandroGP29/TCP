// index.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet"); // [MEJORA] Para seguridad de cabeceras HTTP
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { TCPNode, MessageTCP } = require("./tcpNode");
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const { exec } = require('child_process');
const fs = require('fs');
const PcapParser = require('pcap-parser');
const multer = require('multer');
const { promisify } = require('util');
const { body, validationResult } = require('express-validator');

// [MEJORA] Centralizar configuración en un objeto (sin separarlo en archivo aparte)
const config = {
  port: process.env.PORT || 3000,
  secretKey: process.env.SECRET_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
};

// Verificar SECRET_KEY
if (!config.secretKey) {
  console.error("ERROR: SECRET_KEY no está definida.");
  process.exit(1);
}

// (Opcional) Comprobar si Google OAuth está configurado:
if (!config.googleClientId || !config.googleClientSecret) {
  console.warn("Advertencia: Falta la configuración de GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET. Google OAuth podría fallar.");
}

const app = express();

// [MEJORA] Añadir helmet para seguridad de cabeceras
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://d3js.org"  // aquí añadimos la URL base del CDN
        ],
        // otras directivas, p.e. styleSrc, imgSrc, etc.
      },
    },
  })
);

// Promisificar DB
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));

// Middleware para parsear JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Configurar sesión y Passport antes que las rutas
app.use(session({
  secret: 'cadena_secreta_sesion', // [MEJORA] pon algo fuerte en producción
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Almacén de nodos en memoria
let simulations = {};

// Función para inicializar nodos
function initNodes(simulationId) {
  const nodeA = new TCPNode("A");
  const nodeB = new TCPNode("B");
  nodeA.setPartner(nodeB);
  nodeB.setPartner(nodeA);
  nodeB.state = nodeB.states.LISTEN; 
  simulations[simulationId] = { nodeA, nodeB };
}

// Middleware de autenticación
function authenticateToken(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: {
        message: "Acceso denegado",
        type: "AuthError",
        statusCode: 401
      }
    });
  }
  jwt.verify(token, config.secretKey, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: {
          message: "Token inválido",
          type: "AuthError",
          statusCode: 403
        }
      });
    }
    req.user = user;
    next();
  });
}

// Rutas de usuario
app.post("/register",
  [
    body('username').isEmail().withMessage('El nombre de usuario debe ser un email válido.'),
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const firstError = errors.array()[0].msg;
        return res.status(400).json({
          success: false,
          error: { message: firstError, type: "ValidationError", statusCode: 400 }
        });
      }

      const { username, password } = req.body;
      const hashedPassword = bcrypt.hashSync(password, 12);

      const query = "INSERT INTO Users (username, password_hash) VALUES (?, ?)";
      await db.runAsync(query, [username, hashedPassword]);

      res.json({ success: true, message: "Usuario registrado correctamente." });
    } catch (err) {
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({
          success: false,
          error: { message: "El usuario ya existe.", type: "ValidationError", statusCode: 400 }
        });
      }
      next(err);
    }
});

app.post("/login",
  [
    body('username').isEmail().withMessage('El nombre de usuario debe ser un email válido.'),
    body('password').notEmpty().withMessage('La contraseña es requerida.')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const firstError = errors.array()[0].msg;
        return res.status(400).json({
          success: false,
          error: { message: firstError, type: "ValidationError", statusCode: 400 }
        });
      }

      const { username, password } = req.body;
      const user = await db.getAsync("SELECT * FROM Users WHERE username = ?", [username]);

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(400).json({
          success: false,
          error: { message: "Credenciales incorrectas.", type: "AuthError", statusCode: 400 }
        });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username },
        config.secretKey,
        { expiresIn: "1h" }
      );
      res.json({ success: true, token });
    } catch (err) {
      next(err);
    }
});

// Rutas de simulaciones
app.get("/simulations", authenticateToken, async (req, res, next) => {
  try {
    const rows = await db.allAsync("SELECT * FROM Simulations WHERE user_id = ?", [req.user.id]);
    res.json({ success: true, simulations: rows });
  } catch (err) {
    next(err);
  }
});

app.post("/createSimulations", authenticateToken, async (req, res, next) => {
  try {
    await db.runAsync("INSERT INTO Simulations (user_id) VALUES (?)", [req.user.id]);
    res.json({ success: true, message: "Simulación creada correctamente." });
  } catch (err) {
    next(err);
  }
});

app.post("/enterSimulation", authenticateToken, async (req, res, next) => {
  try {
    const { simulator_id } = req.body;
    const row = await db.getAsync(
      "SELECT * FROM Simulations WHERE id = ? AND user_id = ?",
      [simulator_id, req.user.id]
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        error: { message: "Simulación no encontrada.", type: "NotFoundError", statusCode: 404 }
      });
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
      config.secretKey,
      { expiresIn: "1h" }
    );
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// [MEJORA] Validaciones en /start-simulation
app.post("/start-simulation",
  authenticateToken,
  [
    body('dataSizeA').isInt({ min: 0 }).withMessage('dataSizeA debe ser entero >= 0'),
    body('dataSizeB').isInt({ min: 0 }).withMessage('dataSizeB debe ser entero >= 0'),
    body('windowSize').isInt({ min: 1 }).withMessage('windowSize debe ser entero >= 1'),
    body('mss').isInt({ min: 1 }).withMessage('mss debe ser entero >= 1'),
    body('lossRatio').isFloat({ min: 0, max: 1 }).withMessage('lossRatio debe estar entre 0 y 1'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const firstError = errors.array()[0].msg;
        return res.status(400).json({
          success: false,
          error: { message: firstError, type: "ValidationError", statusCode: 400 }
        });
      }

      const { dataSizeA, dataSizeB, windowSize, mss, lossRatio } = req.body;
      const simulationId = req.user.simulation;
      const sim = simulations[simulationId];

      if (!sim) {
        return res.status(400).json({
          success: false,
          error: { message: "Simulación no inicializada.", type: "BadRequest", statusCode: 400 }
        });
      }

      sim.nodeA.windowSize = parseInt(windowSize) || 1024;
      sim.nodeB.windowSize = parseInt(windowSize) || 1024;

      await db.runAsync("DELETE FROM MessageHistory WHERE simulation_id = ?", [simulationId]);

      sim.nodeA.lossRatio = parseFloat(lossRatio) || 0;
      sim.nodeB.lossRatio = parseFloat(lossRatio) || 0;
      if (mss) {
        sim.nodeA.MSS = parseInt(mss) || 1460;
        sim.nodeB.MSS = parseInt(mss) || 1460;
      }

      sim.nodeA.startSimulation(parseInt(dataSizeA) || 0, simulationId);
      sim.nodeB.startSimulation(parseInt(dataSizeB) || 0, simulationId);

      res.json({ success: true, message: "Simulación iniciada." });
    } catch (error) {
      next(error);
    }
});

app.get("/state/:nodeId", authenticateToken, (req, res, next) => {
  try {
    const simulationId = req.user.simulation;
    const sim = simulations[simulationId];

    if (!sim) {
      return res.status(400).json({
        success: false,
        error: { message: "Simulación no inicializada.", type: "BadRequest", statusCode: 400 }
      });
    }

    const node = req.params.nodeId === "A" ? sim.nodeA : sim.nodeB;
    res.json({ state: node.state });
  } catch (error) {
    next(error);
  }
});

app.get("/history", authenticateToken, async (req, res, next) => {
  try {
    const simulationId = req.user.simulation;
    const rows = await db.allAsync(
      "SELECT * FROM MessageHistory WHERE simulation_id = ? ORDER BY timestamp",
      [simulationId]
    );
    res.json({ success: true, history: rows });
  } catch (error) {
    next(error);
  }
});

app.get("/param/:nodeId", authenticateToken, (req, res, next) => {
  try {
    const simulationId = req.user.simulation;
    const sim = simulations[simulationId];

    if (!sim) {
      return res.status(400).json({
        success: false,
        error: { message: "Simulación no inicializada.", type: "BadRequest", statusCode: 400 }
      });
    }

    const node = req.params.nodeId === "A" ? sim.nodeA : sim.nodeB;
    res.json(node.getParameters());
  } catch (error) {
    next(error);
  }
});

app.get("/goBack", authenticateToken, (req, res) => {
  const simulationId = req.user.simulation;
  delete simulations[simulationId];
  const token = jwt.sign({ id: req.user.id, username: req.user.username }, config.secretKey, {
    expiresIn: "1h",
  });
  res.json({ success: true, token });
});

app.post("/saveState", authenticateToken, async (req, res, next) => {
  try {
    const simulationId = req.user.simulation;
    const sim = simulations[simulationId];

    if (!sim) {
      return res.status(400).json({
        success: false,
        error: { message: "Simulación no inicializada.", type: "BadRequest", statusCode: 400 }
      });
    }

    const parameter_settings = JSON.stringify({
      nodeA: sim.nodeA.getParameters(),
      nodeB: sim.nodeB.getParameters(),
    });
    await db.runAsync(
      "UPDATE Simulations SET parameter_settings = ? WHERE id = ? AND user_id = ?", 
      [parameter_settings, simulationId, req.user.id]
    );

    res.json({ success: true, message: "Estado guardado correctamente." });
  } catch (err) {
    next(err);
  }
});

app.post("/loadState", authenticateToken, async (req, res, next) => {
  try {
    const simulationId = req.user.simulation;
    const row = await db.getAsync(
      "SELECT parameter_settings FROM Simulations WHERE id = ? AND user_id = ?",
      [simulationId, req.user.id]
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        error: { message: "No se encontró estado para esta simulación.", type: "NotFoundError", statusCode: 404 }
      });
    }
    if (!row.parameter_settings) {
      return res.status(400).json({
        success: false,
        error: { message: "No hay estado guardado.", type: "BadRequest", statusCode: 400 }
      });
    }

    const param = JSON.parse(row.parameter_settings);
    const sim = simulations[simulationId];
    if (!sim) {
      return res.status(400).json({
        success: false,
        error: { message: "Simulación no inicializada.", type: "BadRequest", statusCode: 400 }
      });
    }

    sim.nodeA.setNodeParameter(param.nodeA);
    sim.nodeB.setNodeParameter(param.nodeB);

    res.json({ success: true, message: "Estado cargado correctamente." });
  } catch (err) {
    next(err);
  }
});

// Google OAuth
passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser((id, done) => { done(null, { id }); });

passport.use(new GoogleStrategy({
  clientID: config.googleClientId,
  clientSecret: config.googleClientSecret,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = await db.getAsync("SELECT * FROM Users WHERE username = ?", [email]);
    if (user) {
      return done(null, user);
    } else {
      const dummyPassword = "google_oauth";
      await db.runAsync("INSERT INTO Users (username, password_hash) VALUES (?, ?)", [email, dummyPassword]);
      user = await db.getAsync("SELECT * FROM Users WHERE username = ?", [email]);
      return done(null, user);
    }
  } catch (err) {
    return done(err);
  }
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['email', 'profile'] }));
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/#login' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({ id: user.id, username: user.username }, config.secretKey, { expiresIn: "1h" });
    res.redirect(`/#main?token=${token}&username=${encodeURIComponent(user.username)}`);
  }
);

// Upload Wireshark
const upload = multer({ dest: 'uploads/' });

function parseTCPHeader(packet) {
  const buffer = packet.data;
  const { timestampSeconds, timestampMicroseconds } = packet.header;
  
  if (typeof timestampSeconds !== 'number' || typeof timestampMicroseconds !== 'number') {
    return null;
  }

  const timestamp = new Date((timestampSeconds * 1000) + (timestampMicroseconds / 1000));

  const ETH_LEN = 14;
  const ipHeader = buffer.slice(ETH_LEN);
  const ipVersion = ipHeader[0] >> 4; 
  if (ipVersion !== 4) {
    return null;
  }

  const ipHeaderLen = (ipHeader[0] & 0x0F) * 4;
  const totalLength = ipHeader.readUInt16BE(2);
  const ttl = ipHeader[8]; // TTL

  const tcpOffset = ETH_LEN + ipHeaderLen;
  if (tcpOffset + 20 > buffer.length) {
    return null;
  }

  const srcPort = buffer.readUInt16BE(tcpOffset);
  const destPort = buffer.readUInt16BE(tcpOffset + 2);
  const seqNum = buffer.readUInt32BE(tcpOffset + 4);
  const ackNum = buffer.readUInt32BE(tcpOffset + 8);

  const dataOffsetAndFlags = buffer.readUInt16BE(tcpOffset + 12);
  const dataOffset = (dataOffsetAndFlags >> 12) * 4;

  const reservedAndFlags = dataOffsetAndFlags & 0x0FFF;
  const ns = ((reservedAndFlags >> 8) & 0x01) === 1;
  const cwr = ((reservedAndFlags >> 7) & 0x01) === 1;
  const ece = ((reservedAndFlags >> 6) & 0x01) === 1;
  const urg = ((reservedAndFlags >> 5) & 0x01) === 1;
  const ackFlag = ((reservedAndFlags >> 4) & 0x01) === 1;
  const psh = ((reservedAndFlags >> 3) & 0x01) === 1;
  const rst = ((reservedAndFlags >> 2) & 0x01) === 1;
  const syn = ((reservedAndFlags >> 1) & 0x01) === 1;
  const fin = ((reservedAndFlags) & 0x01) === 1;

  const windowSize = buffer.readUInt16BE(tcpOffset + 14);

  const payloadLen = totalLength - ipHeaderLen - dataOffset;
  const payload = buffer.slice(tcpOffset + dataOffset, tcpOffset + dataOffset + payloadLen);
  const messageStr = payload.length > 0 ? payload.toString('utf8') : "";

  let mss = 1460; 
  if (dataOffset > 20) {
    let optionsOffset = tcpOffset + 20;
    let optionsLen = dataOffset - 20;
    let i = 0;
    while (i < optionsLen) {
      const kind = buffer[optionsOffset + i];
      if (kind === 0) {
        break;
      } else if (kind === 1) {
        i += 1;
        continue;
      } else if (kind === 2) {
        if (i + 3 < optionsLen) {
          const length = buffer[optionsOffset + i + 1];
          if (length === 4) {
            mss = buffer.readUInt16BE(optionsOffset + i + 2);
            i += 4;
          } else {
            i += length;
          }
        } else {
          i += 1;
        }
      } else {
        const length = buffer[optionsOffset + i + 1];
        i += length;
      }
    }
  }

  const flags = {
    NS: ns,
    CWR: cwr,
    ECE: ece,
    URG: urg,
    ACK: ackFlag,
    PSH: psh,
    RST: rst,
    SYN: syn,
    FIN: fin,
  };

  const latency = 0;

  return {
    srcPort, 
    destPort,
    seqNum,
    ackNum,
    windowSize,
    ttl,
    MSS: mss,
    ipVersion,
    latency,
    flags,
    message: messageStr,
    payloadLen,
    timestamp
  };
}

// Ejemplo adaptado a nuevo formato de errores
app.post("/uploadWireshark", authenticateToken, upload.single('wiresharkFile'), (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ 
      success: false,
      error: { message: "No se ha subido ningún archivo.", type: "BadRequest", statusCode: 400 }
    });
  }

  const originalExt = path.extname(req.file.originalname).toLowerCase();
  let filePath = req.file.path;

  async function parseFile(pcapFilePath) {
    const fileStream = fs.createReadStream(pcapFilePath);
    const parser = PcapParser.parse(fileStream);
    const packets = [];

    parser.on('packet', (packet) => {
      packets.push(packet);
    });

    parser.on('end', async () => {
      try {
        await db.runAsync("INSERT INTO Simulations (user_id) VALUES (?)", [req.user.id]);
        const row = await db.getAsync("SELECT last_insert_rowid() as lastID");
        const simulationId = row.lastID;

        for (const p of packets) {
          const tcpInfo = parseTCPHeader(p);
          if (!tcpInfo) continue;

          const node_id = tcpInfo.srcPort < tcpInfo.destPort ? "A" : "B";
          const msgParams = {
            srcPort: tcpInfo.srcPort,
            destPort: tcpInfo.destPort,
            seqNum: tcpInfo.seqNum,
            ackNum: tcpInfo.ackNum,
            windowSize: tcpInfo.windowSize,
            ttl: tcpInfo.ttl,
            MSS: tcpInfo.MSS,
            ipVersion: tcpInfo.ipVersion,
            latency: tcpInfo.latency,
          };
          const messageTCP = new MessageTCP(msgParams);
          messageTCP.flags = tcpInfo.flags;
          messageTCP.message = tcpInfo.message;
          messageTCP.len = tcpInfo.payloadLen;

          const msgTimestamp = tcpInfo.timestamp.toISOString();

          await db.runAsync(
            `INSERT INTO MessageHistory (simulation_id, node_id, timestamp, parameter_TCP, len)
             VALUES (?, ?, ?, ?, ?)`,
            [
              simulationId,
              node_id,
              msgTimestamp,
              JSON.stringify(messageTCP),
              tcpInfo.payloadLen
            ]
          );
        }
        fs.unlinkSync(pcapFilePath);
        res.json({ success: true, message: "Archivo Wireshark cargado correctamente.", simulationId });
      } catch (error) {
        fs.unlinkSync(pcapFilePath);
        next(error);
      }
    });

    parser.on('error', (err) => {
      fs.unlinkSync(pcapFilePath);
      next(err);
    });
  }

  if (originalExt === '.cap' || originalExt === '.pcapng') {
    const convertedPath = filePath + '.pcap';
    exec(`editcap -F pcap ${filePath} ${convertedPath}`, (error) => {
      fs.unlinkSync(filePath);
      if (error) {
        return next(new Error("No se pudo convertir el archivo a PCAP."));
      }
      parseFile(convertedPath);
    });
  } else if (originalExt === '.pcap') {
    parseFile(filePath);
  } else {
    fs.unlinkSync(filePath);
    return res.status(400).json({ 
      success: false,
      error: { message: "Formato de archivo no soportado (usa .cap, .pcap o .pcapng).", type: "BadRequest", statusCode: 400 }
    });
  }
});

// [MEJORA] Middleware final de manejo de errores con formato unificado
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  const status = err.status || 500;
  const type = status === 400 ? "BadRequest" :
               status === 401 ? "AuthError" :
               status === 403 ? "ForbiddenError" :
               status === 404 ? "NotFoundError" :
               "ServerError";

  res.status(status).json({
    success: false,
    error: {
      message: err.message || "Error interno del servidor.",
      type,
      statusCode: status
    }
  });
});

app.listen(config.port, () => {
  console.log(`Servidor en http://localhost:${config.port}`);
});
