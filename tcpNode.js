// tcpNode.js
const db = require("./db");

class messageTCP{
  constructor(node) {
    this.srcPort = node.srcPort; // Puerto de origen aleatorio
    this.destPort = node.partnerNode.srcPort; // Será asignado al asociar el nodo
    this.seqNum = node.seqNum; // Número de secuencia inicial aleatorio
    this.ackNum = node.partnerNode.seqNum;
    this.dataOffset = 5; // Tamaño en palabras de 32 bits (5 = 20 bytes estándar)
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
    this.windowSize = node.windowSize; // Tamaño de la ventana
    this.checksum = node.checksum;
    this.urgentPointer = 0;
    this.options = {}; // Opciones TCP, como MSS, escalado de ventana, SACK, etc.
    this.padding = 0; // Relleno opcional para alinear a múltiplos de 32 bits

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
      CLOSING:"CLOSING",
      TIME_WAIT: "TIME_WAIT",
    };
    this.state = this.states.CLOSED;
    this.partnerNode = null;

     // Parámetros TCP
     this.srcPort = Math.floor(Math.random() * 65535); // Puerto de origen aleatorio
     this.destPort = 0; // Será asignado al asociar el nodo
     this.seqNum = Math.floor(Math.random() * 10000); // Número de secuencia inicial aleatorio
     this.ackNum = 0;
     this.windowSize = 1024; // Tamaño de la ventana
     this.checksum = this.generateChecksum();
 
     // Parámetros adicionales de simulación
     this.buffer = 0; // Buffer simulado para datos entrantes
     this.dataToSend = 0; // Datos para enviar
     this.ttl = 64; // Time to live (valor predeterminado)
     this.latency = Math.floor(Math.random() * 5001);
     this.recv_data = false;
  }


  transition(action, userId) {
    switch (this.state) {
        case "CLOSED":
            if (action === "listen") this.state = "LISTEN";
            else if (action === "send_syn") {
              this.state = "SYN_SENT";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              this.sendMessage(message, 1, userId);
            }
            break;

        case "LISTEN":
            if (action === "send_syn") {
              this.state = "SYN_SENT";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              this.sendMessage(message, 1, userId);
            }
            else if (action === "recv_syn") {
              this.state = "SYN_RECEIVED";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
            }
            else if (action === "close") this.state = "CLOSED";
            break;

        case "SYN_SENT":
            if (action === "recv_syn_ack") {
              this.state = "ESTABLISHED";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
            }
            else if (action === "recv_syn") {
              this.state = "SYN_RECEIVED";
              let message = new messageTCP(this)
              message.flags.SYN = true;
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
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
              this.sendMessage(message, 1, userId);
            }
            break;

        case "ESTABLISHED":
            if (action === "close") {
              this.state = "FIN_WAIT_1";
              let message = new messageTCP(this)
              message.flags.FIN = true;
              this.sendMessage(message, 1, userId);
            }
            else if (action === "recv_fin") {
              this.state = "CLOSE_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
            }
            break;

        case "FIN_WAIT_1":
            if (action === "recv_ack") this.state = "FIN_WAIT_2";
            else if (action === "recv_fin") {
              this.state = "CLOSING";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
            }
            else if (action === "recv_fin_ack") {
              this.state = "TIME_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
            }
            break;

        case "FIN_WAIT_2":
            if (action === "recv_fin") {
              this.state = "TIME_WAIT";
              let message = new messageTCP(this)
              message.flags.ACK = true;
              this.sendMessage(message, 1, userId);
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
              this.sendMessage(message, 1, userId);
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

  sendData(size, user_id){
    let datasize = Number(size)
    let message = new messageTCP(this);
    this.sendMessage(message, datasize, user_id);
  }

  sendMessage(message, dataSize, userId) {
    this.saveMessage(message, userId);
    this.seqNum += dataSize;
    setTimeout(() => {
      if(this.state == this.states.TIME_WAIT) this.transition("timeout", userId);
    }, Math.floor(Math.random() * 5001));
    setTimeout(() => {
      if (this.partnerNode) this.partnerNode.receiveMessage(message, userId);
    }, this.latency);
  }

  receiveMessage(packet, userId) {
    if(packet.flags.SYN){
      if(packet.flags.ACK){
        this.transition("recv_syn_ack", userId);
      }
      else{
        this.transition("recv_syn", userId);
      }
    }
    else if(packet.flags.FIN){
      if(packet.flags.ACK){
        this.transition("recv_fin_ack", userId);
      }
      else{
        this.transition("recv_fin", userId);
      }
    }
    else if(packet.flags.ACK){
      this.transition("recv_ack", userId);
    }
    this.ackNum = packet.seqNum;
    this.recv_data = true;
  }

  generateChecksum() {
    return (this.srcPort + this.destPort + this.seqNum + this.ackNum + this.windowSize + this.ttl) % 65535;
  }

  saveMessage(message, userId) {
    const query = `
      INSERT INTO TransferHistory (
        node_id, seq_num, ack_num, data_size, message, src_port, dest_port, ttl, flags, 
        checksum, user_id, data_offset, reserved, urgent_pointer, options, padding, 
        window_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
  
    db.run(query, [
      this.nodeId,
      message.seqNum,
      message.ackNum,
      message.dataOffset,  // Tamaño de la data offset
      message.message,
      message.srcPort,
      message.destPort,
      message.ttl,
      JSON.stringify(message.flags),
      message.checksum,
      userId,
      message.dataOffset,
      message.reserved,
      message.urgentPointer,
      JSON.stringify(message.options),  // Convertir opciones a JSON
      message.padding,
      message.windowSize
    ], (err) => {
      if (err) console.error("Error al guardar el mensaje:", err.message);
    });
  }
}

module.exports = TCPNode;