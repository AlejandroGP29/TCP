// app.js
let token = sessionStorage.getItem("token");
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
  setupVisualSimulation();
  setupArrowhead();
  updateUserMenu();

  if (token) {
    initApp();
    toggleDisplay("auth-section", false);
    toggleDisplay("simulation-selection", true);
    loadSimulations();
  }
});

function toggleDisplay(elementId, show) {
  document.getElementById(elementId).style.display = show ? "block" : "none";
}

function updateUserMenu() {
  const userIcon = document.getElementById("user-icon");
  const userDropdown = document.getElementById("user-dropdown");

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
    .then((response) => response.json())
    .then((data) => {
      const currentStateElem = document.getElementById(`current-state-${nodeId}`);
      if (currentStateElem.textContent !== data.state) {
        currentStateElem.textContent = data.state;
        updateTransitionButtons(nodeId, data.state);
      }
    })
    .catch(() => alert("Error al obtener el estado del nodo."));
}

function getHistory() {
  fetchWithAuth(`/history`)
    .then((response) => response.json())
    .then((data) => {
      data.history.forEach((entry) => {
        if (!document.getElementById(`message-${entry.id}`)) {
          drawMessageArrow(entry);
        }
      });
    });
}

function updateTransitionButtons(nodeId, state) {
  const transitions = {
    CLOSED: ["listen", "send_syn"],
    LISTEN: ["send_syn", "close"],
    SYN_SENT: ["recv_syn_ack", "close"],
    SYN_RECEIVED: ["recv_ack", "close"],
    ESTABLISHED: ["close"],
    CLOSE_WAIT: ["send_fin"],
  };

  const actions = transitions[state] || [];
  const buttonContainer = document.getElementById(`transition-buttons-${nodeId}`);
  buttonContainer.innerHTML = "";
  buttonContainer.classList.add("transition-buttons");

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action;
    button.onclick = () => performTransition(nodeId, action);
    buttonContainer.appendChild(button);
  });

  if (state === "ESTABLISHED") {
    const input = document.createElement("input");
    input.type = "number";
    input.id = `data-size-input-${nodeId}`;
    input.placeholder = "Tamaño de datos (bytes)";
    buttonContainer.appendChild(input);

    const sendButton = document.createElement("button");
    sendButton.textContent = "Enviar";
    sendButton.onclick = () => startMessageExchange(nodeId);
    buttonContainer.appendChild(sendButton);
  }
}

function performTransition(nodeId, action) {
  fetchWithAuth(`/transition/${nodeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) alert("Error: " + data.error);
    });
}

function fetchWithAuth(url, options = {}) {
  options.headers = { ...options.headers, Authorization: token };
  return fetch(url, options).then((response) => {
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
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then((response) => response.json())
    .then((data) => {
      alert(data.success ? "Usuario registrado correctamente." : `Error: ${data.error}`);
    });
}

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then((response) => response.json())
    .then((data) => {
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
    });
}

function startMessageExchange(nodeId) {
  const dataSize = document.getElementById(`data-size-input-${nodeId}`).value || 0;
  fetchWithAuth(`/start-message-exchange/${nodeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataSize }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) alert("Error: " + data.error);
    });
}

function loadSimulations() {
  fetchWithAuth("/simulations")
    .then((response) => response.json())
    .then((data) => {
      const simulationList = document.getElementById("simulation-list");
      simulationList.innerHTML = "";
      data.simulations.forEach((sim) => {
        const listItem = document.createElement("li");
        listItem.textContent = `Simulación ${sim.id}`;
        listItem.onclick = () => selectSimulation(sim.id);
        simulationList.appendChild(listItem);
      });
    })
    .catch(() => alert("Error al cargar simulaciones."));
}

function createNewSimulation() {
  fetchWithAuth("/createSimulations", {
    method: "POST",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("Nueva simulación creada.");
        loadSimulations();
      } else {
        alert("Error al crear simulación.");
      }
    });
}

function selectSimulation(simulationId) {
  fetchWithAuth("/enterSimulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulator_id: simulationId }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        toggleDisplay("simulation-selection", false);
        toggleDisplay("tcp-simulation", true);
        initApp();
      } else {
        alert(`Error: ${data.error}`);
      }
    });
}

function goBackToSelection() {
  fetchWithAuth("/goBack")
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        toggleDisplay("tcp-simulation", false);
        toggleDisplay("simulation-selection", true);
        loadSimulations();
        stopRealtimeUpdates();
        clearVisualization();
      } else {
        alert(`Error: ${data.error}`);
      }
    });
}

function clearVisualization() {
  const svg = d3.select("#simulation-visual");
  svg.selectAll("*").remove();
  messageCount = 0;
  setupVisualSimulation();
}

function setupVisualSimulation() {
  const svg = d3.select("#simulation-visual");
  svg.html("");

  const initialHeight = 400;
  svg.attr("height", initialHeight);

  // Barra vertical para Nodo A
  svg.append("line")
    .attr("id", "node-line-A")
    .attr("x1", 200)
    .attr("y1", 50)
    .attr("x2", 200)
    .attr("y2", initialHeight - 50)
    .attr("stroke", "black")
    .attr("stroke-width", 3);

  // Etiqueta para Nodo A
  svg.append("text")
    .attr("id", "node-label-A")
    .attr("x", 200)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .text("Nodo A")
    .attr("font-size", "14px")
    .attr("fill", "black");

  // Barra vertical para Nodo B
  svg.append("line")
    .attr("id", "node-line-B")
    .attr("x1", 600)
    .attr("y1", 50)
    .attr("x2", 600)
    .attr("y2", initialHeight - 50)
    .attr("stroke", "black")
    .attr("stroke-width", 3);

  // Etiqueta para Nodo B
  svg.append("text")
    .attr("id", "node-label-B")
    .attr("x", 600)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .text("Nodo B")
    .attr("font-size", "14px")
    .attr("fill", "black");
}

let messageCount = 0;

function drawMessageArrow(entry) {
  const svg = d3.select("#simulation-visual");
  const arrowGroup = svg.append("g").attr("id", `message-${entry.id}`);

  let param = JSON.parse(entry.parameter_TCP);
  const activeFlags = Object.entries(param.flags)
    .filter(([key, value]) => value)
    .map(([key]) => key);

  const isA = entry.node_id === "A";
  const xStart = isA ? 200 : 600;
  const xEnd = isA ? 600 : 200;
  const yStart = 50 + messageCount * 50;
  const latency = param.latency || 100;
  const timeScale = 0.1;

  const yEnd = yStart + latency * timeScale;

  // Dibuja la flecha inclinada
  arrowGroup
    .append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", "red")
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

  // Calcular el ángulo
  const angle = calculateAngle(xStart, yStart, xEnd, yEnd);

  // Ajustar el ángulo y posición del texto si es necesario
  let textAngle = angle;
  let dy = -5;

  if (angle > 90 || angle < -90) {
    textAngle += 180;
  }

  // Texto del mensaje
  arrowGroup
    .append("text")
    .attr("x", (xStart + xEnd) / 2)
    .attr("y", (yStart + yEnd) / 2)
    .text(
      `Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: ${activeFlags.join(
        ", "
      )}, Len: ${entry.len}`
    )
    .attr("font-size", "12px")
    .attr("fill", "black")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `rotate(${textAngle}, ${(xStart + xEnd) / 2}, ${(yStart + yEnd) / 2})`
    )
    .attr("dy", dy);

  messageCount++;

  // Actualiza la altura del SVG y las barras verticales
  updateSVGHeight();
}

function calculateAngle(x1, y1, x2, y2) {
  const dy = y2 - y1;
  const dx = x2 - x1;
  const theta = Math.atan2(dy, dx);
  return (theta * 180) / Math.PI;
}

function updateSVGHeight() {
  const svgElement = document.getElementById("simulation-visual");
  const lines = d3.selectAll("#simulation-visual line").nodes();

  // Encontrar el máximo valor de Y de todas las flechas
  const maxY = d3.max(lines, (line) =>
    Math.max(parseFloat(line.getAttribute("y1")), parseFloat(line.getAttribute("y2")))
  );

  // Obtener la altura actual del SVG
  const currentHeight = parseFloat(svgElement.getAttribute("height")) || 400;

  // Determinar si es necesario aumentar la altura
  const requiredHeight = maxY + 50;

  if (requiredHeight > currentHeight) {
    svgElement.setAttribute("height", requiredHeight);

    // Actualizar las barras verticales
    d3.select("#node-line-A").attr("y2", requiredHeight - 50);
    d3.select("#node-line-B").attr("y2", requiredHeight - 50);
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
