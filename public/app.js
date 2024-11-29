// app.js
let token = sessionStorage.getItem("token");
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
    updateUserMenu();
    if (token) {
        initApp();
        document.getElementById("auth-section").style.display = "none";
        document.getElementById("simulation-selection").style.display = "block";
        loadSimulations()
    }
});

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
}

function showAuth() {
    document.getElementById("auth-section").style.display = "block";
    document.querySelector("main").style.display = "none";
}

function initApp() {
    getState("A");
    getState("B");
    getHistory("A");
    getHistory("B");
}

function startRealtimeUpdates() {
    stopRealtimeUpdates(); // Evita duplicados de intervalos
    updateInterval = setInterval(() => {
        getState("A");
        getState("B");
        getHistory("A");
        getHistory("B");
        updateSimulation();
    }, 1000);
}

function stopRealtimeUpdates() {
    if (updateInterval) clearInterval(updateInterval);
}

// Solicitar el estado del nodo
function getState(nodeId) {
    fetchWithAuth(`/state/${nodeId}`)
        .then(response => response.json())
        .then(data => {
            if(document.getElementById(`current-state-${nodeId}`).textContent != data.state){
                document.getElementById(`current-state-${nodeId}`).textContent = data.state;
                updateTransitionButtons(nodeId, data.state); 
            }
        })
        .catch(() => alert("Error al obtener el estado del nodo."));
}

// Obtener y mostrar el historial de mensajes
function getHistory(nodeId) {
    fetchWithAuth(`/history/${nodeId}`)
        .then(response => response.json())
        .then(data => {
            const historyList = document.getElementById(`history-list-${nodeId}`);
            historyList.innerHTML = "";
            data.history.forEach(entry => {
                const listItem = document.createElement("li"); 
                let param = JSON.parse(entry.parameter_TCP)
                const activeFlags = Object.entries(param.flags)
                .filter(([key, value]) => value)
                .map(([key]) => key);
                listItem.textContent = `[${entry.timestamp}] Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: ${activeFlags}`;
                historyList.appendChild(listItem);
            });
        });
}

function updateTransitionButtons(nodeId, state) {
    const transitions = {
      CLOSED: ["listen", "send_syn"],
      LISTEN: ["send_syn", "close"],
      SYN_SENT: ["recv_syn_ack", "close"],
      SYN_RECEIVED: ["send_ack", "close"],
      ESTABLISHED: ["close"],
      CLOSE_WAIT: ["send_fin" ],
    };

    const actions = transitions[state] || [];
    const buttonContainer = document.getElementById(`transition-buttons-${nodeId}`);
    buttonContainer.innerHTML = "";

    actions.forEach(action => {
        const button = document.createElement("button");
        button.textContent = action;
        button.onclick = () => performTransition(nodeId, action);
        buttonContainer.appendChild(button);
    });

    if(state == "ESTABLISHED"){
        const input = document.createElement("input");
        input.type = "number";
        input.id=`data-size-input-${nodeId}`;
        input.placeholder="Tamaño de datos (bytes)";
        buttonContainer.appendChild(input);

        const button = document.createElement("button");
        button.textContent = "send";
        button.onclick = () => startMessageExchange(nodeId);
        buttonContainer.appendChild(button);
    }
}

function performTransition(nodeId, action) {
    fetchWithAuth(`/transition/${nodeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) startRealtimeUpdates();
        else alert("Error: " + data.error);
    });
}


// Funciones de autenticación y gestión de usuarios
function fetchWithAuth(url, options = {}) {
    options.headers = { ...options.headers, "Authorization": token };
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
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    }).then(response => response.json()).then(data => {
        alert(data.success ? "Usuario registrado correctamente." : `Error: ${data.error}`);
    });
}

function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    }).then(response => response.json()).then(data => {
        if (data.success) {
            token = data.token;
            sessionStorage.setItem("token", token);
            document.getElementById("auth-section").style.display = "none";
            document.getElementById("simulation-selection").style.display = "block";
            loadSimulations()
        } else {
            alert(`Error: ${data.error}`);
        }
    });
}

function startMessageExchange(nodeId) {
    const dataSize = document.getElementById(`data-size-input-${nodeId}`).value
    fetchWithAuth(`/start-message-exchange/${nodeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSize })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) startRealtimeUpdates();
        else alert("Error: " + data.error);
    });
}


// Solicitar el estado del nodo
function getParam(nodeId) {
    fetchWithAuth(`/param/${nodeId}`)
        .then(response => response.json())
        .then(data => {
            updateTCPDetails(nodeId, data);
        })
        .catch(() => alert("Error al obtener los parametros del nodo."));
}

// Mostrar detalles TCP completos
function updateTCPDetails(nodeId, tcpParams) {
    const detailsContainer = document.getElementById(`tcp-details-${nodeId}`);
    detailsContainer.innerHTML = `
        <p>Seq Num: ${tcpParams.seqNum}</p>
        <p>Ack Num: ${tcpParams.ackNum}</p>
        <p>Window Size: ${tcpParams.windowSize}</p>
        <p>TTL: ${tcpParams.ttl}</p>
    `;
}

function loadSimulations() {
    fetchWithAuth('/simulations')
        .then(response => response.json())
        .then(data => {
            const simulationList = document.getElementById("simulation-list");
            simulationList.innerHTML = ""; // Limpia la lista
            data.simulations.forEach(sim => {
                const listItem = document.createElement("li");
                listItem.textContent = `Simulación ${sim.id} - Parámetros: ${sim.parameter_settings}`;
                listItem.onclick = () => selectSimulation(sim.id);
                simulationList.appendChild(listItem);
            });
        })
        .catch(() => alert("Error al cargar simulaciones."));
}

function createNewSimulation() {
    const defaultSettings = { param1: "valor1", param2: "valor2" }; // Cambiar según lo necesario
    fetchWithAuth('/createSimulations')
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert("Nueva simulación creada.");
            loadSimulations();
        } else {
            alert("Error al crear simulación.");
        }
    });
}

function selectSimulation(simulationId) {
    fetchWithAuth('/enterSimulation', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulator_id: simulationId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            token = data.token;
            sessionStorage.setItem("token", token);
            document.getElementById("simulation-selection").style.display = "none";
            document.getElementById("tcp-simulation").style.display = "block";
            initApp()
        } else {
            alert(`Error: ${data.error}`);
        }
    });
    
}

function goBackToSelection() {
    fetchWithAuth('/goBack')
        .then(response => response.json())
        .then(data => {
        if (data.success) {
            updateSimulation();
            token = data.token;
            sessionStorage.setItem("token", token);
            document.getElementById("tcp-simulation").style.display = "none";
            document.getElementById("simulation-selection").style.display = "block";
            loadSimulations()
            stopRealtimeUpdates()
        } else {
            alert(`Error: ${data.error}`);
        }
    });    
}

function updateSimulation(){
    fetchWithAuth('/updateSimulations')
        .then(response => response.json())
        .then(data => {
        })
        .catch(() => alert("Error al actualizar simulaciones."));
}
