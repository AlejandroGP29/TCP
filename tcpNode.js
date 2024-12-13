// tcpNode.js
const db = require("./db");

class MessageTCP {
  constructor(node) {
    this.srcPort = node.srcPort;
    this.destPort = node.destPort;
    this.seqNum = node.nextSeqNum; 
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
      MSS: node.MSS
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
    this.seqNum = Math.floor(Math.random() * 10000); // ISN
    this.ackNum = 0;
    this.windowSize = 1024;
    this.checksum = this.generateChecksum();

    this.buffer = 0;
    this.ttl = 64;
    this.latency = Math.floor(Math.random() * 500) + 100; 
    this.MTU = 1500;
    this.MSS = 1460; 
    this.lossRatio = 0.0; 
    this.ackReceived = false;
    this.pendingDataSize = 0;
    this.timeWaitDuration = 2 * this.latency;
    this.appCloseDelay = 0;
    this.closing = false;

    // Control de ventana
    this.sendBase = this.seqNum;  
    this.nextSeqNum = this.seqNum; 
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

    if (parameterSettings.MSS) this.MSS = parameterSettings.MSS;
    if (parameterSettings.lossRatio !== undefined) this.lossRatio = parameterSettings.lossRatio;

    this.sendBase = this.seqNum;
    this.nextSeqNum = this.seqNum;
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
      MSS: this.MSS,
      lossRatio: this.lossRatio,
      sendBase: this.sendBase,
      nextSeqNum: this.nextSeqNum
    };
  }

  transition(action, simulationId) {
    switch (this.state) {
      case this.states.CLOSED:
        this.closing = false;
        this.pendingDataSize = this.pendingDataSize || 0;
        this.buffer = 0;
        this.ackReceived = false;

        if (action === "start_simulation") {
          if (this.nodeId === "A") {
            // Enviar SYN
            this.state = this.states.SYN_SENT;
            let message = new MessageTCP(this);
            message.flags.SYN = true;
            this.sendMessage(message, 0, simulationId);
            this.nextSeqNum += 1; // SYN consume seq
          } else if (this.nodeId === "B") {
            this.state = this.states.LISTEN;
          }
        }
        break;

      case this.states.LISTEN:
        // Espera SYN
        break;

      case this.states.SYN_SENT:
        if (action === "recv_syn_ack") {
          this.state = this.states.ESTABLISHED;
          this.ackNum = this.partnerNode.nextSeqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);

          if (this.pendingDataSize > 0) {
            this.transition("send_data", simulationId);
          } else {
            this.transition("close_connection", simulationId);
          }
        }
        break;

      case this.states.SYN_RECEIVED:
        if (action === "recv_ack") {
          this.state = this.states.ESTABLISHED;
          if (this.pendingDataSize > 0) {
            this.transition("send_data", simulationId);
          } else {
            this.transition("close_connection", simulationId);
          }
        }
        break;

      case this.states.ESTABLISHED:
        if (action === "send_data") {
          this.sendData(simulationId);
        } else if (action === "recv_data") {
          // Procesar datos recibidos
        } else if (action === "recv_fin") {
          this.state = this.states.CLOSE_WAIT;
          this.ackNum = this.partnerNode.nextSeqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);
          if (this.pendingDataSize === 0) {
            this.transition("close_connection", simulationId);
          }
        } else if (action === "close_connection") {
          if (!this.closing && this.pendingDataSize === 0) {
            this.closing = true;
            this.state = this.states.FIN_WAIT_1;
            let finMessage = new MessageTCP(this);
            finMessage.flags.FIN = true;
            this.sendMessage(finMessage, 0, simulationId);
            this.nextSeqNum += 1; // FIN consume seq
          } else if (this.pendingDataSize > 0) {
            // Aún quedan datos, no cerrar aún.
          }
        }
        break;

      case this.states.FIN_WAIT_1:
        if (action === "recv_ack") {
          this.state = this.states.FIN_WAIT_2;
        } else if (action === "recv_fin") {
          this.state = this.states.CLOSING;
          this.ackNum = this.partnerNode.nextSeqNum;
          let ackMessage = new MessageTCP(this);
          ackMessage.flags.ACK = true;
          this.sendMessage(ackMessage, 0, simulationId);
        }
        break;

      case this.states.FIN_WAIT_2:
        if (action === "recv_fin") {
          this.state = this.states.TIME_WAIT;
          this.ackNum = this.partnerNode.nextSeqNum;
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
          if (!this.closing && this.pendingDataSize === 0) {
            this.closing = true;
            this.state = this.states.LAST_ACK;
            let finMessage = new MessageTCP(this);
            finMessage.flags.FIN = true;
            this.sendMessage(finMessage, 0, simulationId);
            this.nextSeqNum += 1;
          }
        }
        break;

      case this.states.LAST_ACK:
        if (action === "recv_ack") {
          this.state = this.states.CLOSED;
        }
        break;

      case this.states.TIME_WAIT:
        // Espera a que termine TIME_WAIT
        break;

      default:
        break;
    }
  }

  setPartner(node) {
    this.partnerNode = node;
    this.destPort = node.srcPort;
  }

  sendData(simulationId) {
    if (this.pendingDataSize <= 0) {
      // No hay datos pendientes, intentar cerrar
      if (!this.closing) {
        this.transition("close_connection", simulationId);
      }
      return;
    }

    let dataSize = this.pendingDataSize;
    let availableWindow = this.partnerNode.windowSize - (this.nextSeqNum - this.sendBase);
    if (availableWindow <= 0) {
      console.log(`${this.nodeId}: Ventana llena, esperando ACK...`);
      return;
    }

    let toSend = Math.min(dataSize, availableWindow);
    while (toSend > 0 && this.pendingDataSize > 0) {
      let segmentSize = Math.min(toSend, this.MSS);
      let message = new MessageTCP(this);
      this.sendMessage(message, segmentSize, simulationId);
      this.nextSeqNum += segmentSize;
      this.pendingDataSize -= segmentSize;
      toSend -= segmentSize;
    }

    if (this.pendingDataSize === 0 && !this.closing && this.state === this.states.ESTABLISHED) {
      this.transition("close_connection", simulationId);
    }
  }

  sendMessage(message, dataSize, simulationId) {
    message.latency = this.latency;
    message.len = dataSize;
    this.saveMessage(message, dataSize, simulationId);

    setTimeout(() => {
      if (Math.random() < this.lossRatio) {
        console.log(`${this.nodeId}: Paquete perdido (seq=${message.seqNum})`);
        return;
      }

      if (this.partnerNode) {
        this.partnerNode.receiveMessage(message, simulationId);
      }
    }, this.latency);
  }

  receiveMessage(packet, simulationId) {
    if (packet.flags.SYN && !packet.flags.ACK) {
      this.state = this.states.SYN_RECEIVED;
      this.ackNum = packet.seqNum + 1;
      this.nextSeqNum = Math.floor(Math.random() * 10000);
      let response = new MessageTCP(this);
      response.flags.SYN = true;
      response.flags.ACK = true;
      this.sendMessage(response, 0, simulationId);
      this.nextSeqNum += 1; 
    } else if (packet.flags.SYN && packet.flags.ACK) {
      this.ackNum = packet.seqNum + 1;
      this.transition("recv_syn_ack", simulationId);
    } else if (packet.flags.ACK && !packet.flags.SYN && !packet.flags.FIN) {
      if (packet.ackNum > this.sendBase) {
        this.sendBase = packet.ackNum;
      }

      if (this.state === this.states.SYN_RECEIVED) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.FIN_WAIT_1) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.CLOSING) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.LAST_ACK) {
        this.transition("recv_ack", simulationId);
      } else if (this.state === this.states.ESTABLISHED && this.pendingDataSize > 0) {
        this.transition("send_data", simulationId);
      }
    } else if (packet.flags.FIN && !packet.flags.ACK) {
      if (
        this.state === this.states.ESTABLISHED ||
        this.state === this.states.FIN_WAIT_1 ||
        this.state === this.states.FIN_WAIT_2
      ) {
        this.transition("recv_fin", simulationId);
      }
    } else if (packet.flags.FIN && packet.flags.ACK) {
      if (this.state === this.states.FIN_WAIT_1) {
        this.state = this.states.CLOSING;
        this.ackNum = packet.seqNum + 1;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
      } else if (this.state === this.states.ESTABLISHED) {
        this.state = this.states.CLOSE_WAIT;
        this.ackNum = packet.seqNum + 1;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
        if (this.pendingDataSize === 0) {
          this.transition("close_connection", simulationId);
        }
      }
    } else if (!packet.flags.SYN && !packet.flags.ACK && !packet.flags.FIN) {
      // Datos
      if (this.state === this.states.ESTABLISHED) {
        this.ackNum = packet.seqNum + packet.len;
        let ackMessage = new MessageTCP(this);
        ackMessage.flags.ACK = true;
        this.sendMessage(ackMessage, 0, simulationId);
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
          // Mensaje guardado exitosamente.
        }
      }
    );
  }

  startSimulation(dataSize, simulationId) {
    this.state = this.states.CLOSED;
    this.seqNum = Math.floor(Math.random() * 10000);
    this.sendBase = this.seqNum;
    this.nextSeqNum = this.seqNum;
    this.ackNum = 0;
    this.closing = false;
    this.pendingDataSize = Number(dataSize) || 0;
    this.ackReceived = false;
    this.buffer = 0;

    this.transition("start_simulation", simulationId);
  }
}

module.exports = TCPNode;
