// app.js

let token = sessionStorage.getItem("token");
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
  setupVisualSimulation();
  updateUserMenu();

  if (token) {
    initApp();
    toggleDisplay("auth-section", false);
    toggleDisplay("simulation-selection", true);
    loadSimulations();
  }
});

function toggleDisplay(elementId, show) {
  const el = document.getElementById(elementId);
  if (el) el.style.display = show ? "block" : "none";
}

function updateUserMenu() {
  const userIcon = document.getElementById("user-icon");
  const userDropdown = document.getElementById("user-dropdown");

  if (userIcon && userDropdown) {
    if (token) {
      userIcon.textContent = "👤";
      userDropdown.innerHTML = `
        <a href="#profile">Perfil</a>
        <a href="#logout" onclick="logout()">Cerrar Sesión</a>
      `;
    } else {
      userIcon.textContent = "🔓";
      userDropdown.innerHTML = `
        <a href="#login" onclick="showAuth()">Iniciar Sesión</a>
        <a href="#register" onclick="showAuth()">Registrarse</a>
      `;
    }
  }
}

function logout() {
  sessionStorage.removeItem("token");
  token = null;
  updateUserMenu();
  alert("Sesión cerrada.");
  location.reload();
}

function showAuth() {
  toggleDisplay("auth-section", true);
  toggleDisplay("main-content", false);
}

function initApp() {
  getState("A");
  getState("B");
  getHistory();
  startRealtimeUpdates();
}

function startRealtimeUpdates() {
  stopRealtimeUpdates();
  updateInterval = setInterval(() => {
    getState("A");
    getState("B");
    getHistory();
  }, 1000);
}

function stopRealtimeUpdates() {
  if (updateInterval) clearInterval(updateInterval);
}

function getState(nodeId) {
  fetchWithAuth(`/state/${nodeId}`)
    .then(response => response.json())
    .then(data => {
      const currentStateElem = document.getElementById(`current-state-${nodeId}`);
      if (currentStateElem && currentStateElem.textContent !== data.state) {
        currentStateElem.textContent = data.state;
        const stateHistoryElem = document.getElementById(`state-history-${nodeId}`);
        if (stateHistoryElem) {
          const newStateItem = document.createElement("li");
          newStateItem.textContent = data.state;
          stateHistoryElem.appendChild(newStateItem);
        }
      }

      updateTCPParams(nodeId);
    })
    .catch(error => console.error("Error al obtener el estado del nodo:", error));
}

function fetchWithAuth(url, options = {}) {
  options.headers = { ...options.headers, Authorization: token };
  return fetch(url, options).then(response => {
    if (response.status === 401) {
      alert("Sesión expirada. Inicia sesión nuevamente.");
      sessionStorage.removeItem("token");
      stopRealtimeUpdates();
      location.reload();
    }
    return response;
  });
}

function register() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();

  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then(response => response.json())
    .then(data => {
      alert(data.success ? "Usuario registrado correctamente." : `Error: ${data.error}`);
    })
    .catch(error => console.error("Error en registro:", error));
}

function login() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();

  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        toggleDisplay("auth-section", false);
        toggleDisplay("simulation-selection", true);
        updateUserMenu();
        loadSimulations();
      } else {
        alert(`Error: ${data.error}`);
      }
    })
    .catch(error => console.error("Error en login:", error));
}

function loadSimulations() {
  fetchWithAuth("/simulations")
    .then(response => response.json())
    .then(data => {
      const simulationList = document.getElementById("simulation-list");
      if (simulationList) {
        simulationList.innerHTML = "";
        data.simulations.forEach(sim => {
          const listItem = document.createElement("li");
          listItem.textContent = `Simulación ${sim.id}`;
          listItem.onclick = () => selectSimulation(sim.id);
          simulationList.appendChild(listItem);
        });
      }
    })
    .catch(() => alert("Error al cargar simulaciones."));
}

function createNewSimulation() {
  fetchWithAuth("/createSimulations", {
    method: "POST",
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        alert("Nueva simulación creada.");
        loadSimulations();
      } else {
        alert("Error al crear simulación.");
      }
    })
    .catch(error => console.error("Error al crear simulación:", error));
}

function selectSimulation(simulationId) {
  fetchWithAuth("/enterSimulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulator_id: simulationId }),
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        toggleDisplay("simulation-selection", false);
        toggleDisplay("tcp-simulation", true);

        clearVisualization();
        clearStateHistories();
        initApp();
      } else {
        alert(`Error: ${data.error}`);
      }
    })
    .catch(error => console.error("Error al entrar en simulación:", error));
}

function goBackToSelection() {
  fetchWithAuth("/goBack")
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        toggleDisplay("tcp-simulation", false);
        toggleDisplay("simulation-selection", true);
        loadSimulations();
        stopRealtimeUpdates();
        clearStateHistories(); 
        clearVisualization();
      } else {
        alert(`Error: ${data.error}`);
      }
    })
    .catch(error => console.error("Error al volver a selección:", error));
}

function clearVisualization() {
  const svg = d3.select("#simulation-visual");
  if (svg) svg.selectAll("*").remove();
  setupVisualSimulation();
}

function clearStateHistories() {
  const stateHistoryA = document.getElementById("state-history-A");
  const stateHistoryB = document.getElementById("state-history-B");
  const currentStateA = document.getElementById("current-state-A");
  const currentStateB = document.getElementById("current-state-B");

  if (stateHistoryA) stateHistoryA.innerHTML = "";
  if (stateHistoryB) stateHistoryB.innerHTML = "";
  if (currentStateA) currentStateA.textContent = "";
  if (currentStateB) currentStateB.textContent = "";
}

function startSimulation() {
  const dataSizeA = document.getElementById("data-size-input-A")?.value || 0;
  const dataSizeB = document.getElementById("data-size-input-B")?.value || 0;
  const windowSize = document.getElementById("window-size-input")?.value || 1024;
  const mss = document.getElementById("mss-input")?.value || 1460;
  const lossRatio = document.getElementById("loss-ratio-input")?.value || 0;

  clearVisualization();
  clearStateHistories();

  fetchWithAuth("/start-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataSizeA, dataSizeB, windowSize, mss, lossRatio }),
  })
    .then(response => response.json())
    .then(data => {
      if (!data.success) {
        alert("Error: " + data.error);
      }
    })
    .catch(error => console.error("Error al iniciar simulación:", error));
}

function updateTCPParams(nodeId) {
  fetchWithAuth(`/param/${nodeId}`)
    .then(response => response.json())
    .then(data => {
      const paramsElem = document.getElementById(`tcp-params-${nodeId}`);
      if (paramsElem) {
        paramsElem.innerHTML = `
          <p>Puerto Origen: ${data.srcPort}</p>
          <p>Puerto Destino: ${data.destPort}</p>
          <p>Número de Secuencia (ISN): ${data.seqNum}</p>
          <p>Número de Acknowledgment: ${data.ackNum}</p>
          <p>Tamaño de Ventana: ${data.windowSize}</p>
          <p>MSS: ${data.MSS}</p>
          <p>Ratio de Pérdida: ${data.lossRatio}</p>
          <p>sendBase: ${data.sendBase}</p>
          <p>nextSeqNum: ${data.nextSeqNum}</p>
        `;
      }
    })
    .catch(() => console.error("Error al obtener los parámetros TCP."));
  }

// Variables para escala temporal lineal pura:
let messageData = [];
let earliestTime;
let latestTime;
let messageVerticalJitter = 5;
let timeThresholdForJitter = 200;
let timeScale; 

function getHistory() {
  fetchWithAuth(`/history`)
    .then(response => response.json())
    .then(data => {
      messageData = data.history;
      console.log("Mensajes recibidos, timestamps:", messageData.map(m => m.timestamp));

      if (messageData.length > 0) {
        createTimeScale(messageData);
        renderMessages(messageData);
      } else {
        const svg = d3.select("#simulation-visual");
        svg.selectAll("g[id^='message-']").remove();
      }
    })
    .catch(error => console.error("Error al obtener el historial de mensajes:", error));
}

function createTimeScale(messages) {
  let times = [];
  
  messages.forEach(m => {
    let param = JSON.parse(m.parameter_TCP);
    m.startTime = new Date(m.timestamp);
    let latency = param.latency || 0; 
    m.arrivalTime = new Date(m.startTime.getTime() + latency);
    times.push(m.startTime);
    times.push(m.arrivalTime);
  });

  earliestTime = new Date(Math.min(...times.map(t => t.getTime())));
  latestTime = new Date(Math.max(...times.map(t => t.getTime())));

  // Asignamos un rango vertical enorme (20000 px) para tener un zoom gigante
  timeScale = d3.scaleTime()
    .domain([earliestTime, latestTime])
    .range([50, 200]);
}

function renderMessages(messages) {
  const svg = d3.select("#simulation-visual");
  svg.selectAll("g[id^='message-']").remove();

  messages.sort((a, b) => a.startTime - b.startTime);

  // Jitter para mensajes muy cercanos en tiempo de inicio
  for (let i = 0; i < messages.length; i++) {
    let offsetCount = 0;
    for (let j = 0; j < i; j++) {
      const diff = messages[i].startTime - messages[j].startTime;
      if (Math.abs(diff) < timeThresholdForJitter) {
        offsetCount++;
      }
    }
    messages[i].jitterOffset = offsetCount * messageVerticalJitter;
  }

  messages.forEach(entry => {
    drawMessageArrowRealTime(entry);
  });

  updateSVGHeight();
}

function drawMessageArrowRealTime(entry) {
  const svg = d3.select("#simulation-visual");
  const arrowGroup = svg.append("g").attr("id", `message-${entry.id}`);

  let param = JSON.parse(entry.parameter_TCP);
  const activeFlags = Object.entries(param.flags)
    .filter(([_, value]) => value)
    .map(([key]) => key);

  const isA = entry.node_id === "A";
  const xA = 200;
  const xB = 600;

  const yStart = timeScale(entry.startTime) + (entry.jitterOffset || 0);
  const yEnd = timeScale(entry.arrivalTime);

  const xStart = isA ? xA : xB;
  const xEnd = isA ? xB : xA;

  let lineColor = "red";
  if (param.flags.SYN && param.flags.ACK) lineColor = "green";
  else if (param.flags.SYN) lineColor = "green";
  else if (param.flags.FIN) lineColor = "orange";
  else if (param.flags.ACK && !param.flags.SYN && !param.flags.FIN && param.len === 0) lineColor = "blue";
  else if (param.len > 0) lineColor = "red";

  arrowGroup.append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", lineColor)
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

  let messageText = `Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: ${activeFlags.join(", ")}, Len: ${param.len}\nLatencia: ${param.latency || 0} ms`;

  const tempText = arrowGroup.append("text")
    .attr("font-size", "12px")
    .text(messageText)
    .attr("visibility", "hidden");

  const textBBox = tempText.node().getBBox();
  tempText.remove();

  const textX = (xStart + xEnd) / 2;
  const textY = (yStart + yEnd) / 2 - 15; 
  const padding = 4;

  arrowGroup.append("rect")
    .attr("x", textX - textBBox.width / 2 - padding)
    .attr("y", textY - textBBox.height - padding / 2)
    .attr("width", textBBox.width + padding * 2)
    .attr("height", textBBox.height + padding)
    .attr("fill", "white")
    .attr("fill-opacity", 0.7)
    .attr("rx", 3)
    .attr("ry", 3);

  arrowGroup.append("text")
    .attr("x", textX)
    .attr("y", textY - textBBox.height / 4)
    .attr("font-size", "12px")
    .attr("fill", "black")
    .attr("text-anchor", "middle")
    .text(messageText);
}

function updateSVGHeight() {
  const svgElement = document.getElementById("simulation-visual");
  const lines = d3.selectAll("#simulation-visual line").nodes();

  const maxY = d3.max(lines, line =>
    Math.max(parseFloat(line.getAttribute("y1")), parseFloat(line.getAttribute("y2")))
  ) || 400;

  const requiredHeight = maxY + 50;
  svgElement.setAttribute("height", requiredHeight);

  // Ajustamos las lineas verticales A y B, y el eje de tiempo
  d3.select("#node-line-A").attr("y2", requiredHeight - 50);
  d3.select("#node-line-B").attr("y2", requiredHeight - 50);
  d3.select("#time-axis").attr("y2", requiredHeight - 50);

  if (timeScale && messageData.length > 0) {
    const svg = d3.select("#simulation-visual");
    svg.selectAll(".time-tick").remove();

    let dateRange = (latestTime - earliestTime);
    let tickCount = 10;
    let tickInterval = dateRange / tickCount;
    let ticks = [];
    for (let i = 0; i <= tickCount; i++) {
      let t = new Date(earliestTime.getTime() + tickInterval * i);
      ticks.push(t);
    }

    ticks.forEach(t => {
      let yPos = timeScale(t);
      svg.append("line")
        .attr("class", "time-tick")
        .attr("x1", 45)
        .attr("y1", yPos)
        .attr("x2", 50)
        .attr("y2", yPos)
        .attr("stroke", "gray");

      svg.append("text")
        .attr("class", "time-tick")
        .attr("x", 40)
        .attr("y", yPos + 3)
        .attr("text-anchor", "end")
        .attr("font-size", "10px")
        .text(d3.timeFormat("%H:%M:%S.%L")(t));
    });
  }
}

function setupArrowhead() {
  const svg = d3.select("#simulation-visual");

  svg.append("defs")
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 10)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "red");
}

function setupVisualSimulation() {
  const svg = d3.select("#simulation-visual");
  svg.html("");

  setupArrowhead();

  // Altura inicial, se ajustará con updateSVGHeight
  svg.attr("height", 400);

  svg.append("line")
    .attr("id", "node-line-A")
    .attr("x1", 200)
    .attr("y1", 50)
    .attr("x2", 200)
    .attr("y2", 350)
    .attr("stroke", "black")
    .attr("stroke-width", 3);

  svg.append("text")
    .attr("id", "node-label-A")
    .attr("x", 200)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .text("Nodo A")
    .attr("font-size", "14px")
    .attr("fill", "black");

  svg.append("line")
    .attr("id", "node-line-B")
    .attr("x1", 600)
    .attr("y1", 50)
    .attr("x2", 600)
    .attr("y2", 350)
    .attr("stroke", "black")
    .attr("stroke-width", 3);

  svg.append("text")
    .attr("id", "node-label-B")
    .attr("x", 600)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .text("Nodo B")
    .attr("font-size", "14px")
    .attr("fill", "black");

  svg.append("line")
    .attr("id", "time-axis")
    .attr("x1", 50)
    .attr("y1", 50)
    .attr("x2", 50)
    .attr("y2", 350)
    .attr("stroke", "gray")
    .attr("stroke-width", 1);

  svg.append("text")
    .attr("x", 30)
    .attr("y", 40)
    .attr("text-anchor", "end")
    .attr("font-size", "12px")
    .text("Tiempo");
}
