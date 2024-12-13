// app.js

let token = sessionStorage.getItem("token");
let updateInterval;

let messageData = [];
let earliestTime;
let latestTime;
let messageVerticalJitter = 5;
let timeThresholdForJitter = 200;
let timeScale; 
let tooltip;

let windowDataA = [];
let windowDataB = [];

document.addEventListener("DOMContentLoaded", () => {
  tooltip = d3.select("#tooltip");
  setupVisualSimulation();
  updateUserMenu();

  // Filtros
  document.getElementById("filter-syn").addEventListener("change", renderAll);
  document.getElementById("filter-ack").addEventListener("change", renderAll);
  document.getElementById("filter-fin").addEventListener("change", renderAll);
  document.getElementById("filter-data").addEventListener("change", renderAll);

  // Zoom temporal
  document.getElementById("time-zoom-input").addEventListener("input", () => {
    document.getElementById("time-zoom-value").textContent = document.getElementById("time-zoom-input").value;
    renderAll();
  });

  // Ratio de pérdida
  document.getElementById("loss-ratio-input").addEventListener("input", () => {
    let val = document.getElementById("loss-ratio-input").value;
    document.getElementById("loss-ratio-value").textContent = val;
    // Se aplicará al iniciar una nueva simulación
  });

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

  const windowChart = d3.select("#window-chart");
  if (windowChart) windowChart.selectAll("*").remove();
  windowDataA = [];
  windowDataB = [];
}

function clearStateHistories() {
  const historyA = document.getElementById("state-history-A");
  const historyB = document.getElementById("state-history-B");
  if (historyA) historyA.innerHTML = "";
  if (historyB) historyB.innerHTML = "";

  const currentStateA = document.getElementById("current-state-A");
  const currentStateB = document.getElementById("current-state-B");
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

function saveState() {
  fetchWithAuth("/saveState", { method: "POST" })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        alert("Estado guardado.");
      } else {
        alert("Error al guardar estado: " + data.error);
      }
    })
    .catch(error => console.error("Error al guardar estado:", error));
}

function loadState() {
  fetchWithAuth("/loadState", { method: "POST" })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        alert("Estado cargado.");
        // Después de cargar estado, refrescar info
        getState("A");
        getState("B");
        getHistory();
      } else {
        alert("Error al cargar estado: " + data.error);
      }
    })
    .catch(error => console.error("Error al cargar estado:", error));
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

        // Guardamos el windowSize con timestamp para dibujar el gráfico
        const now = Date.now();
        if (nodeId === "A") {
          windowDataA.push({time: now, windowSize: data.windowSize});
        } else {
          windowDataB.push({time: now, windowSize: data.windowSize});
        }

        drawWindowChart();
      }
    })
    .catch(() => console.error("Error al obtener los parámetros TCP."));
}

function getHistory() {
  fetchWithAuth(`/history`)
    .then(response => response.json())
    .then(data => {
      if (!data.success) return;
      messageData = data.history;
      console.log("Mensajes recibidos, timestamps:", messageData.map(m => m.timestamp));

      if (messageData.length > 0) {
        createTimeScale(messageData);
        renderMessages(messageData);

        const historyA = document.getElementById("state-history-A");
        const historyB = document.getElementById("state-history-B");
        if (historyA) historyA.innerHTML = "";
        if (historyB) historyB.innerHTML = "";

        messageData.forEach(msg => {
          const param = JSON.parse(msg.parameter_TCP);
          const activeFlags = Object.entries(param.flags)
            .filter(([_, v]) => v)
            .map(([k]) => k);
          
          const listItem = document.createElement("li");
          listItem.textContent = `Mensaje ID:${msg.id}, Node:${msg.node_id}, Seq:${param.seqNum}, Ack:${param.ackNum}, Flags:[${activeFlags.join(", ")}], Len:${msg.len}, Latencia:${param.latency || 0}ms`;

          if (msg.node_id === "A" && historyA) {
            historyA.appendChild(listItem);
          } else if (msg.node_id === "B" && historyB) {
            historyB.appendChild(listItem);
          }
        });

      } else {
        const svg = d3.select("#simulation-visual");
        svg.selectAll("g[id^='message-']").remove();

        const historyA = document.getElementById("state-history-A");
        const historyB = document.getElementById("state-history-B");
        if (historyA) historyA.innerHTML = "";
        if (historyB) historyB.innerHTML = "";
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

  let zoomVal = document.getElementById("time-zoom-input").value || 200;
  timeScale = d3.scaleTime()
    .domain([earliestTime, latestTime])
    .range([50, parseInt(zoomVal)]);
}

function renderAll() {
  if (messageData.length > 0) {
    createTimeScale(messageData);
    renderMessages(messageData);
    updateSVGHeight();
  }
}

function shouldDisplayMessage(param) {
  const syn = document.getElementById("filter-syn").checked;
  const ack = document.getElementById("filter-ack").checked;
  const fin = document.getElementById("filter-fin").checked;
  const data = document.getElementById("filter-data").checked;

  const flags = param.flags;
  let isData = param.len > 0 && !flags.SYN && !flags.FIN && !flags.ACK;

  if (flags.SYN && !syn) return false;
  if (flags.FIN && !fin) return false;
  if (flags.ACK && !flags.SYN && !flags.FIN && param.len === 0 && !ack) return false;
  if (isData && !data) return false;

  return true;
}

function renderMessages(messages) {
  const svg = d3.select("#simulation-visual");
  svg.selectAll("g[id^='message-']").remove();

  messages.sort((a, b) => a.startTime - b.startTime);

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
    let param = JSON.parse(entry.parameter_TCP);
    if (shouldDisplayMessage(param)) {
      drawMessageArrowRealTime(entry);
    }
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

  const line = arrowGroup.append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", lineColor)
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

  let messageText = `Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: ${activeFlags.join(", ")}, Len: ${param.len}, Latencia: ${param.latency || 0} ms`;

  // Tooltip events
  line.on("mouseover", (event) => {
    tooltip.style("opacity", 1)
      .html(messageText)
      .style("left", (event.pageX + 5) + "px")
      .style("top", (event.pageY + 5) + "px");
  }).on("mouseout", () => {
    tooltip.style("opacity", 0);
  });

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
  drawWindowChart();
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
}

function drawWindowChart() {
  const windowChart = d3.select("#window-chart");
  if (!windowChart.node()) return;

  windowChart.selectAll("*").remove();

  // Creamos escalas
  const timesA = windowDataA.map(d => d.time);
  const timesB = windowDataB.map(d => d.time);
  const allTimes = timesA.concat(timesB);
  if (allTimes.length === 0) return;

  const minT = d3.min(allTimes);
  const maxT = d3.max(allTimes);
  const maxW = Math.max(d3.max(windowDataA, d => d.windowSize) || 0, d3.max(windowDataB, d => d.windowSize) || 0);

  const xScale = d3.scaleTime()
    .domain([new Date(minT), new Date(maxT)])
    .range([50, 750]);

  const yScale = d3.scaleLinear()
    .domain([0, maxW || 1])
    .range([150, 50]);

  const lineA = d3.line()
    .x(d => xScale(new Date(d.time)))
    .y(d => yScale(d.windowSize));

  const lineB = d3.line()
    .x(d => xScale(new Date(d.time)))
    .y(d => yScale(d.windowSize));

  windowChart.append("line")
    .attr("x1", 50)
    .attr("y1", 150)
    .attr("x2", 750)
    .attr("y2", 150)
    .attr("stroke", "#ccc");

  windowChart.append("text")
    .attr("x", 400)
    .attr("y", 180)
    .attr("text-anchor", "middle")
    .text("Evolución de Window Size");

  if (windowDataA.length > 0) {
    windowChart.append("path")
      .datum(windowDataA)
      .attr("d", lineA)
      .attr("stroke", "blue")
      .attr("fill", "none");

    windowChart.append("text")
      .attr("x", 60)
      .attr("y", 60)
      .attr("fill", "blue")
      .text("Nodo A WindowSize");
  }

  if (windowDataB.length > 0) {
    windowChart.append("path")
      .datum(windowDataB)
      .attr("d", lineB)
      .attr("stroke", "green")
      .attr("fill", "none");

    windowChart.append("text")
      .attr("x", 60)
      .attr("y", 80)
      .attr("fill", "green")
      .text("Nodo B WindowSize");
  }

  // Ejes
  const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat("%H:%M:%S"));
  const yAxis = d3.axisLeft(yScale).ticks(5);

  windowChart.append("g")
    .attr("transform", "translate(0,150)")
    .call(xAxis);

  windowChart.append("g")
    .attr("transform", "translate(50,0)")
    .call(yAxis);
}
