// app.js

/********************************/
/*      VARIABLES GLOBALES      */
/********************************/

let token = sessionStorage.getItem("token");
let updateInterval = null;

// Almacenamos mensajes (para visualización con D3)
let messageData = [];
let earliestTime = null;
let latestTime = null;
let timeScale = null;

// Parámetros para “jitter” y threshold de tiempo
let messageVerticalJitter = 5;
let timeThresholdForJitter = 200;

// Datos para la gráfica de la ventana
let windowDataA = [];
let windowDataB = [];

// Tooltip D3
let tooltip = null;

/********************************/
/* LOADER Y TOASTS              */
/********************************/

function showLoader() {
  const loader = document.getElementById("loader");
  if (loader) loader.style.display = "flex";
}
function hideLoader() {
  const loader = document.getElementById("loader");
  if (loader) loader.style.display = "none";
}

function showToast(message, type="success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/********************************/
/* MANEJO CENTRALIZADO ERRORES  */
/********************************/

function handleError(error) {
  console.error(error);
  hideLoader();
  showToast(error?.message || "Ha ocurrido un error", "error");
}

/********************************/
/*    ROUTER DE VISTAS (HASH)   */
/********************************/

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
  const tokenFromUrl = urlParams.get('token');
  const usernameFromUrl = urlParams.get('username');
  if (tokenFromUrl && usernameFromUrl) {
    sessionStorage.setItem("token", tokenFromUrl);
    sessionStorage.setItem("username", usernameFromUrl);
    // Si venía token en la URL, forzamos hash a #main
    window.location.hash = "#main";
  }

  tooltip = d3.select("#tooltip");

  initRouter();
  setupVisualSimulation();    // Dibuja el SVG base
  updateUserMenu();
  updateMainViewButtons();
  updateProfileView();
  setupHamburgerMenu();

  // Escucha de checkboxes de filtros
  document.getElementById("filter-syn")?.addEventListener("change", renderAll);
  document.getElementById("filter-ack")?.addEventListener("change", renderAll);
  document.getElementById("filter-fin")?.addEventListener("change", renderAll);
  document.getElementById("filter-data")?.addEventListener("change", renderAll);

  // Escucha de slider zoom
  const zoomInput = document.getElementById("time-zoom-input");
  if (zoomInput) {
    zoomInput.addEventListener("input", () => {
      document.getElementById("time-zoom-value").textContent = zoomInput.value;
      renderAll(); // Redibuja con el nuevo zoom
    });
  }

  // Escucha de slider ratio de pérdida
  const lossRatioInput = document.getElementById("loss-ratio-input");
  if (lossRatioInput) {
    lossRatioInput.addEventListener("input", () => {
      document.getElementById("loss-ratio-value").textContent = lossRatioInput.value;
    });
  }

  // Botones
  document.getElementById("register-btn")?.addEventListener("click", registerUser);
  document.getElementById("login-btn")?.addEventListener("click", login);
  document.getElementById("google-login-btn")?.addEventListener("click", loginWithGoogle);
  document.getElementById("google-register-btn")?.addEventListener("click", registerWithGoogle);

  const createSimBtn = document.getElementById("create-simulation-btn");
  if (createSimBtn) {
    createSimBtn.addEventListener("click", () => {
      // (Opcional) Si había una simulación previa, la limpiamos:
      if (sessionStorage.getItem("currentSimulationId")) {
        goBackToSelection(() => {
          createNewSimulation();
        });
      } else {
        createNewSimulation();
      }
    });
  }

  document.getElementById("select-wireshark-file-btn")?.addEventListener("click", () => {
    document.getElementById("wireshark-file-input")?.click();
  });
  document.getElementById("wireshark-file-input")?.addEventListener("change", handleFileInputChange);

  document.getElementById("start-simulation-btn")?.addEventListener("click", startSimulation);
  document.getElementById("go-back-btn")?.addEventListener("click", goBackToSelection);
  document.getElementById("go-back-selection-btn")?.addEventListener("click", goBackToSelection);

  // Si hay token en sessionStorage, inicializar la app,
  // pero sin forzar "simulation-selection".
  token = sessionStorage.getItem("token");
  if (token) {
    // Revisar si hay una simulación previa (para re-entrar):
    const prevSimId = sessionStorage.getItem("currentSimulationId");
    if (prevSimId) {
      reEnterSimulation(prevSimId);
    } else {
      // Sin simulación previa => normal
      initApp();
      loadSimulations();
      toggleDisplay("login", false);
      toggleDisplay("register", false);
    }
  }
});

/** 
 * reEnterSimulation(simId): Llamada al recargar la página si existía
 * un currentSimulationId, para "re-entrar" en la simulación y no
 * forzar la vista "simulation-selection".
 */
async function reEnterSimulation(simulationId) {
  showLoader();
  try {
    const resp = await fetchWithAuth("/enterSimulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulator_id: simulationId })
    });
    const data = await resp.json();
    hideLoader();
    if (data.success) {
      // Actualizamos token y sim ID
      token = data.token;
      sessionStorage.setItem("token", token);
      sessionStorage.setItem("currentSimulationId", simulationId);

      // Iniciar la app, checar historial
      clearVisualization();
      clearStateHistories();
      initApp();

      // Checar si hay historial
      const historyResp = await fetchWithAuth("/history");
      const historyData = await historyResp.json();
      window.location.hash = "tcp-simulation";

      if (historyData.success && historyData.history.length > 0) {
        showPostSimulation();
        sessionStorage.setItem(`sim_${simulationId}_started`, "true");
      } else {
        showPreSimulation(); // re-habilita inputs
      }
    } else {
      console.warn("No se pudo re-entrar la simulación previa. Error:", data.error?.message);
      // Ir a la selección
      goBackToSelection();
    }
  } catch (error) {
    hideLoader();
    handleError(error);
    goBackToSelection();
  }
}

function initRouter() {
  window.addEventListener('hashchange', showViewFromHash);
  showViewFromHash();
}

function showViewFromHash() {
  let hash = window.location.hash.replace('#', '') || 'main';
  const views = document.querySelectorAll('.view');
  views.forEach(view => view.classList.remove('active'));

  const targetView = document.getElementById(hash);
  if (targetView) {
    targetView.classList.add('active');
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

/********************************/
/* showPreSimulation / postSim  */
/********************************/
function showPreSimulation() {
  const preSim = document.getElementById("pre-simulation");
  const postSim = document.getElementById("post-simulation");
  if (preSim) preSim.style.display = "block";
  if (postSim) postSim.style.display = "none";

  // Re-habilitar inputs y botón start
  const inputs = [
    "window-size-input",
    "data-size-input-A",
    "data-size-input-B",
    "mss-input",
    "loss-ratio-input",
  ];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  const startBtn = document.getElementById("start-simulation-btn");
  if (startBtn) startBtn.disabled = false;
}

function showPostSimulation() {
  const preSim = document.getElementById("pre-simulation");
  const postSim = document.getElementById("post-simulation");
  if (preSim) preSim.style.display = "none";
  if (postSim) postSim.style.display = "block";
}

/********************************/
/*   MENÚ USUARIO & BOTONES     */
/********************************/
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
    btn.addEventListener("click", () => {
      window.location.hash = "simulation-selection";
    });
    mainActionButtons.appendChild(btn);
  } else {
    welcomeMessage.innerHTML = `<h2>Bienvenido a la Simulación TCP</h2><p>Por favor, inicia sesión o regístrate para comenzar.</p>`;

    const btnLogin = document.createElement("button");
    btnLogin.textContent = "Iniciar Sesión";
    btnLogin.addEventListener("click", () => {
      window.location.hash = "login";
    });
    mainActionButtons.appendChild(btnLogin);

    const btnRegister = document.createElement("button");
    btnRegister.textContent = "Registrarse";
    btnRegister.addEventListener("click", () => {
      window.location.hash = "register";
    });
    mainActionButtons.appendChild(btnRegister);
  }
}

function updateProfileView() {
  const profileContainer = document.getElementById("profile-container");
  if (!profileContainer) return;
  if (token && sessionStorage.getItem("username")) {
    profileContainer.innerHTML = `
      <p>Estás conectado como: <strong>${sessionStorage.getItem("username")}</strong></p>
      <p>Información de tu perfil académico...</p>
    `;
  } else {
    profileContainer.innerHTML = `<p>No has iniciado sesión. <a href="#login">Iniciar Sesión</a></p>`;
  }
}

/********************************/
/*        AUTENTICACIÓN         */
/********************************/
function logout() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("username");
  sessionStorage.removeItem("currentSimulationId");
  token = null;
  updateUserMenu();
  location.reload();
}

async function login() {
  const username = document.getElementById("username")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  if (!username || !password) {
    alert("Por favor, completa todos los campos.");
    return;
  }
  showLoader();
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    hideLoader();
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
      showToast("Inicio de sesión exitoso!");
    } else {
      handleError({ message: data.error?.message || "Error de login" });
    }
  } catch (error) {
    handleError(error);
  }
}

async function registerUser() {
  const usernameReg = document.getElementById("username-reg")?.value.trim();
  const passwordReg = document.getElementById("password-reg")?.value.trim();
  if (!usernameReg || !passwordReg) {
    alert("Por favor, completa todos los campos.");
    return;
  }
  showLoader();
  try {
    const response = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameReg, password: passwordReg }),
    });
    const data = await response.json();
    hideLoader();
    if (data.success) {
      alert("Usuario registrado correctamente. Iniciando sesión automáticamente...");
      await autoLogin(usernameReg, passwordReg);
    } else {
      handleError({ message: data.error?.message || "Error de registro" });
    }
  } catch (error) {
    handleError(error);
  }
}

async function autoLogin(username, password) {
  showLoader();
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    hideLoader();
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
      showToast("Registro e inicio de sesión exitoso!");
    } else {
      handleError({ message: data.error?.message || "Error al iniciar sesión" });
    }
  } catch (error) {
    handleError(error);
  }
}

function loginWithGoogle() {
  window.location.href = "/auth/google";
}
function registerWithGoogle() {
  window.location.href = "/auth/google";
}

/********************************/
/*      SIMULACIONES (API)      */
/********************************/
function loadSimulations() {
  showLoader();
  fetchWithAuth("/simulations")
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (data.success) {
        const simulationList = document.getElementById("simulation-list");
        if (simulationList) {
          simulationList.innerHTML = "";
          data.simulations.forEach(sim => {
            const li = document.createElement("li");
            li.textContent = `Simulación ${sim.id}`;
            li.setAttribute("tabindex","0");
            li.addEventListener("click", () => selectSimulation(sim.id));
            li.addEventListener("keypress", (e) => {
              if (e.key === "Enter") selectSimulation(sim.id);
            });
            simulationList.appendChild(li);
          });
        }
      } else {
        handleError({ message: data.error?.message || "Error al cargar simulaciones" });
      }
    })
    .catch(handleError);
}

function createNewSimulation() {
  showLoader();
  fetchWithAuth("/createSimulations", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (data.success) {
        showToast("Nueva simulación creada.");
        loadSimulations();
      } else {
        handleError({ message: data.error?.message || "Error al crear simulación" });
      }
    })
    .catch(handleError);
}

function selectSimulation(simulationId) {
  showLoader();
  fetchWithAuth("/enterSimulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulator_id: simulationId }),
  })
    .then(r => r.json())
    .then(async data => {
      hideLoader();
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        sessionStorage.setItem("currentSimulationId", simulationId);

        clearVisualization();
        clearStateHistories();
        initApp();

        // Checar historial
        const historyResp = await fetchWithAuth("/history");
        const historyData = await historyResp.json();

        window.location.hash = "tcp-simulation";

        if (historyData.success && historyData.history.length > 0) {
          showPostSimulation();
          sessionStorage.setItem(`sim_${simulationId}_started`, "true");
        } else {
          // Habilitar la vista pre-simulation
          showPreSimulation();
        }
      } else {
        handleError({ message: data.error?.message || "Error al entrar en simulación" });
      }
    })
    .catch(handleError);
}

function goBackToSelection(callback) {
  showLoader();
  fetchWithAuth("/goBack")
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (data.success) {
        token = data.token;
        sessionStorage.setItem("token", token);
        sessionStorage.removeItem("currentSimulationId");

        window.location.hash = "simulation-selection";
        loadSimulations();
        stopRealtimeUpdates();
        clearStateHistories();
        clearVisualization();

        if (callback && typeof callback === "function") {
          callback();
        }
      } else {
        handleError({ message: data.error?.message || "Error al volver a selección" });
      }
    })
    .catch(error => {
      handleError(error);
      if (callback && typeof callback === "function") {
        callback();
      }
    });
}

/********************************/
/*    INICIAR LA SIMULACIÓN     */
/********************************/
function startSimulation() {
  const simulationId = sessionStorage.getItem("currentSimulationId");
  const dataSizeA = document.getElementById("data-size-input-A")?.value || "0";
  const dataSizeB = document.getElementById("data-size-input-B")?.value || "0";
  const windowSize = document.getElementById("window-size-input")?.value || "1024";
  const mss = document.getElementById("mss-input")?.value || "1460";
  const lossRatio = document.getElementById("loss-ratio-input")?.value || "0";

  if (Number(dataSizeA) < 0 || Number(dataSizeB) < 0) {
    alert("Tamaño de datos debe ser >= 0");
    return;
  }
  if (Number(windowSize) < 1) {
    alert("windowSize debe ser >= 1");
    return;
  }
  if (Number(mss) < 1) {
    alert("mss debe ser >= 1");
    return;
  }
  const lr = parseFloat(lossRatio);
  if (lr < 0 || lr > 1) {
    alert("lossRatio debe estar entre 0 y 1");
    return;
  }

  clearVisualization();
  clearStateHistories();
  showLoader();

  fetchWithAuth("/start-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataSizeA, dataSizeB, windowSize, mss, lossRatio }),
  })
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (!data.success) {
        handleError({ message: data.error?.message || "Error al iniciar simulación" });
      } else {
        sessionStorage.setItem(`sim_${simulationId}_started`, "true");

        // Deshabilitar inputs
        document.getElementById("start-simulation-btn")?.setAttribute("disabled","disabled");
        ["window-size-input","data-size-input-A","data-size-input-B","mss-input","loss-ratio-input"]
          .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = true;
          });

        showPostSimulation();
        showToast("Simulación iniciada.");
        setTimeout(() => {
          getHistory();
        }, 2000);
      }
    })
    .catch(handleError);
}

/********************************/
/*    INIT APP (REALTIME)       */
/********************************/
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

/********************************/
/*   ESTADOS Y PARÁMETROS       */
/********************************/
function getState(nodeId) {
  fetchWithAuth(`/state/${nodeId}`)
    .then(r => r.json())
    .then(data => {
      const currentStateElem = document.getElementById(`current-state-${nodeId}`);
      if (currentStateElem && data.state) {
        currentStateElem.textContent = data.state;
      }
      updateTCPParams(nodeId);
    })
    .catch(handleError);
}

function updateTCPParams(nodeId) {
  fetchWithAuth(`/param/${nodeId}`)
    .then(r => r.json())
    .then(data => {
      const paramsElem = document.getElementById(`tcp-params-${nodeId}`);
      if (paramsElem && data) {
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
          windowDataA.push({ time: now, windowSize: data.windowSize });
        } else {
          windowDataB.push({ time: now, windowSize: data.windowSize });
        }
        drawWindowChart();
      }
    })
    .catch(handleError);
}

/********************************/
/*         HISTORIAL TCP        */
/********************************/
function getHistory() {
  fetchWithAuth(`/history`)
    .then(r => r.json())
    .then(data => {
      if (!data.success) return;
      messageData = data.history || [];
      if (messageData.length > 0) {
        // parsear parameter_TCP
        messageData.forEach(m => {
          const isoDate = m.timestamp.replace(' ', 'T');
          m.startTime = new Date(isoDate);
          if (isNaN(m.startTime.getTime())) {
            m.startTime = new Date();
          }
          let param;
          try {
            param = JSON.parse(m.parameter_TCP);
          } catch (err) {
            return;
          }
          if (!param) return;
          const latency = param.latency || 0;
          m.arrivalTime = new Date(m.startTime.getTime() + latency);
          m.param = param; // guardar param parseado
        });
        renderAll(); // Llamamos a la función que dibuja las flechas

        const historyA = document.getElementById("state-history-A");
        const historyB = document.getElementById("state-history-B");
        if (historyA) historyA.innerHTML = "";
        if (historyB) historyB.innerHTML = "";

        messageData.forEach(msg => {
          if (!msg.param || !msg.param.flags) return;
          const flags = msg.param.flags;
          const activeFlags = Object.entries(flags).filter(([_, v]) => v).map(([k]) => k);
          const li = document.createElement("li");
          li.textContent = `Seq:${msg.param.seqNum}, Ack:${msg.param.ackNum}, Flags:[${activeFlags.join(", ")}], Len:${msg.len}`;
          if (msg.node_id === "A") {
            historyA?.appendChild(li);
          } else {
            historyB?.appendChild(li);
          }
        });
      } else {
        d3.select("#simulation-visual").selectAll("*").remove();
        setupVisualSimulation();
        document.getElementById("state-history-A")?.replaceChildren();
        document.getElementById("state-history-B")?.replaceChildren();
      }
    })
    .catch(handleError);
}

/********************************/
/*  VISUALIZACIÓN D3 SIMULACIÓN */
/********************************/

/** 
 * Esta función ya dibuja el SVG base (flecha, líneas A/B...). 
 */
function setupVisualSimulation() {
  const svg = d3.select("#simulation-visual");
  svg.html("");

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

  svg.attr("height", 400);

  // Líneas verticales A, B
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

  // Eje tiempo vertical
  svg.append("line")
    .attr("id", "time-axis")
    .attr("x1", 50)
    .attr("y1", 50)
    .attr("x2", 50)
    .attr("y2", 350)
    .attr("stroke", "gray")
    .attr("stroke-width", 1);
}

/** 
 * createTimeScale: Configura la escala temporal según earliestTime y latestTime 
 */
function createTimeScale(data) {
  if (!data || data.length === 0) {
    timeScale = null;
    return;
  }
  const times = [];
  data.forEach(d => {
    times.push(d.startTime, d.arrivalTime);
  });
  earliestTime = new Date(Math.min(...times.map(t => t.getTime())));
  latestTime = new Date(Math.max(...times.map(t => t.getTime())));

  if (earliestTime.getTime() === latestTime.getTime()) {
    latestTime = new Date(earliestTime.getTime() + 1000);
  }

  const zoomVal = document.getElementById("time-zoom-input")?.value || 200;
  timeScale = d3.scaleTime()
    .domain([earliestTime, latestTime])
    .range([50, parseInt(zoomVal)]);
}

/**
 * renderAll: Filtra y llama a renderMessages con los datos filtrados
 */
function renderAll() {
  if (!messageData || messageData.length === 0) return;

  const synChecked = document.getElementById("filter-syn")?.checked;
  const ackChecked = document.getElementById("filter-ack")?.checked;
  const finChecked = document.getElementById("filter-fin")?.checked;
  const dataChecked = document.getElementById("filter-data")?.checked;

  const filtered = messageData.filter(m => {
    if (!m.param || !m.param.flags) {
      return false; // Evitar TypeError
    }
    const flags = m.param.flags;
    const isPureAck = (flags.ACK && !flags.SYN && !flags.FIN && m.len === 0);
    const isData = (m.len > 0 && !flags.SYN && !flags.FIN && !isPureAck);

    if (flags.SYN && !synChecked) return false;
    if (isPureAck && !ackChecked) return false;
    if (flags.FIN && !finChecked) return false;
    if (isData && !dataChecked) return false;
    return true;
  });

  createTimeScale(filtered);
  renderMessages(filtered);
}

/** 
 * renderMessages: dibuja las flechas.
 * Eliminamos las flechas anteriores antes de redibujar (para evitar duplicaciones).
 */
function renderMessages(data) {
  const svg = d3.select("#simulation-visual");

  // [CLAVE] Borrar flechas anteriores antes de dibujar nuevas
  svg.selectAll("g[id^='message-']").remove();

  if (!data || data.length === 0 || !timeScale) return;

  // Ordenar por startTime
  data.sort((a, b) => a.startTime - b.startTime);

  // Asignar un pequeño offset (jitter) a mensajes muy cercanos
  for (let i = 0; i < data.length; i++) {
    let offsetCount = 0;
    for (let j = 0; j < i; j++) {
      const diff = data[i].startTime - data[j].startTime;
      if (Math.abs(diff) < timeThresholdForJitter) {
        offsetCount++;
      }
    }
    data[i].jitterOffset = offsetCount * messageVerticalJitter;
  }

  // Dibujar cada mensaje
  data.forEach(entry => {
    drawMessageArrow(entry);
  });

  updateSVGHeight();
}

/** 
 * drawMessageArrow: dibuja la flecha, su color y texto
 */
function drawMessageArrow(entry) {
  const svg = d3.select("#simulation-visual");
  const group = svg.append("g")
    .attr("id", `message-${entry.id}`);

  const param = entry.param;
  const flags = param.flags;
  const isA = (entry.node_id === "A");
  const xA = 200;
  const xB = 600;

  const yStart = timeScale(entry.startTime) + (entry.jitterOffset || 0);
  const yEnd = timeScale(entry.arrivalTime);

  const xStart = isA ? xA : xB;
  const xEnd = isA ? xB : xA;

  let lineColor = "red";
  const isSyn = flags.SYN;
  const isAck = (!flags.SYN && flags.ACK && !flags.FIN && entry.len === 0);
  const isFin = flags.FIN && !flags.SYN;
  const isData = (entry.len > 0 && !flags.SYN && !flags.FIN && !isAck);

  if (isSyn && flags.ACK) lineColor = "green";
  else if (isSyn) lineColor = "green";
  else if (isFin) lineColor = "orange";
  else if (isAck) lineColor = "blue";
  else if (isData) lineColor = "red";

  const messageText = `Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: [${Object.keys(flags).filter(f => flags[f]).join(", ")}], Len: ${entry.len}`;

  const line = group.append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", lineColor)
    .attr("stroke-width", 2)
    .attr("marker-end", "url(#arrowhead)");

  // Tooltip
  line.on("mouseover", (event) => {
    tooltip.style("opacity", 1)
      .attr("data-visible", "true")
      .html(messageText)
      .style("left", (event.pageX + 5) + "px")
      .style("top", (event.pageY + 5) + "px");
  }).on("mouseout", () => {
    tooltip.style("opacity", 0).attr("data-visible", "false");
  });

  // Texto en la mitad
  const tempText = group.append("text")
    .attr("font-size", "12px")
    .text(messageText)
    .attr("visibility", "hidden");

  const bbox = tempText.node().getBBox();
  tempText.remove();

  const textX = (xStart + xEnd) / 2;
  const textY = (yStart + yEnd) / 2 - 15;
  const padding = 4;

  group.append("rect")
    .attr("x", textX - bbox.width / 2 - padding)
    .attr("y", textY - bbox.height - padding / 2)
    .attr("width", bbox.width + padding * 2)
    .attr("height", bbox.height + padding)
    .attr("fill", "white")
    .attr("fill-opacity", 0.7)
    .attr("rx", 3)
    .attr("ry", 3);

  group.append("text")
    .attr("x", textX)
    .attr("y", textY - bbox.height / 4)
    .attr("font-size", "12px")
    .attr("fill", "black")
    .attr("text-anchor", "middle")
    .text(messageText);
}

function updateSVGHeight() {
  const svgElement = document.getElementById("simulation-visual");
  if (!svgElement) return;

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
}

/********************************/
/*  GRÁFICA DE VENTANA (D3)     */
/********************************/
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
  const maxW = Math.max(
    d3.max(windowDataA, d => d.windowSize) || 0,
    d3.max(windowDataB, d => d.windowSize) || 0
  );

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

  // Eje base
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

/********************************/
/* LIMPIAR VISUAL E HISTORIAL   */
/********************************/
function clearVisualization() {
  // Borra el SVG actual y re-crea la base
  d3.select("#simulation-visual").selectAll("*").remove();
  setupVisualSimulation();

  // Borra la gráfica de ventana
  d3.select("#window-chart").selectAll("*").remove();
  windowDataA = [];
  windowDataB = [];
}

function clearStateHistories() {
  document.getElementById("state-history-A")?.replaceChildren();
  document.getElementById("state-history-B")?.replaceChildren();
}

/********************************/
/*  FETCH CON TOKEN (AUTH)      */
/********************************/
function fetchWithAuth(url, options = {}) {
  if (!options.headers) options.headers = {};
  options.headers.Authorization = token;
  return fetch(url, options).then(async response => {
    if (!response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch (err) {
        // data remains null
      }
      if (data && data.error) {
        throw new Error(data.error.message);
      } else {
        throw new Error(`Error HTTP ${response.status}`);
      }
    }
    return response;
  });
}

/********************************/
/* DRAG & DROP WIRESHARK FILE   */
/********************************/
function handleFileDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file) return;
  uploadWiresharkFile(file);
}
function handleFileInputChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  uploadWiresharkFile(file);
}

async function uploadWiresharkFile(file) {
  if (!token) {
    alert("Debes iniciar sesión antes de subir archivos.");
    return;
  }
  const formData = new FormData();
  formData.append("wiresharkFile", file);

  showLoader();
  try {
    const resp = await fetchWithAuth("/uploadWireshark", {
      method: "POST",
      body: formData
    });
    const data = await resp.json();
    hideLoader();
    if (data.success) {
      showToast("Archivo subido y procesado correctamente.");
      loadSimulations();
    } else {
      handleError({ message: data.error?.message || "Error al subir archivo Wireshark" });
    }
  } catch (error) {
    handleError(error);
  }
}

/********************************/
/* MENÚ RESPONSIVE (HAMB)       */
/********************************/
function setupHamburgerMenu() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('show');
    });
  }
}
