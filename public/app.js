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
  console.log("DOMContentLoaded - iniciando router, updateUserMenu, etc.");
  
  initRouter();
  setupVisualSimulation();
  updateUserMenu();
  updateMainViewButtons();
  updateProfileView();
  setupHamburgerMenu();

  document.getElementById("filter-syn")?.addEventListener("change", renderAll);
  document.getElementById("filter-ack")?.addEventListener("change", renderAll);
  document.getElementById("filter-fin")?.addEventListener("change", renderAll);
  document.getElementById("filter-data")?.addEventListener("change", renderAll);

  const zoomInput = document.getElementById("time-zoom-input");
  if (zoomInput) {
    zoomInput.addEventListener("input", () => {
      document.getElementById("time-zoom-value").textContent = zoomInput.value;
      renderAll();
    });
  }

  const lossRatioInput = document.getElementById("loss-ratio-input");
  if (lossRatioInput) {
    lossRatioInput.addEventListener("input", () => {
      let val = lossRatioInput.value;
      document.getElementById("loss-ratio-value").textContent = val;
    });
  }

  if (token) {
    console.log("Ya hay un token guardado, iniciando la app...");
    initApp();
    toggleDisplay("login", false);
    toggleDisplay("register", false);
    toggleDisplay("simulation-selection", true);
    loadSimulations();
  } else {
    console.log("No hay token, el usuario no ha iniciado sesión.");
  }
});

function initRouter() {
  console.log("Iniciando router...");
  window.addEventListener('hashchange', showViewFromHash);
  showViewFromHash();
}

function showViewFromHash() {
  let hash = window.location.hash.replace('#', '');
  if (!hash) {
    hash = 'main';
  }
  console.log("Cambió hash a:", hash);

  // Comprobar si se intenta acceder a la sección 'simulation-selection' sin estar logueado
  if (hash === 'simulation-selection' && !token) {
    // Usuario no logueado, redireccionar a la vista 'main' o 'login'
    alert("Debes iniciar sesión para acceder a la selección de simulaciones.");
    window.location.hash = 'login';
    return; // salir de la función para evitar continuar con vista no permitida
  }

  const views = document.querySelectorAll('.view');
  views.forEach(view => view.classList.remove('active'));

  const targetView = document.getElementById(hash);
  if (targetView) {
    targetView.classList.add('active');
    console.log("Vista activa:", hash);
  } else {
    console.log("No se encontró la vista para el hash:", hash);
  }

  updateMainViewButtons();
  updateProfileView();
  updateAriaCurrent(hash);
}


function updateAriaCurrent(hash) {
  const navLinks = document.querySelectorAll('.nav-links a[data-hash]');
  navLinks.forEach(link => {
    if (link.getAttribute('data-hash') === hash) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

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
        <a href="#login">Iniciar Sesión</a>
        <a href="#register">Registrarse</a>
      `;
    }
  }
}

function updateMainViewButtons() {
  const mainActionButtons = document.getElementById("main-action-buttons");
  const welcomeMessage = document.getElementById("welcome-message");
  if (!mainActionButtons || !welcomeMessage) return;
  
  mainActionButtons.innerHTML = "";
  
  if (token) {
    const username = sessionStorage.getItem("username");
    welcomeMessage.innerHTML = `<h2>Bienvenido${username ? ', ' + username : ''}!</h2><p>Ya puedes acceder a tus simulaciones guardadas.</p>`;
    
    const btn = document.createElement("button");
    btn.textContent = "Ir a Selección de Simulación";
    btn.onclick = () => {
      window.location.hash = "simulation-selection";
    };
    mainActionButtons.appendChild(btn);
  } else {
    welcomeMessage.innerHTML = `<h2>Bienvenido a la Simulación TCP</h2><p>Por favor, inicia sesión o regístrate para comenzar.</p>`;
    
    const btnLogin = document.createElement("button");
    btnLogin.textContent = "Iniciar Sesión";
    btnLogin.onclick = () => {
      window.location.hash = "login";
    };
    mainActionButtons.appendChild(btnLogin);

    const btnRegister = document.createElement("button");
    btnRegister.textContent = "Registrarse";
    btnRegister.onclick = () => {
      window.location.hash = "register";
    };
    mainActionButtons.appendChild(btnRegister);
  }
}

function updateProfileView() {
  const profileContainer = document.getElementById("profile-container");
  if (!profileContainer) return;

  if (token && sessionStorage.getItem("username")) {
    profileContainer.innerHTML = `
      <p>Estás conectado como: <strong>${sessionStorage.getItem("username")}</strong></p>
      <p>Puedes añadir datos extras sobre tu perfil aquí...</p>
    `;
  } else {
    profileContainer.innerHTML = `<p>No has iniciado sesión. <a href="#login">Iniciar Sesión</a></p>`;
  }
}

function logout() {
  console.log("Cerrando sesión...");
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("username");
  token = null;
  updateUserMenu();
  location.reload();
}

function initApp() {
  console.log("initApp() - Iniciando la aplicación, llamando a getState y getHistory periódicamente.");
  getState("A");
  getState("B");
  getHistory();
  startRealtimeUpdates();
}

function startRealtimeUpdates() {
  console.log("startRealtimeUpdates() - Iniciando intervalo cada 1s para getState y getHistory.");
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

async function login() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();

  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  console.log("Haciendo login con:", username);
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    console.log("Respuesta login:", data);
    if (data.success) {
      token = data.token;
      sessionStorage.setItem("token", token);
      sessionStorage.setItem("username", username);
      window.location.hash = "simulation-selection";
      updateUserMenu();
      updateMainViewButtons();
      updateProfileView();
      loadSimulations();
      initApp();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    console.error("Error en login:", error);
  }
}

async function registerUser() {
  const usernameReg = document.getElementById("username-reg")?.value.trim();
  const passwordReg = document.getElementById("password-reg")?.value.trim();

  if (!usernameReg || !passwordReg) {
    alert("Por favor, completa todos los campos.");
    return;
  }

  console.log("Registrando usuario:", usernameReg);
  try {
    const response = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameReg, password: passwordReg }),
    });
    const data = await response.json();
    console.log("Respuesta register:", data);
    if (data.success) {
      alert("Usuario registrado correctamente. Iniciando sesión automáticamente...");

      // Una vez registrado con éxito, hacemos login automático:
      await autoLogin(usernameReg, passwordReg);

    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    console.error("Error en registro:", error);
  }
}

async function autoLogin(username, password) {
  console.log("autoLogin con:", username);
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    console.log("Respuesta autoLogin:", data);
    if (data.success) {
      token = data.token;
      sessionStorage.setItem("token", token);
      sessionStorage.setItem("username", username);
      window.location.hash = "simulation-selection";
      updateUserMenu();
      updateMainViewButtons();
      updateProfileView();
      loadSimulations();
      initApp();
    } else {
      alert(`Error al iniciar sesión automáticamente: ${data.error}`);
    }
  } catch (error) {
    console.error("Error en autoLogin:", error);
  }
}


function loginWithGoogle() {
  alert("Google Sign-In pendiente de implementación.");
}

function registerWithGoogle() {
  alert("Google Sign-Up pendiente de implementación.");
}

function loadSimulations() {
  console.log("Cargando simulaciones...");
  fetchWithAuth("/simulations")
    .then(response => response.json())
    .then(data => {
      console.log("Simulaciones:", data);
      const simulationList = document.getElementById("simulation-list");
      if (simulationList) {
        simulationList.innerHTML = "";
        data.simulations.forEach(sim => {
          const listItem = document.createElement("li");
          listItem.textContent = `Simulación ${sim.id}`;
          listItem.setAttribute("tabindex","0");
          listItem.addEventListener("click", () => selectSimulation(sim.id));
          listItem.addEventListener("keypress", (e) => {
            if (e.key === "Enter") selectSimulation(sim.id);
          });
          simulationList.appendChild(listItem);
        });
      }
    })
    .catch(() => alert("Error al cargar simulaciones."));
}

function createNewSimulation() {
  console.log("Creando nueva simulación...");
  fetchWithAuth("/createSimulations", {
    method: "POST",
  })
    .then(response => response.json())
    .then(data => {
      console.log("Respuesta createSimulations:", data);
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
  console.log("Seleccionando simulación:", simulationId);
  fetchWithAuth("/enterSimulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulator_id: simulationId }),
  })
    .then(response => response.json())
    .then(data => {
      console.log("Respuesta enterSimulation:", data);
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        sessionStorage.setItem("currentSimulationId", simulationId);

        window.location.hash = "tcp-simulation";
        clearVisualization();
        clearStateHistories();
        initApp();

        const started = sessionStorage.getItem("sim_" + simulationId + "_started");
        if (started === "true") {
          showPostSimulation();
        } else {
          showPreSimulation(); // Aquí se mostrarán parámetros y se habilitarán
        }

      } else {
        alert(`Error: ${data.error}`);
      }
    })
    .catch(error => console.error("Error al entrar en simulación:", error));
}



function goBackToSelection() {
  console.log("Volviendo a la selección de simulaciones...");
  fetchWithAuth("/goBack")
    .then(response => response.json())
    .then(data => {
      console.log("Respuesta goBack:", data);
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        window.location.hash = "simulation-selection";
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
  console.log("Limpiando visualización...");
  const svg = d3.select("#simulation-visual");
  if (svg) svg.selectAll("*").remove();
  setupVisualSimulation();

  const windowChart = d3.select("#window-chart");
  if (windowChart) windowChart.selectAll("*").remove();
  windowDataA = [];
  windowDataB = [];
}

function clearStateHistories() {
  console.log("Limpiando historiales de estado...");
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
  const simulationId = sessionStorage.getItem("currentSimulationId");
  const dataSizeA = document.getElementById("data-size-input-A")?.value || 0;
  const dataSizeB = document.getElementById("data-size-input-B")?.value || 0;
  const windowSize = document.getElementById("window-size-input")?.value || 1024;
  const mss = document.getElementById("mss-input")?.value || 1460;
  const lossRatio = document.getElementById("loss-ratio-input")?.value || 0;

  console.log(`Iniciando simulación con: A=${dataSizeA} B=${dataSizeB} W=${windowSize} MSS=${mss} loss=${lossRatio}`);
  clearVisualization();
  clearStateHistories();

  fetchWithAuth("/start-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataSizeA, dataSizeB, windowSize, mss, lossRatio }),
  })
    .then(response => response.json())
    .then(data => {
      console.log("Respuesta start-simulation:", data);
      if (!data.success) {
        alert("Error: " + data.error);
      } else {
        // Marcar esta simulación como iniciada
        if (simulationId) {
          sessionStorage.setItem("sim_" + simulationId + "_started", "true");
        }

        // Deshabilitar inputs y botón iniciar
        const startBtn = document.getElementById("start-simulation-btn");
        if (startBtn) startBtn.disabled = true;

        const inputs = [
          "window-size-input",
          "data-size-input-A",
          "data-size-input-B",
          "mss-input",
          "loss-ratio-input"
        ];
        inputs.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = true;
        });

        // Cambiamos a vista post-simulación
        showPostSimulation();

        setTimeout(() => {
          console.log("Reforzando actualización de historial tras iniciar simulación...");
          getHistory();
        }, 2000);
      }
    })
    .catch(error => console.error("Error al iniciar simulación:", error));
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
  console.log("Llamando a getHistory()...");
  fetchWithAuth(`/history`)
    .then(response => response.json())
    .then(data => {
      console.log("Respuesta /history:", data);
      if (!data.success) return;

      messageData = data.history;

      if (messageData.length > 0) {
        messageData.forEach(m => {
          const isoDate = m.timestamp.replace(' ', 'T');
          m.startTime = new Date(isoDate);
          if (isNaN(m.startTime.getTime())) {
            console.warn("Fecha inválida, usando fecha actual:", m.timestamp, isoDate);
            m.startTime = new Date();
          }

          const param = JSON.parse(m.parameter_TCP);
          let latency = param.latency || 0;
          m.arrivalTime = new Date(m.startTime.getTime() + latency);
        });

        console.log("Fechas parseadas:", messageData.map(m => m.startTime));

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
          listItem.textContent = `Seq:${param.seqNum}, Ack:${param.ackNum}, Flags:[${activeFlags.join(", ")}], Len:${msg.len}`;

          if (msg.node_id === "A" && historyA) {
            historyA.appendChild(listItem);
          } else if (msg.node_id === "B" && historyB) {
            historyB.appendChild(listItem);
          }
        });

      } else {
        console.log("No hay mensajes en el historial.");
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
  console.log("createTimeScale() - Calculando escala temporal...");
  let times = [];
  messages.forEach(m => {
    times.push(m.startTime);
    times.push(m.arrivalTime);
  });

  earliestTime = new Date(Math.min(...times.map(t => t.getTime())));
  latestTime = new Date(Math.max(...times.map(t => t.getTime())));

  if (earliestTime.getTime() === latestTime.getTime()) {
    latestTime = new Date(earliestTime.getTime() + 1000);
    console.log("earliestTime y latestTime iguales, ajustando rango.");
  }

  let zoomVal = document.getElementById("time-zoom-input")?.value || 200;
  timeScale = d3.scaleTime()
    .domain([earliestTime, latestTime])
    .range([50, parseInt(zoomVal)]);
}

function shouldDisplayMessage(entry, param) {
  const syn = document.getElementById("filter-syn")?.checked;
  const ack = document.getElementById("filter-ack")?.checked;
  const fin = document.getElementById("filter-fin")?.checked;
  const data = document.getElementById("filter-data")?.checked;

  const flags = param.flags;
  const isData = (entry.len > 0 && !flags.SYN && !flags.FIN && !flags.ACK);
  
  // Filtra SYN
  if (flags.SYN && !syn) return false;

  // Filtra FIN
  if (flags.FIN && !fin) return false;

  // Filtra ACK puro (ACK sin SYN, sin FIN y sin datos)
  if (flags.ACK && !flags.SYN && !flags.FIN && entry.len === 0 && !ack) return false;

  // Filtra Data
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
    // Antes se llamaba shouldDisplayMessage(param), ahora pasamos entry, param
    if (shouldDisplayMessage(entry, param)) {
      drawMessageArrowRealTime(entry);
    }
  });

  updateSVGHeight();
}


function drawMessageArrowRealTime(entry) {
  const svg = d3.select("#simulation-visual");
  const arrowGroup = svg.append("g").attr("id", `message-${entry.id}`);

  let param = JSON.parse(entry.parameter_TCP);
  const activeFlags = Object.entries(param.flags).filter(([_, v]) => v).map(([k]) => k);

  const isA = entry.node_id === "A";
  const xA = 200;
  const xB = 600;

  const yStart = timeScale(entry.startTime) + (entry.jitterOffset || 0);
  const yEnd = timeScale(entry.arrivalTime);

  const xStart = isA ? xA : xB;
  const xEnd = isA ? xB : xA;

  let lineColor = "red";

  // Ajustar condición para ACK puro (sin SYN/FIN, len = 0)
  if (param.flags.SYN && param.flags.ACK) {
    lineColor = "green";
  } else if (param.flags.SYN) {
    lineColor = "green";
  } else if (param.flags.FIN) {
    lineColor = "orange";
  } else if (param.flags.ACK && !param.flags.SYN && !param.flags.FIN && entry.len === 0) {
    lineColor = "blue";
  } else if (entry.len > 0) {
    lineColor = "red";
  }

  // Actualizar texto, usando entry.len en vez de param.len y sin latencia
  let messageText = `Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: [${activeFlags.join(", ")}], Len: ${entry.len}`;

  const line = arrowGroup.append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", lineColor)
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

  line.on("mouseover", (event) => {
    tooltip.style("opacity", 1)
      .attr("data-visible", "true")
      .html(messageText)
      .style("left", (event.pageX + 5) + "px")
      .style("top", (event.pageY + 5) + "px");
  }).on("mouseout", () => {
    tooltip.style("opacity", 0)
      .attr("data-visible", "false");
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
    Math.max(parseFloat(line.getAttribute("y1")), parseFloat(line.getAttribute("y2")))) || 400;

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

  const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat("%H:%M:%S"));
  const yAxis = d3.axisLeft(yScale).ticks(5);

  windowChart.append("g")
    .attr("transform", "translate(0,150)")
    .call(xAxis);

  windowChart.append("g")
    .attr("transform", "translate(50,0)")
    .call(yAxis);
}

function fetchWithAuth(url, options = {}) {
  options.headers = { ...options.headers, Authorization: token };
  console.log("fetchWithAuth:", url, options);
  return fetch(url, options).then(response => {
    if (response.status === 401) {
      alert("Sesión expirada. Inicia sesión nuevamente.");
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("username");
      stopRealtimeUpdates();
      location.reload();
    }
    return response;
  });
}

function setupHamburgerMenu() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('show');
    });
  }
}

function showPreSimulation() {
  const preSim = document.getElementById("pre-simulation");
  const postSim = document.getElementById("post-simulation");
  if (preSim) preSim.style.display = "block";
  if (postSim) postSim.style.display = "none";

  const simulationId = sessionStorage.getItem("currentSimulationId");
  const started = sessionStorage.getItem("sim_" + simulationId + "_started");

  // Si no está iniciada, habilitar campos y botón
  if (started !== "true") {
    const inputs = [
      "window-size-input",
      "data-size-input-A",
      "data-size-input-B",
      "mss-input",
      "loss-ratio-input"
    ];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = false; // Rehabilita campos
      }
    });

    const startBtn = document.getElementById("start-simulation-btn");
    if (startBtn) startBtn.disabled = false;
  }
}

function showPostSimulation() {
  const preSim = document.getElementById("pre-simulation");
  const postSim = document.getElementById("post-simulation");
  if (preSim) preSim.style.display = "none";
  if (postSim) postSim.style.display = "block";
}

