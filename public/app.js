/********************************/
/*      VARIABLES GLOBALES      */
/********************************/

let token = sessionStorage.getItem("token");
let updateInterval = null;

// Mensajes (historial D3)
let messageData = [];
let earliestTime = null;
let latestTime = null;
let timeScale = null;

// Config visual
let messageVerticalJitter = 5;
let timeThresholdForJitter = 200;

// Tooltip D3
let tooltip = null;

// Contador global de flechas
let arrowIdCounter = 1;

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
/* ROUTER DE VISTAS (HASH)      */
/********************************/
document.addEventListener("DOMContentLoaded", () => {
  const savedHash = sessionStorage.getItem("lastHash");
  if (token && savedHash) {
    window.location.hash = savedHash;
  }

  const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
  const tokenFromUrl = urlParams.get('token');
  const usernameFromUrl = urlParams.get('username');
  if (tokenFromUrl && usernameFromUrl) {
    sessionStorage.setItem("token", tokenFromUrl);
    sessionStorage.setItem("username", usernameFromUrl);
    window.location.hash = "#main";
  }

  tooltip = d3.select("#tooltip");
  
  if(window.location.hash == "#logout") {logout();}
  initRouter();
  setupVisualSimulation();
  updateUserMenu();
  updateMainViewButtons();
  updateProfileView();
  setupHamburgerMenu();

  if(sessionStorage.getItem("currentSimulationId")){
    selectSimulation(sessionStorage.getItem("currentSimulationId"))
  }

  // Filtros
  document.getElementById("filter-syn")?.addEventListener("change", renderAll);
  document.getElementById("filter-ack")?.addEventListener("change", renderAll);
  document.getElementById("filter-fin")?.addEventListener("change", renderAll);
  document.getElementById("filter-rst")?.addEventListener("change", renderAll);
  document.getElementById("filter-data")?.addEventListener("change", renderAll);

  // Zoom
  const zoomInput = document.getElementById("time-zoom-value");
  const decrease = document.getElementById("decrease-zoom");
  const increase = document.getElementById("increase-zoom");
  if (zoomInput && decrease && increase) {
    decrease.addEventListener("click", () => {
      if(zoomInput.textContent > 0){
        document.getElementById("time-zoom-value").textContent = parseInt(zoomInput.textContent) - (50 * parseInt(zoomInput.textContent)/1000);
        renderAll();
      }
    });

    increase.addEventListener("click", () => {
      document.getElementById("time-zoom-value").textContent = parseInt(zoomInput.textContent) + (50 * parseInt(zoomInput.textContent)/1000);
      renderAll();
    });
  }

  // ratio de pérdida
  const lossRatioInput = document.getElementById("loss-ratio-input");
  if (lossRatioInput) {
    lossRatioInput.addEventListener("input", () => {
      document.getElementById("loss-ratio-value").textContent = lossRatioInput.value;
    });
  }

  // Checkboxes de secuencia manual
  const autoSeqA = document.getElementById("auto-seq-a");
  const seqNumAInput = document.getElementById("seq-num-a");
  if (autoSeqA && seqNumAInput) {
    autoSeqA.addEventListener("change", () => {
      seqNumAInput.disabled = autoSeqA.checked;
    });
  }
  const autoSeqB = document.getElementById("auto-seq-b");
  const seqNumBInput = document.getElementById("seq-num-b");
  if (autoSeqB && seqNumBInput) {
    autoSeqB.addEventListener("change", () => {
      seqNumBInput.disabled = autoSeqB.checked;
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

  token = sessionStorage.getItem("token");
  if (token) {
    loadSimulations();
    initApp();
    toggleDisplay("login", false);
    toggleDisplay("register", false);
  }
});

function initRouter() {
  window.addEventListener("hashchange", () => {
    sessionStorage.setItem("lastHash", window.location.hash);
    showViewFromHash();
    window.location.reload();
  });
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
/* showPreSimulation/postSim    */
/********************************/
function showPreSimulation() {
  const preSim = document.getElementById("pre-simulation");
  const postSim = document.getElementById("post-simulation");
  if (preSim) preSim.style.display = "block";
  if (postSim) postSim.style.display = "none";

  const inputs = [
    "window-size-input",
    "data-size-input-A",
    "data-size-input-B",
    "mss-input",
    "loss-ratio-input",
    "auto-seq-a",
    "auto-seq-b",
    "seq-num-a",
    "seq-num-b"
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
  initApp()
}

/********************************/
/* MENÚ USUARIO & BOTONES       */
/********************************/
function updateUserMenu() {
  const userIcon = document.getElementById("user-icon");
  const userDropdown = document.getElementById("user-dropdown");
  if (userIcon && userDropdown) {
    if (token) {
      userIcon.textContent = "👤";
      userDropdown.innerHTML = `
        <a href="#profile">Perfil</a>
        <a href="#logout" id="logout">Cerrar Sesión</a>
      `;
      document.getElementById("logout").addEventListener("click", () => logout());
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
  sessionStorage.removeItem("lastHash");
  token = null;
  updateUserMenu();
  window.location.hash = 'main';
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
      //initApp();
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
      //initApp();
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
            li.addEventListener("keypress", e => {
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
        //initApp();

        // Revisar historial
        const historyResp = await fetchWithAuth("/history");
        const historyData = await historyResp.json();

        window.location.hash = "tcp-simulation";
        if (historyData.success && historyData.history.length > 0) {
          showPostSimulation();
          sessionStorage.setItem(`sim_${simulationId}_started`, "true");
        } else {
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
  if (!simulationId) {
    handleError({ message: "No hay simulación seleccionada para iniciar." });
    return;
  }

  const dataSizeA = document.getElementById("data-size-input-A")?.value || "0";
  const dataSizeB = document.getElementById("data-size-input-B")?.value || "0";
  const windowSize = document.getElementById("window-size-input")?.value || "1024";
  const mss = document.getElementById("mss-input")?.value || "1460";
  const lossRatio = document.getElementById("loss-ratio-input")?.value || "0";

  const autoSeqA = document.getElementById("auto-seq-a")?.checked;
  const seqNumAInput = document.getElementById("seq-num-a");
  let seqNumA = undefined;
  if (!autoSeqA && seqNumAInput && seqNumAInput.value) {
    seqNumA = parseInt(seqNumAInput.value) || 0;
  }

  const autoSeqB = document.getElementById("auto-seq-b")?.checked;
  const seqNumBInput = document.getElementById("seq-num-b");
  let seqNumB = undefined;
  if (!autoSeqB && seqNumBInput && seqNumBInput.value) {
    seqNumB = parseInt(seqNumBInput.value) || 0;
  }

  sessionStorage.setItem("dataSizeA", dataSizeA);
  sessionStorage.setItem("dataSizeB", dataSizeB);

  clearVisualization();
  clearStateHistories();
  showLoader();

  fetchWithAuth("/start-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataSizeA,
      dataSizeB,
      windowSize,
      mss,
      lossRatio,
      seqNumA,
      seqNumB
    }),
  })
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (!data.success) {
        handleError({ message: data.error?.message || "Error al iniciar simulación" });
      } else {
        sessionStorage.setItem(`sim_${simulationId}_started`, "true");
        document.getElementById("start-simulation-btn")?.setAttribute("disabled","disabled");
        
        [
          "window-size-input","data-size-input-A","data-size-input-B",
          "mss-input","loss-ratio-input",
          "auto-seq-a","auto-seq-b","seq-num-a","seq-num-b"
        ].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = true;
        });

        showPostSimulation();
        showToast("Simulación iniciada.");
      }
    })
    .catch(handleError);
}

/********************************/
/*    INIT APP (REALTIME)       */
/********************************/
function initApp() {
  const simulationId = sessionStorage.getItem("currentSimulationId");
  if (!simulationId) {
    return;
  }
  getState("A");
  getState("B");
  getHistory();
  startRealtimeUpdates();
}

function startRealtimeUpdates() {
  stopRealtimeUpdates();
  updateInterval = setInterval(() => {
    const simulationId = sessionStorage.getItem("currentSimulationId");
    currentStateA = document.getElementById(`current-state-A`);
    currentStateB = document.getElementById(`current-state-B`);
    if (!simulationId || (currentStateA.textContent =="CLOSED" && currentStateB.textContent =="CLOSED")) {
      stopRealtimeUpdates();
      return;
    }
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
  const simulationId = sessionStorage.getItem("currentSimulationId");
  if (!simulationId) return;

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

// [MODIFICADO para 4 líneas de ventana/cwnd]
function updateTCPParams(nodeId) {
  const simulationId = sessionStorage.getItem("currentSimulationId");
  if (!simulationId) return;

  fetchWithAuth(`/param/${nodeId}`)
    .then(r => r.json())
    .then(data => {
      const paramsElem = document.getElementById(`tcp-params-${nodeId}`);
      if (paramsElem && data) {
        paramsElem.innerHTML = `
          <p><strong>Initial SeqNum:</strong> ${data.initialSeqNum}</p>
          <p><strong>SeqNum Actual:</strong> ${data.seqNum}</p>
          <p>Ack: ${data.ackNum}</p>
          <p>Ventana: ${data.windowSize}</p>
          <p>MSS: ${data.MSS}</p>
          <p>Ratio Pérdida: ${data.lossRatio}</p>
          <p>sendBase: ${data.sendBase}</p>
          <p>nextSeqNum: ${data.nextSeqNum}</p>
          <p>cwnd: ${data.cwnd}</p>
        `;
      }

      // Post-simulation
      if (nodeId === "A") {
        const postA = document.getElementById("tcp-params-A-post");
        if (postA && data) {
          postA.innerHTML = `
            <p><strong>Initial SeqNum:</strong> ${data.initialSeqNum}</p>
            <p><strong>SeqNum:</strong> ${data.seqNum}</p>
            <p>AckNum: ${data.ackNum}</p>
            <p>Ventana: ${data.windowSize}</p>
            <p>MSS: ${data.MSS}</p>
            <p>Ratio Pérdida: ${data.lossRatio}</p>
            <p>cwnd: ${data.cwnd}</p>
          `;
        }
        
        const aSizePost = document.getElementById("data-size-a-post");
        if (aSizePost) {
          aSizePost.textContent = data.dataSize;
        }
      } else {
        const postB = document.getElementById("tcp-params-B-post");
        if (postB && data) {
          postB.innerHTML = `
            <p><strong>Initial SeqNum:</strong> ${data.initialSeqNum}</p>
            <p><strong>SeqNum:</strong> ${data.seqNum}</p>
            <p>AckNum: ${data.ackNum}</p>
            <p>Ventana: ${data.windowSize}</p>
            <p>MSS: ${data.MSS}</p>
            <p>Ratio Pérdida: ${data.lossRatio}</p>
            <p>cwnd: ${data.cwnd}</p>
          `;
        }
        const bSizePost = document.getElementById("data-size-b-post");
        if (bSizePost) {
          bSizePost.textContent = data.dataSize;
        }
      }
    })
    .catch(handleError);
}

/********************************/
/* HISTORIAL TCP                */
/********************************/
function getHistory() {
  const simulationId = sessionStorage.getItem("currentSimulationId");
  if (!simulationId) return;

  fetchWithAuth("/history")
    .then(r => r.json())
    .then(data => {
      if (!data.success) return;
      messageData = data.history || [];
      if (messageData.length > 0) {
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
          m.param = param;
        });
        renderAll();

        // Historial textual
        const historyA = document.getElementById("state-history-A");
        const historyB = document.getElementById("state-history-B");
        if (historyA) historyA.innerHTML = "";
        if (historyB) historyB.innerHTML = "";

        messageData.forEach(msg => {
          if (!msg.param) return;
          const param = msg.param;
          const flags = param.flags || {};
          const isLost = param.isLost;
          const lostLabel = isLost ? " [LOST]" : "";
          const activeFlags = Object.entries(flags)
            .filter(([_, v]) => v)
            .map(([k]) => k);

          const li = document.createElement("li");
          li.textContent = `Seq:${param.seqNum}, Ack:${param.ackNum}, Flags:[${activeFlags.join(", ")}], Len:${msg.len}${lostLabel}`;
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
/* VISUALIZACIÓN D3 SIMULACIÓN  */
/********************************/
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

function createTimeScale(data) {
  if (!data || data.length === 0) {
    timeScale = null;
    return;
  }
  let times = [];
  data.forEach(d => {
    times.push(d.startTime, d.arrivalTime);
  });
  earliestTime = new Date(Math.min(...times.map(t => t.getTime())));
  latestTime = new Date(Math.max(...times.map(t => t.getTime())));

  if (earliestTime.getTime() === latestTime.getTime()) {
    latestTime = new Date(earliestTime.getTime() + 1000);
  }

  const zoomVal = document.getElementById("time-zoom-value")?.textContent || 200;
  timeScale = d3.scaleTime()
    .domain([earliestTime, latestTime])
    .range([50, parseInt(zoomVal)]);
}

function renderAll() {
  if (!messageData || messageData.length === 0) return;

  const { DataA, DataB } = renderChart(messageData);
  drawChart(DataA, DataB);

  arrowIdCounter = 1;

  createTimeScale(messageData);
  const synChecked = document.getElementById("filter-syn")?.checked;
  const ackChecked = document.getElementById("filter-ack")?.checked;
  const finChecked = document.getElementById("filter-fin")?.checked;
  const rstChecked = document.getElementById("filter-rst")?.checked;
  const dataChecked = document.getElementById("filter-data")?.checked;

  const filtered = messageData.filter(m => {
    if (!m.param || !m.param.flags) return false;
    const flags = m.param.flags;
    const isPureAck = (flags.ACK && !flags.SYN && !flags.FIN && !flags.RST && m.len === 0);
    const isData = (m.len > 0 && !flags.SYN && !flags.FIN && !flags.RST && !isPureAck);

    if (flags.SYN && !synChecked) return false;
    if (isPureAck && !ackChecked) return false;
    if (flags.FIN && !finChecked) return false;
    if (flags.RST && !rstChecked) return false;
    if (isData && !dataChecked) return false;

    return true;
  });

  renderMessages(filtered);
}

function renderMessages(data) {
  const svg = d3.select("#simulation-visual");
  svg.selectAll("g[id^='message-']").remove();

  const arrowList = document.getElementById("arrow-list");
  if (arrowList) {
    arrowList.innerHTML = "";
  }

  if (!data || data.length === 0 || !timeScale) return;

  data.sort((a, b) => a.startTime - b.startTime);

  for (let i = 0; i < data.length; i++) {
    let offsetCount = 0;
    for (let j = 0; j < i; j++) {
      const diff = data[i].startTime - data[j].startTime;
      if (Math.abs(diff) < timeThresholdForJitter) {
        offsetCount++;
      }
    }
    data[i].jitterOffset = offsetCount * messageVerticalJitter;

    const arrowId = arrowIdCounter++;
    drawMessageArrow(data[i], arrowId);
  }
  
  document.getElementById('arrow-list').style.height =`${46*data.length}px`;
  updateSVGHeight();
}

function drawMessageArrow(entry, arrowId) {
  const svg = d3.select("#simulation-visual");
  const group = svg.append("g").attr("id", `message-${entry.id}`);

  const param = entry.param;
  const flags = param.flags;
  const isLost = param.isLost;
  const isA = (entry.node_id === "A");
  const xA = 200;
  const xB = 600;

  const yStart = timeScale(entry.startTime) + (entry.jitterOffset || 0);
  const yEnd = timeScale(entry.arrivalTime);

  const xStart = isA ? xA : xB;
  const xEnd = isA ? xB : xA;

  let lineColor = "red";
  if (flags.SYN && flags.ACK) lineColor = "green";
  else if (flags.SYN) lineColor = "green";
  else if (flags.FIN) lineColor = "orange";
  else if (flags.RST) lineColor = "violet";
  else if (flags.ACK && !flags.SYN && !flags.FIN && !flags.RST && entry.len === 0) lineColor = "blue";
  if (isLost) {
    lineColor = "gray";
  }

  let messageText = `[#${arrowId}] Node=${entry.node_id}, Seq=${param.seqNum}, Ack=${param.ackNum}, Flags=[${Object.keys(flags).filter(f => flags[f]).join(", ")}], Len=${entry.len}`;
  if (isLost) {
    messageText += " [LOST]";
  }

  const line = group.append("line")
    .attr("x1", xStart)
    .attr("y1", yStart)
    .attr("x2", xEnd)
    .attr("y2", yEnd)
    .attr("stroke", lineColor)
    .attr("stroke-width", 2);

  if (!isLost) {
    line.attr("marker-end", "url(#arrowhead)");
  }

  group.append("text")
    .attr("x", xStart)
    .attr("y", yStart - 5)
    .attr("font-size", "12px")
    .attr("fill", lineColor)
    .attr("text-anchor", "middle")
    .text(`#${arrowId}`);

  line.on("mouseover", (event) => {
    tooltip.style("opacity", 1)
      .attr("data-visible", "true")
      .html(messageText)
      .style("left", (event.pageX + 5) + "px")
      .style("top", (event.pageY + 5) + "px");
  }).on("mouseout", () => {
    tooltip.style("opacity", 0).attr("data-visible", "false");
  });

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

  if (isLost) {
    group.append("text")
      .attr("x", xEnd + (xEnd > xStart ? 10 : -10))
      .attr("y", yEnd)
      .attr("font-size", "14px")
      .attr("fill", "red")
      .text("X");
  }

  const arrowList = document.getElementById("arrow-list");
  if (arrowList) {
    const arrowItem = document.createElement("div");
    arrowItem.className = "arrow-item";
    arrowItem.textContent = `ID=#${arrowId}, node_id=${entry.node_id}, seq=${param.seqNum}, ack=${param.ackNum}, flags=${Object.keys(flags).filter(f=>flags[f]).join(",")}, len=${entry.len}, lost=${isLost||false}`;
    arrowList.appendChild(arrowItem);
  }
}

function updateSVGHeight() {
  const svgElement = document.getElementById("simulation-visual");
  if (!svgElement) return;

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

    let dateRange = latestTime - earliestTime;
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
/*  GRÁFICA DE VENTANA (4 LÍNEAS) */
/********************************/
function renderChart(data) {
  if (!data || data.length === 0) return { DataA: [], DataB: [] };

  let lastAckA = 0;
  let lastAckB = 0;

  let lastSeqA = 0;
  let lastSeqB = 0;

  DataA = [];
  DataB = [];

  // Ordenamos todos los eventos por tiempo de llegada
  data.sort((a, b) => a.arrivalTime - b.arrivalTime);

  data.forEach(evt => {
    let param = evt.param
    if(!param.isLost){
      if (evt.node_id === "A") {
        if (param.flags.ACK) {
          lastAckA = param.ackNum;
        }
        lastSeqB = param.seqNum + evt.len
        if(lastAckB == 0){
          lastAckB = lastSeqB
        }
      }
      else if (evt.node_id === "B") {
        if (param.flags.ACK) {
          lastAckB = param.ackNum;
        }
        lastSeqA = param.seqNum + evt.len
        if(lastAckA == 0){
          lastAckA = lastSeqA
        }
      }
    }
    DataA.push({ time: evt.arrivalTime, value: lastSeqA - lastAckA });
    DataB.push({ time: evt.arrivalTime, value: lastSeqB - lastAckB });
  });
  return { DataA, DataB };
}



function drawChart(DataA, DataB) {
  const windowChart = d3.select("#window-chart");
  if (!windowChart.node()) return;

  // Limpia el gráfico anterior
  windowChart.selectAll("*").remove();

  // -- Preparar escalas --

  // Recolectamos todos los tiempos
  const allTimes = [
    ...DataA.map(d => d.time),
    ...DataB.map(d => d.time)
  ];
  if (allTimes.length === 0) return;

  const xDomain = d3.extent(allTimes);

  // Obtenemos el máximo valor de entre las dos series
  const maxValueA = d3.max(DataA, d => d.value) || 0;
  const maxValueB = d3.max(DataB, d => d.value) || 0;
  const maxVal = Math.max(maxValueA, maxValueB);

  // Dimensiones del SVG
  const width = 800;
  const height = 200;
  const margin = { top: 20, right: 20, bottom: 30, left: 50 };

  // Escala X (tiempo)
  const xScale = d3.scaleTime()
    .domain(xDomain)
    .range([margin.left, width - margin.right]);

  // Escala Y (valor)
  const yScale = d3.scaleLinear()
    .domain([0, maxVal])
    .range([height - margin.bottom, margin.top]);

  // Creamos el SVG si no existe, o lo seleccionamos
  const svg = windowChart
    .attr("width", width)
    .attr("height", height);

  // Eje X
  const xAxis = d3.axisBottom(xScale)
    .ticks(8)
    .tickFormat(d3.timeFormat("%H:%M:%S"));

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(xAxis);

  // Eje Y
  const yAxis = d3.axisLeft(yScale).ticks(5);

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(yAxis);

  // Generador de línea para DataA
  const lineA = d3.line()
    .x(d => xScale(d.time))
    .y(d => yScale(d.value))
    // Usamos stepAfter para mantener el valor hasta el siguiente punto
    .curve(d3.curveStepAfter);

  // Generador de línea para DataB
  const lineB = d3.line()
    .x(d => xScale(d.time))
    .y(d => yScale(d.value))
    .curve(d3.curveStepAfter);

  // Dibujar la línea para DataA (azul)
  if (DataA.length > 1) {
    svg.append("path")
      .datum(DataA)
      .attr("fill", "none")
      .attr("stroke", "blue")
      .attr("stroke-width", 2)
      .attr("d", lineA);
  }

  // Dibujar la línea para DataB (verde)
  if (DataB.length > 1) {
    svg.append("path")
      .datum(DataB)
      .attr("fill", "none")
      .attr("stroke", "green")
      .attr("stroke-width", 2)
      .attr("d", lineB);
  }

  // Leyendas o etiquetas
  svg.append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 5)
    .attr("fill", "blue")
    .style("font-size", "12px")
    .text("Nodo A");

  svg.append("text")
    .attr("x", margin.left + 60)
    .attr("y", margin.top - 5)
    .attr("fill", "green")
    .style("font-size", "12px")
    .text("Nodo B");

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text("Tiempo");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(height / 2))
    .attr("y", 15)
    .style("text-anchor", "middle")
    .style("font-size", "12px")
    .text("Tamaño de ventana (bytes)");
}








/********************************/
/* LIMPIAR VISUAL E HISTORIAL   */
/********************************/
function clearVisualization() {
  d3.select("#simulation-visual").selectAll("*").remove();
  setupVisualSimulation();
  d3.select("#window-chart").selectAll("*").remove();

  // [MODIFICADO] Limpiar arrays
  DataA = [];
  DataB = [];
}

function clearStateHistories() {
  document.getElementById("state-history-A")?.replaceChildren();
  document.getElementById("state-history-B")?.replaceChildren();
}

/********************************/
/* FETCH CON TOKEN (AUTH)       */
/********************************/
function fetchWithAuth(url, options = {}) {
  if (!options.headers) options.headers = {};
  options.headers.Authorization = token;
  return fetch(url, options).then(async response => {
    if (!response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch (err) {}
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
/* DRAG & DROP (Wireshark)      */
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
