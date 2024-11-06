// app.js
let token = sessionStorage.getItem("token");
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
    if (token) {
        initApp();
    }
});

function initApp() {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("tcp-simulation").style.display = "block";
    getState("A");
    getState("B");
    getHistory("A");
    getHistory("B");
    updateTransitionButtons("A", "CLOSED")
    updateTransitionButtons("B", "CLOSED")
    startRealtimeUpdates();
}

function startRealtimeUpdates() {
    stopRealtimeUpdates(); // Evita duplicados de intervalos
    updateInterval = setInterval(() => {
        getState("A");
        getState("B");
        getHistory("A");
        getHistory("B");
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
                listItem.textContent = `[${entry.timestamp}] Seq: ${entry.seq_num}, Ack: ${entry.ack_num}, Data Size: ${entry.data_size}, Message: ${entry.message}`;
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
            document.getElementById("tcp-simulation").style.display = "block";
            startRealtimeUpdates();
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