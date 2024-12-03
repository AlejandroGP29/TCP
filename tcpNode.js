// tcpNode.js
const db = require("./db");

class MessageTCP {
  constructor(node) {
    this.srcPort = node.srcPort;
    this.destPort = node.destPort;
    this.seqNum = node.seqNum;
    this.ackNum = node.ackNum;
    this.dataOffset = 5;
    this.reserved = 0;
    this.flags = {
      NS: false,
      CWR: false,
      ECE: false,
      URG: false,
      ACK: false,
      PSH: false,
      RST: false,
      SYN: false,
      FIN: false,
    };
    this.windowSize = node.windowSize;
    this.checksum = node.generateChecksum();
    this.urgentPointer = 0;
    this.options = {
      MSS: 1460,
    };
    this.padding = 0;
    this.message = "";
    this.latency = node.latency;
  }
}

class TCPNode {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.states = {
      CLOSED: "CLOSED",
      LISTEN: "LISTEN",
      SYN_SENT: "SYN_SENT",
      SYN_RECEIVED: "SYN_RECEIVED",
      ESTABLISHED: "ESTABLISHED",
      FIN_WAIT_1: "FIN_WAIT_1",
      FIN_WAIT_2: "FIN_WAIT_2",
      CLOSE_WAIT: "CLOSE_WAIT",
      LAST_ACK: "LAST_ACK",
      CLOSING: "CLOSING",
      TIME_WAIT: "TIME_WAIT",
    };
    this.state = this.states.CLOSED;
    this.partnerNode = null;

    this.srcPort = Math.floor(Math.random() * 65535);
    this.destPort = 0;
    this.seqNum = Math.floor(Math.random() * 10000);
    this.ackNum = 0;
    this.windowSize = 1024;
    this.checksum = this.generateChecksum();

    this.buffer = 0;
    this.ttl = 64;
    this.latency = Math.floor(Math.random() * 500) + 100; // Latencia entre 100 y 600 ms
    this.MTU = 1500;
    this.ackReceived = false;
    this.pendingDataSize = 0; // Datos pendientes de enviar
    this.timeWaitDuration = 2 * this.latency; // Duración de TIME_WAIT
    this.appCloseDelay = 0; // Delay simulado para cerrar la conexión en el servidor
    this.closing = false; // Indicador de que se ha iniciado el cierre
  }

  setNodeParameter(parameterSettings) {
    this.state = parameterSettings.state;
    this.buffer = parameterSettings.buffer;
    this.ttl = parameterSettings.ttl;
    this.latency = parameterSettings.latency;
    this.MTU = parameterSettings.MTU;
    this.srcPort = parameterSettings.srcPort;
    this.destPort = parameterSettings.destPort;
    this.seqNum = parameterSettings.seqNum;
    this.ackNum = parameterSettings.ackNum;
    this.windowSize = parameterSettings.windowSize;
    this.checksum = parameterSettings.checksum;
  }

  getParameters() {
    return {
      nodeId: this.nodeId,
      state: this.state,
      buffer: this.buffer,
      ttl: this.ttl,
      latency: this.latency,
      MTU: this.MTU,
      srcPort: this.srcPort,
      destPort: this.destPort,
      seqNum: this.seqNum,
      ackNum: this.ackNum,
      windowSize: this.windowSize,
      checksum: this.checksum,
    };
  }

  transition(action, simulationId) {
    switch (this.state) {
      case this.states.CLOSED:
        if (action === "start_simulation") {
          if (this.nodeId === "A") {
            // Nodo A inicia conexión
            this.state = this.states.SYN_SENT;
            let message = new MessageTCP(this);
            message.flags.SYN = true;
            this.sendMessage(message, 0, simulationId);
            this.seqNum += 1; // Incrementar seqNum por SYN
          } else if (this.nodeId === "B") {
            // Nodo B espera conexión
            this.state = this.states.LISTEN;
          }
        }
        break;

      case this.states.LISTEN:
        // Espera por SYN entrante
        break;

      case this.states.SYN_SENT:
        if (action === "recv_syn_ack") {
          this.state = this.states.ESTABLISHED;
          this.ackNum = this.partnerNode.seqNum;
          let message = new MessageTCP(this);
          message.flags.ACK = true;
          this.sendMessage(message, 0, simulationId);
          // Iniciar transmisión de datos si hay datos pendientes
          if (this.pendingDataSize > 0) {
            this.transition("send_data", simulationId);
          }
        }
        break;

      case this.states.SYN_RECEIVED:
        if (action === "recv_ack") {
          this.state = this.states.ESTABLISHED;
          // Iniciar transmisión de datos si hay datos pendientes
          if (this.pendingDataSize > 0) {
            this.transition("send_data", simulationId);
          }
        }
        break;

      case this.states.ESTABLISHED:
        if (action === "send_data") {
          this.sendData(this.pendingDataSize, simulationId);
        } else if (action === "recv_data") {
          // Procesar datos recibidos si es necesario
          // No es necesario realizar ninguna acción específica aquí
        } else if (action === "recv_fin") {
          this.state = this.states.CLOSE_WAIT;
          this.ackNum = this.partnerNode.seqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);
          // Iniciar cierre de conexión desde CLOSE_WAIT
          this.transition("close_connection", simulationId);
        } else if (action === "close_connection") {
          if (!this.closing) {
            this.closing = true;
            this.state = this.states.FIN_WAIT_1;
            let finMessage = new MessageTCP(this);
            finMessage.flags.FIN = true;
            this.sendMessage(finMessage, 0, simulationId);
            this.seqNum += 1; // Incrementar seqNum por FIN
          }
        }
        break;

      case this.states.FIN_WAIT_1:
        if (action === "recv_ack") {
          this.state = this.states.FIN_WAIT_2;
        } else if (action === "recv_fin") {
          this.state = this.states.CLOSING;
          this.ackNum = this.partnerNode.seqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);
        }
        break;

      case this.states.FIN_WAIT_2:
        if (action === "recv_fin") {
          this.state = this.states.TIME_WAIT;
          this.ackNum = this.partnerNode.seqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);
          setTimeout(() => {
            this.state = this.states.CLOSED;
          }, this.timeWaitDuration);
        }
        break;

      case this.states.CLOSING:
        if (action === "recv_ack") {
          this.state = this.states.TIME_WAIT;
          setTimeout(() => {
            this.state = this.states.CLOSED;
          }, this.timeWaitDuration);
        }
        break;

      case this.states.CLOSE_WAIT:
        if (action === "close_connection") {
          if (!this.closing) {
            this.closing = true;
            this.state = this.states.LAST_ACK;
            let finMessage = new MessageTCP(this);
            finMessage.flags.FIN = true;
            this.sendMessage(finMessage, 0, simulationId);
            this.seqNum += 1; // Incrementar seqNum por FIN
          }
        }
        break;

      case this.states.LAST_ACK:
        if (action === "recv_ack") {
          this.state = this.states.CLOSED;
        }
        break;

      case this.states.TIME_WAIT:
        // Espera a que expire el temporizador
        break;

      default:
        break;
    }
  }

  setPartner(node) {
    this.partnerNode = node;
    this.destPort = node.srcPort;
  }

  sendData(size, simulationId) {
    let dataSize = Number(size);
    if (dataSize > this.windowSize) {
      console.log("Datos exceden el tamaño de ventana, se segmentarán.");
      while (dataSize > 0) {
        let segmentSize = Math.min(dataSize, this.windowSize, this.MTU);
        let message = new MessageTCP(this);
        this.sendMessage(message, segmentSize, simulationId);
        this.seqNum += segmentSize;
        dataSize -= segmentSize;
      }
    } else if (dataSize > 0) {
      let message = new MessageTCP(this);
      this.sendMessage(message, dataSize, simulationId);
      this.seqNum += dataSize;
    }
    this.pendingDataSize = 0; // Datos enviados
    // Iniciar cierre de conexión si no hay más datos y no se ha iniciado ya
    if (!this.closing) {
      this.transition("close_connection", simulationId);
    }
  }

  sendMessage(message, dataSize, simulationId) {
    message.latency = this.latency;
    message.len = dataSize;
    this.saveMessage(message, dataSize, simulationId);

    setTimeout(() => {
      if (this.partnerNode) {
        this.partnerNode.receiveMessage(message, simulationId);
      }
    }, this.latency);
  }

  receiveMessage(packet, simulationId) {
    if (packet.flags.SYN && !packet.flags.ACK) {
      // Recibido SYN, enviar SYN-ACK
      this.state = this.states.SYN_RECEIVED;
      this.ackNum = packet.seqNum;
      let response = new MessageTCP(this);
      response.flags.SYN = true;
      response.flags.ACK = true;
      this.sendMessage(response, 0, simulationId);
      this.seqNum += 1; // Incrementar seqNum por SYN-ACK
    } else if (packet.flags.SYN && packet.flags.ACK) {
      // Recibido SYN-ACK
      this.ackNum = packet.seqNum;
      this.transition("recv_syn_ack", simulationId);
    } else if (packet.flags.ACK && !packet.flags.SYN && !packet.flags.FIN) {
      if (this.state === this.states.SYN_RECEIVED) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.FIN_WAIT_1) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.CLOSING) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.LAST_ACK) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.ESTABLISHED) {
        // ACK de datos
      }
    } else if (packet.flags.FIN && !packet.flags.ACK) {
      if (
        this.state === this.states.ESTABLISHED
        || this.state === this.states.FIN_WAIT_1
        || this.state === this.states.FIN_WAIT_2
      ) {
        this.transition("recv_fin", simulationId);
      } else if (this.state === this.states.CLOSE_WAIT) {
        // Ignorar FIN adicional
      }
    } else if (packet.flags.FIN && packet.flags.ACK) {
      // Si se recibe un FIN y ACK juntos
      if (this.state === this.states.FIN_WAIT_1) {
        this.state = this.states.CLOSING;
        this.ackNum = packet.seqNum;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
      } else if (this.state === this.states.ESTABLISHED) {
        this.state = this.states.CLOSE_WAIT;
        this.ackNum = packet.seqNum;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
        // Iniciar cierre de conexión desde CLOSE_WAIT
        this.transition("close_connection", simulationId);
      }
    } else if (!packet.flags.SYN && !packet.flags.ACK && !packet.flags.FIN) {
      // Mensajes de datos
      if (this.state === this.states.ESTABLISHED) {
        this.ackNum = packet.seqNum + packet.len;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
        // Procesar datos recibidos
        this.transition("recv_data", simulationId);
      }
    }
  }

  generateChecksum() {
    return (
      (this.srcPort +
        this.destPort +
        this.seqNum +
        this.ackNum +
        this.windowSize +
        this.ttl) %
      65535
    );
  }

  saveMessage(message, dataSize, simulationId) {
    const query = `
      INSERT INTO MessageHistory (
        simulation_id, node_id, parameter_TCP, len
      ) VALUES (?, ?, ?, ?)
    `;

    const parameters = {
      srcPort: message.srcPort,
      destPort: message.destPort,
      seqNum: message.seqNum,
      ackNum: message.ackNum,
      dataOffset: message.dataOffset,
      reserved: message.reserved,
      flags: message.flags,
      windowSize: message.windowSize,
      checksum: message.checksum,
      urgentPointer: message.urgentPointer,
      options: message.options,
      padding: message.padding,
      latency: message.latency,
    };

    db.run(
      query,
      [simulationId, this.nodeId, JSON.stringify(parameters), dataSize],
      (err) => {
        if (err) {
          console.error("Error al guardar el mensaje:", err.message);
        } else {
          console.log("Mensaje guardado exitosamente.");
        }
      }
    );
  }

  startSimulation(dataSize, simulationId) {
    this.pendingDataSize = dataSize;
    this.transition("start_simulation", simulationId);
  }
}

module.exports = TCPNode;
