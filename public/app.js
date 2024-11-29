// app.js
let token = sessionStorage.getItem("token");
let updateInterval;

document.addEventListener("DOMContentLoaded", () => {
    setupVisualSimulation();
    setupArrowhead();
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
function getHistory() {
    fetchWithAuth(`/history`)
        .then(response => response.json())
        .then(data => {
            data.history.forEach(entry => {
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
    const dataSize = document.getElementById(`data-size-input-${nodeId}`).value || 0;
    fetchWithAuth(`/start-message-exchange/${nodeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSize })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            startRealtimeUpdates();
        } else {
            alert("Error: " + data.error);
        }
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
            eliminarElementosG()
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


// Configuración inicial de D3.js
function setupVisualSimulation() {
    const svg = d3.select("#simulation-visual");

    // Barra vertical para Nodo A
    svg.append("line")
        .attr("x1", 200) // Coordenada X fija para Nodo A
        .attr("y1", 50)  // Empieza arriba
        .attr("x2", 200) // Misma coordenada X
        .attr("y2", 350) // Termina abajo
        .attr("stroke", "black")
        .attr("stroke-width", 3);

    // Etiqueta para Nodo A
    svg.append("text")
        .attr("x", 200)
        .attr("y", 30) // Coordenada Y ligeramente arriba de la barra
        .attr("text-anchor", "middle") // Centrar el texto horizontalmente
        .text("Node A")
        .attr("font-size", "14px")
        .attr("fill", "black");

    // Barra vertical para Nodo B
    svg.append("line")
        .attr("x1", 600) // Coordenada X fija para Nodo B
        .attr("y1", 50)  // Empieza arriba
        .attr("x2", 600) // Misma coordenada X
        .attr("y2", 350) // Termina abajo
        .attr("stroke", "black")
        .attr("stroke-width", 3);

    // Etiqueta para Nodo B
    svg.append("text")
        .attr("x", 600)
        .attr("y", 30) // Coordenada Y ligeramente arriba de la barra
        .attr("text-anchor", "middle") // Centrar el texto horizontalmente
        .text("Node B")
        .attr("font-size", "14px")
        .attr("fill", "black");
}


function eliminarElementosG() {
    // Selecciona todas las secciones en el documento
    const secciones = document.getElementById("simulation-visual");

    // Encuentra todos los elementos <g> dentro de esta sección
    const elementosG = secciones.querySelectorAll('g');

    // Elimina cada elemento <g>
    elementosG.forEach(g => g.remove());
}

// Función para actualizar las flechas dinámicamente
let messageCount = 0;

function drawMessageArrow(entry) {
    const svg = d3.select("#simulation-visual");
    const arrowGroup = svg.append("g")
    .attr("id", `message-${entry.id}`);
    let param = JSON.parse(entry.parameter_TCP)
    const activeFlags = Object.entries(param.flags)
    .filter(([key, value]) => value)
    .map(([key]) => key);

    // Alternar entre las barras verticales
    const isA = entry.node_id === "A";
    const xStart = isA ? 200 : 600; // Nodo A o Nodo B
    const xEnd = isA ? 600 : 200; // Nodo B o Nodo A
    const yOffset = 50 + messageCount * 20; // Espaciado entre flechas

    // Calcular el ángulo de la flecha en grados
    const deltaX = xEnd - xStart;
    const deltaY = 20;
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    if(angle > 90) angle = angle+180;

    // Dibuja la flecha diagonal
    arrowGroup.append("line")
        .attr("x1", xStart)
        .attr("y1", yOffset)
        .attr("x2", xEnd)
        .attr("y2", yOffset + 20)
        .attr("stroke", "red")
        .attr("stroke-width", 2)
        .attr("marker-end", "url(#arrowhead)");

    // Texto del mensaje junto a la flecha
    arrowGroup.append("text")
    .attr("x", (xStart + xEnd) / 2) // Posición en el centro de la flecha
    .attr("y", (yOffset + yOffset + 20) / 2) // Posición en el centro de la flecha
    .text(`Seq: ${param.seqNum}, Ack: ${param.ackNum}, Flags: ${activeFlags}, len ${entry.len}`)
    .attr("font-size", "12px")
    .attr("fill", "black")
    .attr("text-anchor", "middle") // Centrar el texto
    .attr("transform", `rotate(${angle}, ${(xStart + xEnd) / 2}, ${(yOffset + yOffset + 20) / 2})`); // Rotar el texto en diagonal


    messageCount++;
}


// Configura el marcador de flecha
function setupArrowhead() {
    const svg = d3.select("#simulation-visual");
    console.log("Configurando marcador de flecha..."); // Depuración
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 5)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "red");
    console.log("Marcador de flecha configurado.");
}
