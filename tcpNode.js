// tcpNode.js
const db = require("./db");

class messageTCP {
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
      PSH: false, // Se activará cuando sea necesario
      RST: false,
      SYN: false,
      FIN: false,
    };
    this.windowSize = node.windowSize;
    this.checksum = node.checksum;
    this.urgentPointer = 0;
    this.options = {
      MSS: 1460, // Tamaño MSS agregado aquí (Cambio #6)
    };
    this.padding = 0;
    this.message = "";
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
    this.latency = Math.floor(Math.random() * 5001);
    this.MTU = 1500; // Tamaño de MTU para controlar segmentación (Cambio #3)
  }

  setNodeParameter(parameterSettings){
    this.nodeId = parameterSettings.nodeId;
    this.states = parameterSettings.state;
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
  }


  transition(action, simulation_id) {
    switch (this.state) {
        case "CLOSED":
            if (action === "listen") this.state = "LISTEN";
            else if (action === "send_syn") {
              this.state = "SYN_SENT";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "LISTEN":
            if (action === "send_syn") {
              this.state = "SYN_SENT";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "recv_syn") {
              this.state = "SYN_RECEIVED";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "close") this.state = "CLOSED";
            break;

        case "SYN_SENT":
            if (action === "recv_syn_ack") {
              this.state = "ESTABLISHED";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "recv_syn") {
              this.state = "SYN_RECEIVED";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "close") this.state = "CLOSED";
            break;

        case "SYN_RECEIVED":
            if (action === "recv_ack") this.state = "ESTABLISHED";
            else if (action === "recv_rst") this.state = "LISTEN";
            else if (action === "close"){
              this.state = "FIN_WAIT_1";
              let message = new messageTCP(this)
              message.flags.FIN = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "ESTABLISHED":
            if (action === "close") {
              this.state = "FIN_WAIT_1";
              let message = new messageTCP(this)
              message.flags.FIN = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "recv_fin") {
              this.state = "CLOSE_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "FIN_WAIT_1":
            if (action === "recv_ack") this.state = "FIN_WAIT_2";
            else if (action === "recv_fin") {
              this.state = "CLOSING";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            else if (action === "recv_fin_ack") {
              this.state = "TIME_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "FIN_WAIT_2":
            if (action === "recv_fin") {
              this.state = "TIME_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "CLOSING":
            if (action === "recv_ack") this.state = "TIME_WAIT";
            break;

        case "CLOSE_WAIT":
            if (action === "send_fin") {
              this.state = "LAST_ACK";
              let message = new messageTCP(this)
              message.flags.FIN = true;
              this.sendMessage(message, 1, simulation_id);
            }
            break;

        case "LAST_ACK":
            if (action === "recv_ack") this.state = "CLOSED";
            break;

        case "TIME_WAIT":
            if (action === "timeout") this.state = "CLOSED";
            break;
    }
}


  setPartner(node) {
    this.partnerNode = node;
    this.destPort = node.srcPort;
  }

  sendData(size, simulation_id) {
    let datasize = Number(size);
    if (datasize > this.windowSize) {
      console.log("Datos exceden el tamaño de ventana, se segmentarán.");
      while (datasize > 0) {
        let segmentSize = Math.min(datasize, this.windowSize, this.MTU);
        this.buffer += segmentSize; // Agregar a buffer antes de enviar (para Nagle)

        // Si el buffer es suficiente para un segmento completo, envía
        if (this.buffer >= this.windowSize) {
          let message = new messageTCP(this);
          this.sendMessage(message, this.buffer, simulation_id);
          this.buffer = 0; // Limpia el buffer después de enviar
        }
        datasize -= segmentSize;
      }
    } else {
      let message = new messageTCP(this);
      this.sendMessage(message, datasize, simulation_id);
    }
  }


  sendMessage(message, dataSize, simulation_id) {
    this.seqNum += dataSize;
    this.saveMessage(message, simulation_id);
    //setTimeout(() => {
    //  if (!this.ackReceived) {
    //    console.log("Retransmitiendo datos debido a timeout...");
    //    this.sendMessage(message, dataSize, simulation_id); // Retransmite si no hay ACK
    //  }
    //}, this.latency + 10000);
    setTimeout(() => {
      if(this.state == this.states.TIME_WAIT) this.transition("timeout", simulation_id);
    }, Math.floor(Math.random() * 5001));
    setTimeout(() => {
      if (this.partnerNode) this.partnerNode.receiveMessage(message, simulation_id);
    }, this.latency);
  }

  receiveMessage(packet, simulation_id) {
    this.ackNum = packet.seqNum;
    if(packet.flags.SYN){
      if(packet.flags.ACK){
        this.transition("recv_syn_ack", simulation_id);
      }
      else{
        this.transition("recv_syn", simulation_id);
      }
    }
    else if(packet.flags.FIN){
      if(packet.flags.ACK){
        this.transition("recv_fin_ack", simulation_id);
      }
      else{
        this.transition("recv_fin", simulation_id);
      }
    }
    else if(packet.flags.ACK){
      this.ackReceived = true;
      this.transition("recv_ack", simulation_id);
    }
  }

  generateChecksum() {
    return (this.srcPort + this.destPort + this.seqNum + this.ackNum + this.windowSize + this.ttl) % 65535;
  }

  saveMessage(message, simulationId) {
    const query = `
    INSERT INTO MessageHistory (
      simulation_id, node_id, parameter_TCP, content
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
    };
  
    db.run(query, [
      simulationId,
      this.nodeId,
      JSON.stringify(parameters),
      message.message
    ], (err) => {
      if (err) {
        console.error("Error al guardar el mensaje:", err.message);
      } else {
        console.log("Mensaje guardado exitosamente.");
      }
    });
  }
}

module.exports = TCPNode;