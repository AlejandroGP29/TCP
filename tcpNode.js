// tcpNode.js
const db = require("./db");

class MessageTCP {
  constructor(node) {
    this.srcPort = node.srcPort;
    this.destPort = node.partnerNode.srcPort;
    this.seqNum = node.seqNum;
    this.ackNum = node.partnerNode.seqNum;
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
        if (action === "listen") this.state = this.states.LISTEN;
        else if (action === "send_syn") {
          this.state = this.states.SYN_SENT;
          let message = new MessageTCP(this);
          message.flags.SYN = true;
          this.sendMessage(message, 1, simulationId);
        }
        break;

      case this.states.LISTEN:
        if (action === "send_syn") {
          this.state = this.states.SYN_SENT;
          let message = new MessageTCP(this);
          message.flags.SYN = true;
          this.sendMessage(message, 1, simulationId);
        } else if (action === "close") {
          this.state = this.states.CLOSED;
        }
        break;

      case this.states.SYN_SENT:
        if (action === "recv_syn_ack") {
          this.state = this.states.ESTABLISHED;
          let message = new MessageTCP(this);
          message.flags.ACK = true;
          this.sendMessage(message, 1, simulationId);
        } else if (action === "close") {
          this.state = this.states.CLOSED;
        }
        break;

      case this.states.ESTABLISHED:
        if (action === "close") {
          this.state = this.states.FIN_WAIT_1;
          let message = new MessageTCP(this);
          message.flags.FIN = true;
          this.sendMessage(message, 1, simulationId);
        }
        break;

      case this.states.FIN_WAIT_1:
        if (action === "recv_ack") {
          this.state = this.states.FIN_WAIT_2;
        }
        break;

      case this.states.FIN_WAIT_2:
        if (action === "recv_fin") {
          this.state = this.states.TIME_WAIT;
          let message = new MessageTCP(this);
          message.flags.ACK = true;
          this.sendMessage(message, 1, simulationId);
        }
        break;

      case this.states.TIME_WAIT:
        if (action === "timeout") {
          this.state = this.states.CLOSED;
        }
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
        dataSize -= segmentSize;
      }
    } else {
      let message = new MessageTCP(this);
      this.sendMessage(message, dataSize, simulationId);
    }
  }

  sendMessage(message, dataSize, simulationId) {
    this.seqNum += dataSize;
    message.seqNum = this.seqNum;
    message.latency = this.latency;
    this.saveMessage(message, dataSize, simulationId);

    setTimeout(() => {
      if (this.partnerNode) {
        this.partnerNode.receiveMessage(message, simulationId);
      }
    }, this.latency);
  }

  receiveMessage(packet, simulationId) {
    this.ackNum = packet.seqNum;
    if (packet.flags.SYN && packet.flags.ACK) {
      this.transition("recv_syn_ack", simulationId);
    } else if (packet.flags.ACK) {
      this.transition("recv_ack", simulationId);
    } else if (packet.flags.FIN) {
      this.transition("recv_fin", simulationId);
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
}

module.exports = TCPNode;
