// tcpNode.js

const db = require("./db");

/********************************/
/*         SACKScoreboard       */
/********************************/
class SACKScoreboard {
  constructor() {
    this.sackedBlocks = [];
  }

  updateSACKBlocks(newBlocks) {
    for (let [start, end] of newBlocks) {
      this._mergeBlock(start, end);
    }
  }

  isRangeSacked(seqStart, seqEnd) {
    for (let [sackStart, sackEnd] of this.sackedBlocks) {
      if (sackStart <= seqStart && sackEnd >= seqEnd) {
        return true;
      }
    }
    return false;
  }

  _mergeBlock(start, end) {
    if (this.sackedBlocks.length === 0) {
      this.sackedBlocks.push([start, end]);
      return;
    }
    let merged = [];
    let inserted = false;
    for (let [sS, sE] of this.sackedBlocks) {
      if (end < sS - 1) {
        if (!inserted) {
          merged.push([start, end]);
          inserted = true;
        }
        merged.push([sS, sE]);
      } else if (start > sE + 1) {
        merged.push([sS, sE]);
      } else {
        start = Math.min(start, sS);
        end = Math.max(end, sE);
      }
    }
    if (!inserted) {
      merged.push([start, end]);
    }
    merged.sort((a, b) => a[0] - b[0]);
    this.sackedBlocks = merged;
  }
}

/********************************/
/*           MessageTCP         */
/********************************/
class MessageTCP {
  constructor(params) {
    this.srcPort = params.srcPort;
    this.destPort = params.destPort;
    this.seqNum = params.seqNum;
    this.ackNum = params.ackNum;
    this.windowSize = params.windowSize;
    this.ttl = params.ttl;
    this.options = {
      MSS: params.MSS,
      ipVersion: params.ipVersion,
    };

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
    this.urgentPointer = 0;
    this.padding = 0;
    this.message = "";
    this.latency = params.latency;
    this.len = 0;
    this.srcNodeId = null;

    this.checksum = this._generateChecksumFromMessage();
  }

  _generateChecksumFromMessage() {
    let mssVal = typeof this.options.MSS === "number" ? this.options.MSS : 1460;
    let ipVersion = typeof this.options.ipVersion === "number" ? this.options.ipVersion : 4;

    let baseSum =
      (this.srcPort +
        this.destPort +
        this.seqNum +
        this.ackNum +
        this.windowSize +
        this.ttl +
        mssVal) %
      65535;

    if (ipVersion === 6) {
      baseSum = (baseSum + 12345) % 65535;
    }
    return baseSum;
  }
}

/********************************/
/*            TCPNode           */
/********************************/
class TCPNode {
  /**
   * @param {string} nodeId - "A" o "B"
   * @param {number} userId - ID de usuario (dueño de la simulación). Puede ser null si no quieres persistir en DB.
   */
  constructor(nodeId, userId) {
    this.nodeId = nodeId;
    this.userId = userId || null;

    // Estados TCP
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

    // Puertos efímeros
    const ephemeralPortStart = 49152;
    const ephemeralPortEnd = 65535;
    this.srcPort =
      Math.floor(Math.random() * (ephemeralPortEnd - ephemeralPortStart + 1)) +
      ephemeralPortStart;
    this.destPort = 0;

    // Variables TCP
    this.seqNum = Math.floor(Math.random() * 10000);
    this.ackNum = 0;     // Lo que reconocemos del peer
    this.windowSize = 1024;
    this.ttl = 64;
    this.latency = Math.floor(Math.random() * 500) + 100;
    this.MTU = 1500;
    this.MSS = 1460;     // Por defecto, ajustable
    this.peerMSS = 1460; // Se ajusta al recibir SYN con MSS
    this.DataSize = 0;

    this.handshakeLossRatio = 0; // Probabilidad de pérdida de SYN / SYN+ACK / ACK handshake
    this.lossRatio = 0.0;       // Probabilidad de pérdida en data
    this.ackReceived = false;
    this.pendingDataSize = 0;
    this.MSL = 3000; //30000
    this.timeWaitDuration = 2 * this.MSL;
    this.appCloseDelay = 0;
    this.closing = false;
    this.sendBase = this.seqNum;
    this.nextSeqNum = this.seqNum;
    this.buffer = 0;

    // Congestion
    this.cwnd = this.MSS;
    this.ssthresh = 64 * this.MSS;
    this.congestionControl = "reno";

    // SACK scoreboard
    this.sackScoreboard = new SACKScoreboard();

    // RTO / RTT
    this.SRTT = null;
    this.RTTVAR = null;
    this.RTO = 3000;
    this.minRTO = 1000;
    this.maxRTO = 60000;
    this.alpha = 1 / 8;
    this.beta = 1 / 4;

    this.outstandingSegments = new Map();
    this.rcv_next = 0; // Para datos del peer
    this.rcv_wnd = this.windowSize;
    this.outOfOrderBuffer = new Map();
    this.duplicateAckCount = 0;
    this.fastRecovery = false;
    this.initialSeqNum = this.seqNum;
    this.initialRemoteSeqNum = null;
    this.iss = this.seqNum; // Initial Send Sequence
    this.irs = null;        // Initial Receive Sequence

    this.persistTimerId = null;
    this.persistTimeout = 1000;

    // Keep-alive
    this.keepAliveEnabled = true;
    this.keepAliveInterval = 7200000; // 2h
    this.keepAliveTimerId = null;

    // Nagle
    this.useNagle = true;
    this.nagleTimerId = null;

    // Delayed ACK
    this.delayedAckEnabled = true;
    this.delayedAckTimeout = 200;
    this.delayedAckTimerId = null;
    this.delayedAckSegments = 0;

    // Timestamps
    this.timestampsEnabled = true;
    this.peerTimestampsEnabled = false;
    this.lastTSvalSent = 0;
    this.lastTSvalReceived = 0;
    this.lastTSReply = 0;

    // Window Scaling
    this.windowScalingEnabled = true;
    this.windowScalingShift = 3;
    this.peerWindowScalingShift = 0;

    // SACK, ECN
    this.sackEnabled = true;
    this.ecnEnabled = true;
    this.ecnActive = false;

    this.lastCongestionEventTime = Date.now();
    this.lastMaxCwnd = this.ssthresh * 2;

    // Syn Cookies
    this.useSynCookies = true;
    this.securityEnabled = true;
    this.sharedKey = "somekey";

    // Pacing
    this.pacingEnabled = true;
    this.pacingInterval = 10;
    this.pacingTimerId = null;
    this.pacingQueue = [];

    this.ipVersion = 4;
    this.srcAddr = null;
    this.dstAddr = null;
    this.receivedUnexpectedSegments = 0;
    this.checksum = this.generateChecksum();

    // Timers handshake
    this.synTimerId = null;
    this.synRetries = 0;
    this.maxSynRetries = 5;
    this.synAckTimerId = null;
    this.synAckRetries = 0;
    this.maxSynAckRetries = 5;

    this.timeoutCount = 0;

    // Tiempo de simulación
    this.simTime = 0;
    this.timestampMap = new Map();

    // Cierre
    this.closeRequested = false;
    this.finSeq = null;
  }

  /**********************************/
  /*   Persistencia de parámetros   */
  /**********************************/
  async _persistParameters(simulationId) {
    if (!this.partnerNode) {
      this._log(`No partnerNode definido, no se guardan parámetros.`);
      return;
    }
    if (!this.userId) {
      this._log(`No userId disponible, no se guardan parámetros (falta userId).`);
      return;
    }
    try {
      const myParams = this.getParameters();
      const partnerParams = this.partnerNode.getParameters();

      let nodeA, nodeB;
      if (this.nodeId === "A") {
        nodeA = myParams;
        nodeB = partnerParams;
      } else {
        nodeA = partnerParams;
        nodeB = myParams;
      }

      const parameter_settings = JSON.stringify({ nodeA, nodeB });
      const sql = `
        UPDATE Simulations
        SET parameter_settings = ?
        WHERE id = ? AND user_id = ?
      `;
      await db.runAsync(sql, [parameter_settings, simulationId, this.userId]);
      this._log(
        `Se han persistido parámetros en la BD (simId=${simulationId}, userId=${this.userId}).`
      );
    } catch (err) {
      this._log(`Error al persistir parámetros: ${err.message}`);
    }
  }

  /**********************************/
  /*        setNodeParameter        */
  /**********************************/
  setNodeParameter(param) {
    if (!param || typeof param !== "object") return;
    if (param.state !== undefined) this.state = param.state;
    if (param.windowSize !== undefined) this.windowSize = param.windowSize;
    if (param.lossRatio !== undefined) this.lossRatio = param.lossRatio;
    if (param.MSS !== undefined) this.MSS = param.MSS;
    if (param.seqNum !== undefined) this.seqNum = param.seqNum;
    if (param.ackNum !== undefined) this.ackNum = param.ackNum;
    if (param.initialSeqNum !== undefined) this.initialSeqNum = param.initialSeqNum;
    if (param.latency !== undefined) this.latency = param.latency;
    if (param.cwnd !== undefined) this.cwnd = param.cwnd;
    if (param.ssthresh !== undefined) this.ssthresh = param.ssthresh;
    if (param.sendBase !== undefined) this.sendBase = param.sendBase;
    if (param.nextSeqNum !== undefined) this.nextSeqNum = param.nextSeqNum;
    if (param.srcPort !== undefined) this.srcPort = param.srcPort;
    if (param.destPort !== undefined) this.destPort = param.destPort;
    if (param.dataSize !== undefined) this.dataSize = param.dataSize;
  }

  /**********************************/
  /*         getParameters          */
  /**********************************/
  getParameters() {
    return {
      nodeId: this.nodeId,
      state: this.state,
      seqNum: this.seqNum,
      ackNum: this.ackNum,
      windowSize: this.windowSize,
      latency: this.latency,
      MSS: this.MSS,
      lossRatio: this.lossRatio,
      cwnd: this.cwnd,
      ssthresh: this.ssthresh,
      initialSeqNum: this.initialSeqNum,
      sendBase: this.sendBase,
      nextSeqNum: this.nextSeqNum,
      srcPort: this.srcPort,
      destPort: this.destPort,
      dataSize: this.dataSize,
    };
  }

  /**********************************/
  /*         métodos util           */
  /**********************************/
  _log(msg) {
    console.log(`[Node ${this.nodeId}] ${msg}`);
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

  _getSimTime() {
    return this.simTime;
  }

  _advanceSimTime(ms) {
    this.simTime += ms;
  }

  _validateSignature(packet, sharedKey) {
    if (!packet.options || !packet.options.MD5Sig) {
      return false;
    }
    return packet.options.MD5Sig === "md5fake";
  }

  /**********************************/
  /*        Manejo de Timers        */
  /**********************************/
  _cleanupTimers() {
    if (this.keepAliveTimerId) {
      clearTimeout(this.keepAliveTimerId);
      this.keepAliveTimerId = null;
    }
    if (this.nagleTimerId) {
      clearTimeout(this.nagleTimerId);
      this.nagleTimerId = null;
    }
    if (this.pacingTimerId) {
      clearInterval(this.pacingTimerId);
      this.pacingTimerId = null;
    }
    if (this.delayedAckTimerId) {
      clearTimeout(this.delayedAckTimerId);
      this.delayedAckTimerId = null;
      this.delayedAckSegments = 0;
    }
    if (this.synTimerId) {
      clearTimeout(this.synTimerId);
      this.synTimerId = null;
    }
    if (this.synAckTimerId) {
      clearTimeout(this.synAckTimerId);
      this.synAckTimerId = null;
    }
    if (this.persistTimerId) {
      clearTimeout(this.persistTimerId);
      this.persistTimerId = null;
    }
    if (this._timeWaitTimerId) {
      clearTimeout(this._timeWaitTimerId);
      this._timeWaitTimerId = null;
    }

    for (let [seqNum, segInfo] of this.outstandingSegments) {
      clearTimeout(segInfo.timerId);
    }
    this.outstandingSegments.clear();

    this._log(`Timers limpiados en _cleanupTimers()`);
  }

  setPartner(node) {
    this._log(`Asociando partnerNode: ${node.nodeId}`);
    this.partnerNode = node;
    this.destPort = node.srcPort;
  }

  /**********************************/
  /*        transition(...)         */
  /**********************************/
  transition(action, simulationId) {
    this._log(`Transición con acción: ${action} (estado actual: ${this.state})`);
    const prevState = this.state;

    switch (this.state) {
      case this.states.CLOSED:
        this._handleClosed(action, simulationId);
        break;
      case this.states.LISTEN:
        this._handleListen(action, simulationId);
        break;
      case this.states.SYN_SENT:
        this._handleSynSent(action, simulationId);
        break;
      case this.states.SYN_RECEIVED:
        this._handleSynReceived(action, simulationId);
        break;
      case this.states.ESTABLISHED:
        this._handleEstablished(action, simulationId);
        break;
      case this.states.FIN_WAIT_1:
        this._handleFinWait1(action, simulationId);
        break;
      case this.states.FIN_WAIT_2:
        this._handleFinWait2(action, simulationId);
        break;
      case this.states.CLOSE_WAIT:
        this._handleCloseWait(action, simulationId);
        break;
      case this.states.LAST_ACK:
        this._handleLastAck(action, simulationId);
        break;
      case this.states.CLOSING:
        this._handleClosing(action, simulationId);
        break;
      case this.states.TIME_WAIT:
        this._handleTimeWait(action, simulationId);
        break;
      default:
        break;
    }

    if (this.state !== prevState) {
      this._log(`Estado cambiado: ${prevState} -> ${this.state}`);
      if (this.state === this.states.CLOSED) {
        this._cleanupTimers();
      }
    }
  }

  /**********************************/
  /*  Manejo de la FSM de TCP       */
  /**********************************/
  _handleClosed(action, simulationId) {
    if (action === "start_simulation") {
      if (this.nodeId === "A") {
        this._log(`Preparando para enviar SYN: iss=${this.iss}, seqNum=${this.seqNum}`);
        this.state = this.states.SYN_SENT;

        let flags = { SYN: true };
        let options = { MSS: this.MSS, ipVersion: this.ipVersion };
        if (this.windowScalingEnabled) {
          options.WScale = this.windowScalingShift;
        }
        if (this.timestampsEnabled) {
          this.lastTSvalSent = this._getSimTime();
          options.TSval = this.lastTSvalSent;
          options.TSecr = 0;
        }
        if (this.ecnEnabled) {
          flags.ECE = true;
          flags.CWR = true;
        }

        // ackNum = this.ackNum (normalmente 0 si no hemos recibido nada)
        const params = this._createMessageParameters(
          this.seqNum,
          this.ackNum,
          0,
          flags,
          options
        );
        const synMessage = this._buildMessage(params);
        this._log(
          `Enviando SYN (seq=${synMessage.seqNum}, MSS=${this.MSS}, WScale=${this.windowScalingShift}, ECN)`
        );
        this.sendMessage(synMessage, 0, simulationId).catch((err) =>
          this._log("Error en sendMessage: " + err.message)
        );
        this.nextSeqNum += 1; // Consumimos 1 seq para el SYN

        this._startSynRetransmitTimer(simulationId);
      } else if (this.nodeId === "B") {
        this._log(`Esperando conexión entrante en LISTEN`);
        this.state = this.states.LISTEN;
      }
    }
  }

  _handleListen(action, simulationId) {
    // LISTEN sin lógica adicional
  }

  _handleSynSent(action, simulationId) {
    if (action === "recv_syn_ack") {
      this._log(
        `En _handleSynSent: Recibido evento recv_syn_ack. ackNum=${this.ackNum}, iss+1=${this.iss + 1}`
      );
      if (this.ackNum !== this.iss + 1) {
        this._log(`ACK no válido en SYN_SENT (no coincide con iss+1)`);
        return;
      }
      this._log(`Recibido SYN+ACK válido, estableciendo conexión`);
      this.state = this.states.ESTABLISHED;
      this.rcv_next = this.irs + 1;
      this.sendBase = this.iss + 1;
      this.nextSeqNum = this.iss + 1;
      // seqNum local para el ACK final
      this.seqNum = this.iss + 1;
      this.ackNum = this.irs + 1
      if (this.synTimerId) {
        clearTimeout(this.synTimerId);
        this.synTimerId = null;
      }
      // Enviamos ACK final
      this._sendAck(simulationId, this.ackNum);

      this._scheduleDataOrClose(simulationId);
    }
  }

  _handleSynReceived(action, simulationId) {
    if (action === "recv_ack") {
      this._log(
        `En _handleSynReceived: Recibido ACK final del handshake. ackNum=${this.ackNum}, iss+1=${this.iss + 1}`
      );
      if (this.ackNum !== this.irs + 1) {
        this._log(`ACK final del handshake no válido (no coincide con irs+1)`);
        return;
      }
      this._log(`Recibido ACK final del handshake, estableciendo conexión`);
      this.state = this.states.ESTABLISHED;
      this.rcv_next = this.irs + 1;
      this.sendBase = this.iss + 1;
      this.nextSeqNum = this.iss + 1;
      this.seqNum = this.iss + 1;

      if (this.synAckTimerId) {
        clearTimeout(this.synAckTimerId);
        this.synAckTimerId = null;
        this.synAckRetries = 0;
      }
      this._scheduleDataOrClose(simulationId);
    }
  }

  _handleEstablished(action, simulationId) {
    if (action === "send_data") {
      this._log(`Intentando enviar datos...`);
      this.trySendOneSegment(simulationId);
    } else if (action === "recv_data") {
      this._log(`Datos recibidos en ESTABLISHED`);
    } else if (action === "recv_fin") {
      this._log(`Recibido FIN del partner, cerrando hacia CLOSE_WAIT`);
      this.state = this.states.CLOSE_WAIT;
      //this._scheduleDataOrClose(simulationId);
    } else if (action === "close_connection") {
      this.closeRequested = true;
      this._checkIfCanClose(simulationId);
    }
  }

  _handleFinWait1(action, simulationId) {
    if (action === "recv_ack") {
      if (this.confirmAck === this.finSeq + 1) {
        this._log(`Recibido ACK de nuestro FIN, pasando a FIN_WAIT_2`);
        this.state = this.states.FIN_WAIT_2;
      } else {
        this._log(
          `ACK en FIN_WAIT_1 no es el de nuestro FIN (ackNum=${this.confirmAck}, finSeq+1=${this.finSeq+1}), ignorando`
        );
      }
    } else if (action === "recv_fin") {
      this._log(`Recibido FIN mientras en FIN_WAIT_1, pasando a CLOSING`);
      this.state = this.states.CLOSING;
    }
  }

  _handleFinWait2(action, simulationId) {
    if (action === "recv_fin") {
      this._log(`Recibido FIN mientras en FIN_WAIT_2, pasando a TIME_WAIT`);
      this.state = this.states.TIME_WAIT;
      this._startTimeWaitTimer(simulationId);
    }
  }

  _handleCloseWait(action, simulationId) {
    if (action === "send_data") {
      this._log(`Enviando datos en CLOSE_WAIT`);
      this.trySendOneSegment(simulationId);
      if (this.pendingDataSize === 0 && !this.closing) {
        this._scheduleClose(simulationId);
      }
    } else if (action === "close_connection") {
      this.closeRequested = true;
      this._checkIfCanClose(simulationId);
    }
  }

  _handleLastAck(action, simulationId) {
    if (action === "recv_ack") {
      if (this.confirmAck === this.finSeq + 1) {
        this._log(`Recibido ACK válido en LAST_ACK, conexión cerrada`);
        this.state = this.states.CLOSED;
      } else if (this.confirmAck < this.finSeq + 1) {
        this._log(
          `ACK en LAST_ACK con ackNum=${this.confirmAck} < finSeq+1=${this.finSeq+1}. Es un ACK rezagado (no es para el FIN).`
        );
      } else {
        this._log(
          `ACK en LAST_ACK mayor a finSeq+1 (ackNum=${this.confirmAck}, finSeq+1=${this.finSeq+1}). Ignorando.`
        );
      }
    }
  }

  _handleClosing(action, simulationId) {
    if (action === "recv_ack") {
      this._log(`Recibido ACK en CLOSING, pasando a TIME_WAIT`);
      this.state = this.states.TIME_WAIT;
      this._startTimeWaitTimer(simulationId);
    }
  }

  _handleTimeWait(action, simulationId) {
    // sin lógica adicional
  }

  /**********************************/
  /*   Revisión si se puede cerrar  */
  /**********************************/
  _checkIfCanClose(simulationId) {
    if (!this.closeRequested) return;
    if (this.pendingDataSize > 0) {
      this._log(`_checkIfCanClose: Aún hay datos pendientes (${this.pendingDataSize} bytes)`);
      return;
    }
    if (this.sendBase !== this.nextSeqNum) {
      this._log(
        `_checkIfCanClose: Falta ACK de algunos datos (sendBase=${this.sendBase}, nextSeqNum=${this.nextSeqNum})`
      );
      return;
    }
    if (this.state === this.states.ESTABLISHED) {
      this._log(`_checkIfCanClose: Todo ack. Cerrando desde ESTABLISHED -> FIN_WAIT_1`);
      this.closing = true;
      this.state = this.states.FIN_WAIT_1;
      this.seqNum = this.nextSeqNum;

      this.finSeq = this.seqNum;

      let flags = { FIN: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }
      const params = this._createMessageParameters(this.seqNum, this.ackNum, 0, flags, options);
      const finMessage = this._buildMessage(params);
      this._log(`Enviando FIN (seq=${finMessage.seqNum})`);
      this.sendMessage(finMessage, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(FIN est->finWait1): " + err.message)
      );
      this.nextSeqNum += 1;
      this.seqNum = this.nextSeqNum
    } else if (this.state === this.states.CLOSE_WAIT) {
      this._log(`_checkIfCanClose: Todo ack. Cerrando desde CLOSE_WAIT -> LAST_ACK`);
      this.closing = true;
      this.state = this.states.LAST_ACK;
      this.seqNum = this.nextSeqNum;

      this.finSeq = this.seqNum;

      let flags = { FIN: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }
      const params = this._createMessageParameters(this.seqNum, this.ackNum, 0, flags, options);
      const finMessage = this._buildMessage(params);
      this._log(`Enviando FIN (seq=${finMessage.seqNum})`);
      this.sendMessage(finMessage, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(FIN closeWait->lastAck): " + err.message)
      );
      this.nextSeqNum += 1;
      this.seqNum = this.nextSeqNum
    }
  }

  /**********************************/
  /*      TIME_WAIT timer y cleanup */
  /**********************************/
  _startTimeWaitTimer(simulationId) {
    this._log(`Entrando en TIME_WAIT por ${this.timeWaitDuration}ms`);
    for (let [seqNum, segInfo] of this.outstandingSegments) {
      clearTimeout(segInfo.timerId);
    }
    this.outstandingSegments.clear();

    clearTimeout(this._timeWaitTimerId);
    this._timeWaitTimerId = setTimeout(() => {
      this._log(`Expiró TIME_WAIT, cerrando conexión`);
      this.state = this.states.CLOSED;
      this._cleanupTimers();
    }, this.timeWaitDuration);
  }

  /**********************************/
  /*    Construcción de mensajes    */
  /**********************************/
  _createMessageParameters(seqNum, ackNum, len = 0, flags = {}, options = {}) {
    return {
      srcPort: this.srcPort,
      destPort: this.destPort,
      seqNum: seqNum,
      ackNum: ackNum, // ESTE es el ack a lo que conocemos del peer
      windowSize: this._announceWindowSize(),
      ttl: this.ttl,
      MSS: this.MSS,
      ipVersion: this.ipVersion,
      latency: this.latency,
      flags: Object.assign({}, flags),
      options: Object.assign({}, options),
      len: len,
    };
  }

  _buildMessage(params) {
    let msg = new MessageTCP(params);
    msg.flags = params.flags;
    msg.len = params.len;
    for (let k in params.options) {
      msg.options[k] = params.options[k];
    }
    return msg;
  }

  _announceWindowSize() {
    let announced = this.windowSize;
    if (this.windowScalingEnabled) {
      announced >>= this.windowScalingShift;
    }
    return announced;
  }

  /**********************************/
  /*          Enviar ACK            */
  /**********************************/
  _sendAck(simulationId, ackNum) {
    if (this.delayedAckTimerId) {
      clearTimeout(this.delayedAckTimerId);
      this.delayedAckTimerId = null;
      this.delayedAckSegments = 0;
    }
    this.ackNum = ackNum
    let ackSeq = this.nextSeqNum; // Nuestro seq
    let flags = { ACK: true };
    let options = { MSS: this.MSS, ipVersion: this.ipVersion };

    if (this.timestampsEnabled) {
      this.lastTSvalSent = this._getSimTime();
      options.TSval = this.lastTSvalSent;
      options.TSecr = this.lastTSReply;
    }
    if (this.sackEnabled) {
      options.SACK = this._buildSACKBlocks();
    }

    const params = this._createMessageParameters(ackSeq, ackNum, 0, flags, options);
    const ackMessage = this._buildMessage(params);
    this._log(`Enviando ACK (ackNum=${ackNum}) (seq=${ackSeq})`);
    this.sendMessage(ackMessage, 0, simulationId).catch((err) =>
      this._log("Error en sendMessage(ACK): " + err.message)
    );
  }

  _buildSACKBlocks() {
    let blocks = [];
    let keys = Array.from(this.outOfOrderBuffer.keys()).sort((a, b) => a - b);
    for (let k of keys) {
      let seg = this.outOfOrderBuffer.get(k);
      if (!seg) continue;
      let start = seg.seqNum;
      let end = seg.seqNum + seg.len - 1;
      blocks.push([start, end]);
    }
    return blocks;
  }

  /**********************************/
  /*     Método principal envío     */
  /**********************************/
  async sendMessage(message, dataSize, simulationId) {
    message.len = dataSize;
    message.srcNodeId = this.nodeId;

    if (this.timestampsEnabled) {
      this.timestampMap.set(message.seqNum, message.options.TSval);
    }

    // Determina si es handshake
    const isHandshakePacket =
      (message.flags.SYN && !message.flags.ACK) ||
      (message.flags.SYN && message.flags.ACK) ||
      (message.flags.ACK &&
        message.len === 0 &&
        !message.flags.SYN &&
        !message.flags.FIN &&
        (message.ackNum === this.iss + 1 || this.state === this.states.SYN_SENT));

    let effectiveLossRatio = isHandshakePacket ? this.handshakeLossRatio : this.lossRatio;
    const isLost = Math.random() < effectiveLossRatio;

    // 1) Guardar en DB
    await this.saveMessage(message, dataSize, simulationId, this.nodeId, isLost);

    // 2) Entrega si no se pierde
    if (!isLost) {
      this._advanceSimTime(this.latency);
      setTimeout(() => {
        if (this.partnerNode) {
          this.partnerNode.receiveMessage(message, simulationId);
        } else {
          this._log(
            `No partnerNode definido, no se puede entregar (seq=${message.seqNum}).`
          );
        }
      }, this.latency);
    } else {
      this._log(
        `Paquete (seq=${message.seqNum}) PERDIDO (handshake? ${isHandshakePacket}). No se entrega.`
      );
    }

    // 3) Timer de retransmisión si FIN o data
    const needsTimer =
      !message.flags.SYN && !message.flags.RST && (dataSize > 0 || message.flags.FIN);
    if (needsTimer) {
      let endSeqNum = message.seqNum + dataSize;
      const timerId = setTimeout(() => {
        this._handleRetransmission(message.seqNum, simulationId);
      }, this.RTO);

      const originalParams = {
        srcPort: message.srcPort,
        destPort: message.destPort,
        seqNum: message.seqNum,
        ackNum: message.ackNum,
        windowSize: message.windowSize,
        ttl: message.ttl,
        MSS: message.options.MSS,
        ipVersion: message.options.ipVersion,
        latency: message.latency,
        flags: Object.assign({}, message.flags),
        options: JSON.parse(JSON.stringify(message.options)),
        len: dataSize,
      };

      this.outstandingSegments.set(message.seqNum, {
        message: message,
        endSeqNum,
        timerId,
        sendTime: Date.now(),
        retransmitted: false,
        sentTSval: this.timestampsEnabled ? message.options.TSval : null,
        originalParams,
      });
    }

    // 4) Persistir parámetros
    await this._persistParameters(simulationId);
  }

  /**********************************/
  /*         receiveMessage         */
  /**********************************/
  receiveMessage(packet, simulationId) {
    this._advanceSimTime(this.latency);

    this._log(
      `Recibido mensaje seq=${packet.seqNum}, ack=${packet.ackNum}, RST=${packet.flags.RST}, SYN=${packet.flags.SYN}, ACK=${packet.flags.ACK}, FIN=${packet.flags.FIN}, len=${packet.len}`
    );

    if (!this._verifyChecksum(packet)) {
      this._log(`Checksum inválido, descartando.`);
      return;
    }
    if (
      this.securityEnabled &&
      packet.options?.MD5Sig &&
      !this._validateSignature(packet, this.sharedKey)
    ) {
      this._log(`Firma MD5 no válida, descartando`);
      return;
    }

    if ((this.state === this.states.CLOSED || this.state === this.states.LISTEN) && !packet.flags.SYN) {
      this._log(`Recibido segmento en estado ${this.state} sin SYN, enviando RST`);
      this.seqNum = this.nextSeqNum;
      let flags = { RST: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      const params = this._createMessageParameters(this.seqNum, this.ackNum, 0, flags, options);
      const rstMessage = this._buildMessage(params);
      this.sendMessage(rstMessage, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(RST): " + err.message)
      );
      return;
    }

    if (packet.flags.RST) {
      this._log(`Recibido RST, cerrando conexión.`);
      this.state = this.states.CLOSED;
      this._cleanupTimers();
      return;
    }

    if (this.state === this.states.TIME_WAIT && packet.flags.FIN) {
      this._log(`Recibido FIN en TIME_WAIT, reenviando ACK`);
      this.ackNum = packet.seqNum + packet.len + 1;
      this._sendAck(simulationId, this.ackNum);
      this._startTimeWaitTimer(simulationId);
      return;
    }

    // Manejo SYN
    if (packet.flags.SYN && !packet.flags.ACK) {
      this._log(`Recibido SYN, respondiendo con SYN+ACK`);
      this.state = this.states.SYN_RECEIVED;
      this.irs = packet.seqNum;
      // Actualizar ackNum al SYN entrante
      this.ackNum = packet.seqNum + 1;
      //this.nextSeqNum = Math.floor(Math.random() * 10000);
      this.iss = this.nextSeqNum;

      if (packet.options?.MSS && packet.options.MSS < this.peerMSS) {
        this.peerMSS = packet.options.MSS;
        this._log(`Ajustando peerMSS a ${this.peerMSS}`);
      }
      if (packet.options?.WScale !== undefined) {
        this.peerWindowScalingShift = packet.options.WScale;
        this._log(`Ventana escalada peer shift=${this.peerWindowScalingShift}`);
      }
      if (
        packet.options?.TSval !== undefined &&
        packet.options?.TSecr !== undefined
      ) {
        this.peerTimestampsEnabled = true;
        this.lastTSvalReceived = packet.options.TSval;
        this.lastTSReply = packet.options.TSval;
        this._log(`Peer soporta timestamps`);
      }
      if (packet.flags.ECE && packet.flags.CWR) {
        this.ecnActive = true;
        this._log(`ECN activo con el peer`);
      }

      this.seqNum = this.nextSeqNum;
      let flags = { SYN: true, ACK: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      if (this.ecnActive) {
        flags.ECE = true;
        flags.CWR = true;
      }
      if (this.windowScalingEnabled) options.WScale = this.windowScalingShift;
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }

      const params = this._createMessageParameters(
        this.seqNum,
        this.ackNum,
        0,
        flags,
        options
      );
      const response = this._buildMessage(params);
      this.sendMessage(response, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(SYN+ACK): " + err.message)
      );
      this.nextSeqNum += 1;

      this._startSynAckRetransmitTimer(simulationId);
      return;
    }

    // SYN+ACK
    if (packet.flags.SYN && packet.flags.ACK && !packet.flags.FIN && !packet.flags.RST) {
      this._log(`Recibido SYN+ACK, enviando ACK final de handshake`);
      this._log(
        `Valor esperado ackNum=iss+1=${this.iss + 1}, recibido ackNum=${packet.ackNum}`
      );
      if (packet.ackNum !== this.iss + 1) {
        this._log(`SYN+ACK no válido en cliente (no reconoce iss+1)`);
        return;
      }
      this.irs = packet.seqNum;
      // ackNum = peerSeq+1
      this.ackNum = this.iss + 1;

      if (this.state === this.states.SYN_SENT) {
        this.transition("recv_syn_ack", simulationId);
      } else if (this.state === this.states.ESTABLISHED) {
        this._log(`Ya en ESTABLISHED, reenviando ACK final (posible pérdida de ACK)`);
        this._sendAck(simulationId, this.irs + 1);
      }
      return;
    }

    // ACK final en servidor
    if (
      this.state === this.states.SYN_RECEIVED &&
      packet.flags.ACK &&
      !packet.flags.SYN &&
      !packet.flags.FIN &&
      !packet.flags.RST
    ) {
      if (packet.ackNum === this.iss + 1) {
        this.confirmAck = packet.ackNum;
        this.transition("recv_ack", simulationId);
        return;
      }
    }

    // SACK
    if (this.sackEnabled && packet.options?.SACK) {
      this._log(`Recibidos SACK blocks: ${JSON.stringify(packet.options.SACK)}`);
      if (Array.isArray(packet.options.SACK) && packet.options.SACK.length > 0) {
        this.sackScoreboard.updateSACKBlocks(packet.options.SACK);
        this._log(
          `SACK scoreboard emisor: ${JSON.stringify(this.sackScoreboard.sackedBlocks)}`
        );
      }
    }

    if (
      this.peerTimestampsEnabled &&
      packet.options?.TSval !== undefined &&
      packet.options?.TSecr !== undefined
    ) {
      this.lastTSvalReceived = packet.options.TSval;
      this.lastTSReply = packet.options.TSval;
    }

    // ECN
    if (this.ecnEnabled && packet.flags.ECE && !packet.flags.SYN) {
      this._log(`Recibido ECE: Congestión explícita detectada`);
      this.ssthresh = Math.max(this.cwnd / 2, this.MSS);
      this.cwnd = this.ssthresh;
      this.seqNum = this.nextSeqNum;
      let flags = { ACK: true, CWR: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }
      const params = this._createMessageParameters(
        this.seqNum,
        this.ackNum,
        0,
        flags,
        options
      );
      const cwrAck = this._buildMessage(params);
      this.sendMessage(cwrAck, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(ECN ack): " + err.message)
      );
    }

    // ACK puro
    if (packet.flags.ACK && !packet.flags.SYN && !packet.flags.FIN && !packet.flags.RST) {
      // Manejo de ACK => Reconoce nuestros datos => _handleAck
      this._log(`Recibido ACK ackNum=${packet.ackNum}, manejando ACK...`);
      this._handleAck(packet, simulationId);
      return;
    }

    // FIN sin ACK
    if (packet.flags.FIN && !packet.flags.ACK) {
      this._log(`Recibido FIN`);
      // Reconocemos su FIN => ack = seq + len + 1
      this.ackNum = packet.seqNum + packet.len + 1;
      this._sendAck(simulationId, this.ackNum);

      if (
        [
          this.states.ESTABLISHED,
          this.states.FIN_WAIT_1,
          this.states.FIN_WAIT_2,
        ].includes(this.state)
      ) {
        this.transition("recv_fin", simulationId);
      } else if (this.state === this.states.TIME_WAIT) {
        this._startTimeWaitTimer(simulationId);
      }
      return;
    }

    // FIN+ACK
    if (packet.flags.FIN && packet.flags.ACK) {
      this._log(`Recibido FIN+ACK`);
      // ackNum = packet.seq + len + 1
      this.ackNum = packet.seqNum + packet.len + 1;
      this._sendAck(simulationId, this.ackNum);

      if (this.state === this.states.FIN_WAIT_1) {
        this.state = this.states.CLOSING;
      } else if (this.state === this.states.ESTABLISHED) {
        this.state = this.states.CLOSE_WAIT;
        this._scheduleDataOrClose(simulationId);
      } else if (this.state === this.states.TIME_WAIT) {
        this._startTimeWaitTimer(simulationId);
      }
      return;
    }

    // Datos (sin SYN/ACK/FIN/RST)
    if (!packet.flags.SYN && !packet.flags.ACK && !packet.flags.FIN && !packet.flags.RST) {
      const segStart = packet.seqNum;
      const segEnd = packet.seqNum + packet.len - 1;

      if (segEnd < this.rcv_next) {
        this._log(`Segmento duplicado seq=${packet.seqNum}, reenviando ACK`);
        this._sendAck(simulationId, this.rcv_next);
      } else if (segStart > this.rcv_next + this.rcv_wnd - 1) {
        this._log(`Segmento fuera de ventana, descartando`);
        return;
      } else if (segStart === this.rcv_next) {
        // Aceptamos => ackNum = segEnd+1
        this.ackNum = segEnd + 1;
        this.rcv_next += packet.len;
        this._log(`Datos en orden recibidos, rcv_next=${this.rcv_next}`);

        this._reassembleData(simulationId);

        this.delayedAckSegments++;
        if (this.delayedAckSegments >= 2) {
          this._log(`Se han recibido 2 segmentos, enviando ACK inmediato`);
          this._sendAck(simulationId, this.rcv_next);
        } else {
          clearTimeout(this.delayedAckTimerId);
          this.delayedAckTimerId = setTimeout(() => {
            this._log(`Delayed ACK timer (200ms) expiró, enviando ACK`);
            this._sendAck(simulationId, this.rcv_next);
          }, this.delayedAckTimeout);
        }
      } else {
        this._log(`Segmento fuera de orden, seq=${packet.seqNum}, almacenando`);
        this.outOfOrderBuffer.set(packet.seqNum, packet);

        this.delayedAckSegments++;
        if (this.delayedAckSegments >= 2) {
          this._log(`2 segmentos acumulados, enviando ACK`);
          this._sendAck(simulationId, this.rcv_next);
        } else {
          clearTimeout(this.delayedAckTimerId);
          this.delayedAckTimerId = setTimeout(() => {
            this._log(`Delayed ACK timer expiró, enviando ACK`);
            this._sendAck(simulationId, this.rcv_next);
          }, this.delayedAckTimeout);
        }
      }
      this.transition("recv_data", simulationId);
    }
  }

  /**********************************/
  /*    Timers de SYN / SYN+ACK     */
  /**********************************/
  _startSynRetransmitTimer(simulationId) {
    if (this.synTimerId) {
      clearTimeout(this.synTimerId);
    }
    this.synTimerId = setTimeout(() => {
      this._handleSynRetransmission(simulationId);
    }, this.RTO);
  }

  _handleSynRetransmission(simulationId) {
    if (this.state === this.states.SYN_SENT && this.synRetries < this.maxSynRetries) {
      this.synRetries++;
      this._log(
        `No se recibió SYN+ACK, retransmitiendo SYN (intento ${this.synRetries})`
      );
      let flags = { SYN: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };

      if (this.windowScalingEnabled) {
        options.WScale = this.windowScalingShift;
      }
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = 0;
      }
      if (this.ecnEnabled) {
        flags.ECE = true;
        flags.CWR = true;
      }

      const params = this._createMessageParameters(this.iss, this.ackNum, 0, flags, options);
      let synMessage = this._buildMessage(params);
      this.sendMessage(synMessage, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(SYN retrans): " + err.message)
      );

      this._startSynRetransmitTimer(simulationId);
    } else if (this.state === this.states.SYN_SENT && this.synRetries >= this.maxSynRetries) {
      this._log(`Se agotaron los reintentos de SYN, cerrando conexión`);
      this.state = this.states.CLOSED;
    }
  }

  _startSynAckRetransmitTimer(simulationId) {
    if (this.synAckTimerId) {
      clearTimeout(this.synAckTimerId);
    }
    this.synAckTimerId = setTimeout(() => {
      this._handleSynAckRetransmission(simulationId);
    }, this.RTO);
  }

  _handleSynAckRetransmission(simulationId) {
    if (
      this.state === this.states.SYN_RECEIVED &&
      this.synAckRetries < this.maxSynAckRetries
    ) {
      this.synAckRetries++;
      this._log(
        `No se recibió ACK final, retransmitiendo SYN+ACK (intento ${this.synAckRetries})`
      );
      let flags = { SYN: true, ACK: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };

      if (this.ecnActive) {
        flags.ECE = true;
        flags.CWR = true;
      }
      if (this.windowScalingEnabled) {
        options.WScale = this.windowScalingShift;
      }
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }

      const params = this._createMessageParameters(this.iss, this.ackNum, 0, flags, options);
      let synAckMessage = this._buildMessage(params);
      this.sendMessage(synAckMessage, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(SYN+ACK retrans): " + err.message)
      );
      this._startSynAckRetransmitTimer(simulationId);
    } else if (
      this.state === this.states.SYN_RECEIVED &&
      this.synAckRetries >= this.maxSynAckRetries
    ) {
      this._log(`Se agotaron los reintentos de SYN+ACK, cerrando conexión`);
      this.state = this.states.CLOSED;
      if (this.synAckTimerId) {
        clearTimeout(this.synAckTimerId);
        this.synAckTimerId = null;
      }
    }
  }

  /**********************************/
  /*      Reensamblado de datos     */
  /**********************************/
  _reassembleData(simulationId) {
    let advanced = true;
    while (advanced) {
      advanced = false;
      let keys = Array.from(this.outOfOrderBuffer.keys()).sort((a, b) => a - b);
      for (let k of keys) {
        let seg = this.outOfOrderBuffer.get(k);
        if (k === this.rcv_next) {
          this.rcv_next += seg.len;
          this.outOfOrderBuffer.delete(k);
          this._log(`Reensamblaje: incorporado segmento seq=${k}, rcv_next=${this.rcv_next}`);
          advanced = true;
          break;
        }
      }
    }
  }

  /**********************************/
  /*         Manejo de ACK          */
  /**********************************/
  _handleAck(packet, simulationId) {
    const ackNum = packet.ackNum;
    // Este ackNum reconoce nuestros datos
    if (ackNum > this.nextSeqNum + 1 || ackNum < this.sendBase) {
      this._log(`ACK no válido ackNum=${ackNum}, ignorando`);
      return;
    }

    let prevSendBase = this.sendBase;
    let advanced = ackNum > this.sendBase;
    if (advanced) {
      this.sendBase = ackNum;
      this.duplicateAckCount = 0;
    }

    let recognizedSegments = [];
    for (let [seqNum, seg] of this.outstandingSegments) {
      if (seg.endSeqNum <= this.sendBase) {
        clearTimeout(seg.timerId);
        this.outstandingSegments.delete(seqNum);
        recognizedSegments.push(seg);
      }
    }

    // Manejo fastRecovery
    if (this.fastRecovery) {
      let theLostSegmentEnd = this._someLostSegmentEnd();
      if (advanced && ackNum < theLostSegmentEnd) {
        this._log(`Fast recovery: partial ACK recibido`);
        let nextLost = this._findNextLostSegment();
        if (
          nextLost &&
          this._needsRetransmission(nextLost.message.seqNum, nextLost.message.len)
        ) {
          this._log(
            `Retransmitiendo siguiente segmento perdido seq=${nextLost.message.seqNum} en fast recovery`
          );
          this._retransmitSegment(nextLost, simulationId);
          this.cwnd = this.ssthresh + this.MSS;
        }
      } else if (advanced && ackNum > theLostSegmentEnd) {
        this._log(`Saliendo de fast recovery`);
        this.fastRecovery = false;
        this.cwnd = this.ssthresh;
      } else if (!advanced) {
        this.duplicateAckCount++;
        this.cwnd += this.MSS;
        this._log(
          `Fast recovery: incrementando cwnd=${this.cwnd} por ACK duplicado adicional`
        );
      }
    } else {
      // No fastRecovery
      if (!advanced) {
        this.duplicateAckCount++;
        this._log(`ACK duplicado (${this.duplicateAckCount}) ackNum=${ackNum}`);
        if (this.duplicateAckCount === 3 && !this.fastRecovery) {
          this._log(`3 ACK duplicados, fast retransmit!`);
          this._fastRetransmit(simulationId);
        }
      } else {
        this._log(
          `ACK avanza sendBase a ${this.sendBase}, bytes reconocidos: ${
            this.sendBase - prevSendBase
          }`
        );

        // Tomamos RTT del primer segmento no retransmitido
        for (let seg of recognizedSegments) {
          if (!seg.retransmitted) {
            let sampleRTT;
            if (this.peerTimestampsEnabled && seg.sentTSval !== null) {
              sampleRTT = this._getSimTime() - seg.sentTSval;
            } else {
              sampleRTT = Date.now() - seg.sendTime;
            }
            if (sampleRTT > 0) {
              this._updateRTO(sampleRTT);
            }
            break;
          }
        }

        // Ajuste cwnd
        if (this.congestionControl === "cubic") {
          // Implementar cubic si deseas
        } else {
          if (this.cwnd < this.ssthresh) {
            // slow start
            this.cwnd += this.MSS;
            this._log(`Slow start: incrementando cwnd a ${this.cwnd}`);
          } else {
            // congestion avoidance
            const increment = Math.max(
              1,
              Math.floor((this.MSS * this.MSS) / this.cwnd)
            );
            this.cwnd += increment;
            this._log(`Congestion avoidance: incrementando cwnd a ${this.cwnd}`);
          }
        }

        this._checkIfCanClose(simulationId);

        // FSM
        if (
          [
            this.states.SYN_RECEIVED,
            this.states.FIN_WAIT_1,
            this.states.CLOSING,
            this.states.LAST_ACK,
          ].includes(this.state)
        ) {
          this.confirmAck = packet.ackNum
          this.transition("recv_ack", simulationId);
        } else if (
          (this.state === this.states.ESTABLISHED || this.state === this.states.CLOSE_WAIT) &&
          this.pendingDataSize > 0
        ) {
          this._scheduleDataSend(simulationId);
        }
      }
    }
  }

  _fastRetransmit(simulationId) {
    let firstUnacked = null;
    let minSeq = Infinity;
    for (let [seqNum, seg] of this.outstandingSegments) {
      if (seqNum < minSeq) {
        minSeq = seqNum;
        firstUnacked = seg;
      }
    }
    if (!firstUnacked) return;

    this.ssthresh = Math.max(Math.floor(this.cwnd / 2), this.MSS);
    this.cwnd = this.ssthresh + 3 * this.MSS;
    this.fastRecovery = true;

    this._log(
      `Fast retransmit del segmento seq=${firstUnacked.message.seqNum}, ssthresh=${this.ssthresh}, cwnd=${this.cwnd}`
    );
    firstUnacked.retransmitted = true;
    clearTimeout(firstUnacked.timerId);
    this.timeoutCount++;
    this.RTO = Math.min(this.RTO * 2, this.maxRTO);
    this._log(`Aumentando RTO a ${this.RTO} ms en fast retransmit`);

    if (
      !this._needsRetransmission(
        firstUnacked.message.seqNum,
        firstUnacked.message.len
      )
    ) {
      this._log(
        `Segmento seq=${firstUnacked.message.seqNum} ya SACKeado, no retransmitimos`
      );
      return;
    }

    this._retransmitSegment(firstUnacked, simulationId);
  }

  _retransmitSegment(segInfo, simulationId) {
    segInfo.retransmitted = true;
    let retransMessage = this._buildMessage(segInfo.originalParams);

    this._log(
      `Retransmitiendo segmento seq=${retransMessage.seqNum} (len=${retransMessage.len})`
    );

    this.saveMessage(
      retransMessage,
      retransMessage.len,
      simulationId,
      this.nodeId,
      false
    ).catch((err) => this._log(`Error al saveMessage en retrans: ${err.message}`));

    const timerId = setTimeout(() => {
      this._handleRetransmission(retransMessage.seqNum, simulationId);
    }, this.RTO);

    segInfo.message = retransMessage;
    segInfo.timerId = timerId;
    segInfo.sendTime = Date.now();
    this.outstandingSegments.set(retransMessage.seqNum, segInfo);

    this._advanceSimTime(segInfo.originalParams.latency);

    if (Math.random() < this.lossRatio) {
      this._log(
        `Paquete retransmitido (seq=${retransMessage.seqNum}) perdido por lossRatio`
      );
      return;
    }

    setTimeout(() => {
      if (this.partnerNode) {
        this.partnerNode.receiveMessage(retransMessage, simulationId);
      } else {
        this._log(`No partnerNode definido en retransmisión.`);
      }
    }, segInfo.originalParams.latency);
  }

  _handleRetransmission(seqNum, simulationId) {
    let segInfo = this.outstandingSegments.get(seqNum);
    if (!segInfo) return;

    if (this.state === this.states.CLOSED || this.state === this.states.TIME_WAIT) {
      this._log(`Ignoramos retransmisión en estado=${this.state}. seq=${seqNum}`);
      return;
    }

    this._log(`Timeout en seq=${seqNum}`);
    this.ssthresh = Math.max(Math.floor(this.cwnd / 2), this.MSS);
    this._log(`Ajustando ssthresh a ${this.ssthresh}, reiniciando cwnd a ${this.MSS}`);
    this.cwnd = this.MSS;
    this.fastRecovery = false;

    this.timeoutCount++;
    this.RTO = Math.min(this.RTO * 2, this.maxRTO);
    this._log(
      `Aumentando RTO a ${this.RTO} ms por timeout (consecutivos=${this.timeoutCount})`
    );

    if (!this._needsRetransmission(segInfo.message.seqNum, segInfo.message.len)) {
      this._log(
        `Segmento seq=${segInfo.message.seqNum} ya SACKeado, no retransmitimos`
      );
      return;
    }

    let retransMessage = this._buildMessage(segInfo.originalParams);
    this.saveMessage(
      retransMessage,
      retransMessage.len,
      simulationId,
      this.nodeId,
      false
    ).catch((err) => this._log(`Error al saveMessage en timeout: ${err.message}`));

    const timerId = setTimeout(() => {
      this._handleRetransmission(seqNum, simulationId);
    }, this.RTO);

    segInfo.message = retransMessage;
    segInfo.timerId = timerId;
    segInfo.sendTime = Date.now();
    this.outstandingSegments.set(seqNum, segInfo);

    this._advanceSimTime(segInfo.originalParams.latency);

    if (Math.random() < this.lossRatio) {
      this._log(`Paquete retransmitido (por timeout) perdido seq=${segInfo.message.seqNum}`);
      return;
    }

    setTimeout(() => {
      if (this.partnerNode) {
        this.partnerNode.receiveMessage(retransMessage, simulationId);
      } else {
        this._log(`No partnerNode definido en retransmisión por timeout.`);
      }
    }, segInfo.originalParams.latency);
  }

  _updateRTO(sampleRTT) {
    this._log(`Medición de RTT: ${sampleRTT}ms`);
    if (this.SRTT === null) {
      this.SRTT = sampleRTT;
      this.RTTVAR = sampleRTT / 2;
      this.RTO = Math.max(3000, this.minRTO);
    } else {
      this.RTTVAR =
        (1 - this.beta) * this.RTTVAR + this.beta * Math.abs(this.SRTT - sampleRTT);
      this.SRTT = (1 - this.alpha) * this.SRTT + this.alpha * sampleRTT;
      let RTOcalc = this.SRTT + Math.max(10, 4 * this.RTTVAR);
      RTOcalc = Math.max(RTOcalc, this.minRTO);
      RTOcalc = Math.min(RTOcalc, this.maxRTO);
      this.RTO = Math.floor(RTOcalc);
    }
    this.timeoutCount = 0;
    this._log(
      `Actualizando RTO: SRTT=${Math.floor(this.SRTT)}ms, RTTVAR=${Math.floor(
        this.RTTVAR
      )}ms, RTO=${this.RTO}ms, timeouts consecutivos=0`
    );
  }

  _verifyChecksum(packet) {
    let mssVal =
      packet.options && typeof packet.options.MSS === "number"
        ? packet.options.MSS
        : 1460;
    let ipVersion =
      packet.options && typeof packet.options.ipVersion === "number"
        ? packet.options.ipVersion
        : 4;

    let baseSum =
      (packet.srcPort +
        packet.destPort +
        packet.seqNum +
        packet.ackNum +
        packet.windowSize +
        packet.ttl +
        mssVal) %
      65535;

    if (ipVersion === 6) {
      baseSum = (baseSum + 12345) % 65535;
    }
    return baseSum === packet.checksum;
  }

  _someLostSegmentEnd() {
    let recognizedEnd = this.sendBase;
    if (this.sackScoreboard.sackedBlocks.length > 0) {
      for (let [start, end] of this.sackScoreboard.sackedBlocks) {
        if (start <= recognizedEnd + 1) {
          if (end > recognizedEnd) recognizedEnd = end;
        } else {
          break;
        }
      }
    }
    return recognizedEnd;
  }

  _findNextLostSegment() {
    for (let [seqNum, segInfo] of this.outstandingSegments) {
      if (this._needsRetransmission(segInfo.message.seqNum, segInfo.message.len)) {
        return segInfo;
      }
    }
    return null;
  }

  _needsRetransmission(seqStart, len) {
    let seqEnd = seqStart + len - 1;
    if (this.sackScoreboard.isRangeSacked(seqStart, seqEnd)) {
      return false;
    }
    return true;
  }

  /**********************************/
  /*  Guardar en DB (MessageHistory) */
  /**********************************/
  async saveMessage(message, dataSize, simulationId, senderNodeId, isLost = false) {
    const msgTimestamp = new Date().toISOString();
    const query = `
      INSERT INTO MessageHistory (
        simulation_id, node_id, timestamp, parameter_TCP, len
      ) VALUES (?,?,?,?,?)
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
      ttl: message.ttl,
      isLost: isLost,
    };

    try {
      await db.runAsync(query, [
        simulationId,
        senderNodeId,
        msgTimestamp,
        JSON.stringify(parameters),
        dataSize,
      ]);
      this._log(
        `Mensaje guardado en la BD: seq=${message.seqNum}, ack=${message.ackNum}, len=${dataSize}, lost=${isLost}`
      );
    } catch (err) {
      this._log(`Error al guardar el mensaje en DB: ${err.message}`);
    }
  }

  /**********************************/
  /*       startSimulation(...)     */
  /**********************************/
  startSimulation(dataSize, simulationId) {
    //this.state = this.states.CLOSED;
    //this.seqNum = Math.floor(Math.random() * 10000);
    this.sendBase = this.seqNum;
    this.nextSeqNum = this.seqNum;
    this.iss = this.seqNum;
    this.ackNum = 0;
    this.closing = false;
    this.closeRequested = false;
    this.pendingDataSize = Number(dataSize) || 0;
    this.ackReceived = false;
    this.buffer = 0;
    this.cwnd = this.MSS;
    this.ssthresh = 64 * this.MSS;
    this.dataSize = Number(dataSize) || 0;

    this.RTO = 3000;
    this.SRTT = null;
    this.RTTVAR = null;
    this.duplicateAckCount = 0;
    this.fastRecovery = false;
    this.outOfOrderBuffer.clear();
    this.sackScoreboard = new SACKScoreboard();

    this.synRetries = 0;
    this.synAckRetries = 0;
    this.timeoutCount = 0;

    this._cleanupTimers();

    this.timestampMap.clear();
    this.simTime = 0;

    this._log(`Iniciando simulación con ${this.pendingDataSize} bytes por enviar.`);
    this._startKeepAliveTimer(simulationId);
    this.transition("start_simulation", simulationId);
  }

  /**********************************/
  /*   keepAlive, persist, etc.     */
  /**********************************/
  _startKeepAliveTimer(simulationId) {
    if (!this.keepAliveEnabled) return;
    clearTimeout(this.keepAliveTimerId);
    this.keepAliveTimerId = setTimeout(() => {
      this._log(`Enviando keep-alive`);
      let ackSeq = this.seqNum;
      let ackNum = this.rcv_next; // Reconocer lo último del peer
      let flags = { ACK: true };
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      if (this.timestampsEnabled) {
        this.lastTSvalSent = this._getSimTime();
        options.TSval = this.lastTSvalSent;
        options.TSecr = this.lastTSReply;
      }
      const params = this._createMessageParameters(
        ackSeq,
        ackNum,
        0,
        flags,
        options
      );
      let kaMsg = this._buildMessage(params);
      this.sendMessage(kaMsg, 0, simulationId).catch((err) =>
        this._log("Error en sendMessage(keepAlive): " + err.message)
      );
      this._startKeepAliveTimer(simulationId);
    }, this.keepAliveInterval);
  }

  _startPersistTimer(simulationId) {
    if (this.persistTimerId) return;
    this._log(`Ventana cero detectada, iniciando persist timer`);
    this.persistTimerId = setTimeout(() => {
      this._log(`Persist timer expiró, enviando sonda de persistencia`);
      let flags = {};
      let options = { MSS: this.MSS, ipVersion: this.ipVersion };
      const params = this._createMessageParameters(this.nextSeqNum, this.ackNum, 1, flags, options);
      let probe = this._buildMessage(params);
      this.sendMessage(probe, 1, simulationId).catch((err) =>
        this._log("Error en sendMessage(persist): " + err.message)
      );
      this.persistTimerId = null;

      let inflight = this.nextSeqNum - this.sendBase;
      let receiverWindow = 0;
      if (this.partnerNode && typeof this.partnerNode.windowSize === "number") {
        receiverWindow = this.partnerNode.windowSize - inflight;
      } else {
        receiverWindow = this.windowSize - inflight;
      }
      if (receiverWindow <= 0) {
        this._log(`La ventana sigue en cero, reprogramando persist timer`);
        this._startPersistTimer(simulationId);
      }
    }, this.persistTimeout);
  }

  _scheduleDataSend(simulationId) {
    if (
      (this.state === this.states.ESTABLISHED || this.state === this.states.CLOSE_WAIT) &&
      !this.closing
    ) {
      setTimeout(() => this.transition("send_data", simulationId), 50);
    }
  }

  _scheduleClose(simulationId) {
    if (
      !this.closing &&
      (this.state === this.states.ESTABLISHED || this.state === this.states.CLOSE_WAIT)
    ) {
      setTimeout(() => this.transition("close_connection", simulationId), 50);
    }
  }

  _scheduleDataOrClose(simulationId) {
    if (this.pendingDataSize > 0) {
      this._scheduleDataSend(simulationId);
    } else {
      this._scheduleClose(simulationId);
    }
  }

  /**********************************/
  /*   Lógica de envío (segmento)   */
  /**********************************/
  _calculateAvailableWindow() {
    const inflight = this.nextSeqNum - this.sendBase;
    let receiverWindow = 0;
    if (!this.partnerNode) {
      this._log("Advertencia: No se ha definido partnerNode, no se envían datos.");
      return { inflight, availableWindow: 0, receiverWindow: 0 };
    }
    if (typeof this.partnerNode.windowSize === "number") {
      receiverWindow = this.partnerNode.windowSize - inflight;
    } else {
      this._log(
        "Advertencia: partnerNode.windowSize no es numérico, no se envía nada."
      );
      return { inflight, availableWindow: 0, receiverWindow: 0 };
    }

    const cwndInBytes = this.cwnd;
    const availableWindow = Math.min(receiverWindow, cwndInBytes);
    return { inflight, availableWindow, receiverWindow };
  }

  _checkNagle(segmentSize, inflight, simulationId) {
    if (this.useNagle && segmentSize < this.MSS && inflight > 0) {
      this._log(
        `Nagle: segmento pequeño (${segmentSize} bytes < MSS=${this.MSS}) y datos en vuelo (${inflight}). Esperando ACK.`
      );
      if (!this.nagleTimerId) {
        this.nagleTimerId = setTimeout(() => {
          this._log(`Nagle timer expiró, enviando segmento pequeño de todas formas`);
          this.nagleTimerId = null;
          this._sendSegmentWithPacing(segmentSize, simulationId);
        }, 200);
      }
      return false;
    }
    return true;
  }

  trySendOneSegment(simulationId) {
    if (this.pendingDataSize <= 0) {
      if (
        !this.closing &&
        (this.state === this.states.ESTABLISHED || this.state === this.states.CLOSE_WAIT)
      ) {
        this._log(`No hay datos por enviar, intentando close_connection`);
        this.transition("close_connection", simulationId);
      }
      return;
    }

    const { inflight, availableWindow } = this._calculateAvailableWindow();
    this._log(
      `trySendOneSegment: pendingDataSize=${this.pendingDataSize}, inflight=${inflight}, availableWindow=${availableWindow}`
    );

    if (availableWindow <= 0) {
      this._log(`Ventana o cwnd llena, esperando ACK...`);
      if (
        this.partnerNode &&
        typeof this.partnerNode.windowSize === "number" &&
        this.partnerNode.windowSize === 0
      ) {
        this._startPersistTimer(simulationId);
      }
      return;
    }

    if (this.persistTimerId) {
      clearTimeout(this.persistTimerId);
      this.persistTimerId = null;
    }

    const segmentSize = Math.min(
      this.pendingDataSize,
      Math.min(availableWindow, this.MSS)
    );

    if (!this._checkNagle(segmentSize, inflight, simulationId)) {
      return;
    }
    if (this.nagleTimerId) {
      clearTimeout(this.nagleTimerId);
      this.nagleTimerId = null;
    }

    this._log(`trySendOneSegment: Enviando segmento de ${segmentSize} bytes ahora.`);
    this._sendSegmentWithPacing(segmentSize, simulationId);
  }

  // *** Aseguramos ackNum = this.ackNum, NO seqToSend
  _sendSegmentWithPacing(segmentSize, simulationId) {
    if (segmentSize <= 0) {
      this._log(`_sendSegmentWithPacing: Tamaño de segmento inválido (<=0).`);
      return;
    }
    this.pacingQueue.push({ segmentSize, simulationId });
    if (!this.pacingTimerId) {
      this._startPacingTimer();
    }
  }

  _startPacingTimer() {
    if (this.pacingEnabled) {
      this.pacingTimerId = setInterval(() => {
        if (this.pacingQueue.length > 0) {
          let { segmentSize, simulationId } = this.pacingQueue.shift();
          this._actuallySendSegment(segmentSize, simulationId);
        } else {
          clearInterval(this.pacingTimerId);
          this.pacingTimerId = null;
        }
      }, this.pacingInterval);
    } else {
      while (this.pacingQueue.length > 0) {
        let { segmentSize, simulationId } = this.pacingQueue.shift();
        this._actuallySendSegment(segmentSize, simulationId);
      }
    }
  }

  // *** Aseguramos ackNum = this.ackNum
  _actuallySendSegment(segmentSize, simulationId) {
    if (segmentSize <= 0) {
      this._log(`_actuallySendSegment: segmentSize<=0, no se envía.`);
      return;
    }

    const seqToSend = this.nextSeqNum;
    // Este es nuestro reconocimiento del peer
    const ackToSend = this.ackNum;

    this._log(
      `Enviando segmento de ${segmentSize} bytes (seq=${seqToSend}) cwnd=${this.cwnd}, ssthresh=${this.ssthresh}`
    );

    let flags = {};
    let options = { MSS: this.MSS, ipVersion: this.ipVersion };

    if (this.timestampsEnabled) {
      this.lastTSvalSent = this._getSimTime();
      options.TSval = this.lastTSvalSent;
      options.TSecr = this.lastTSReply;
    }
    if (this.securityEnabled) {
      options.MD5Sig = "md5fake";
    }

    // ackNum = ackToSend
    const params = this._createMessageParameters(
      seqToSend,
      ackToSend,
      segmentSize,
      flags,
      options
    );
    let message = this._buildMessage(params);

    this.nextSeqNum += segmentSize;
    this.pendingDataSize -= segmentSize;
    
    this.sendMessage(message, segmentSize, simulationId).catch((err) =>
      this._log("Error en sendMessage(_actuallySendSegment): " + err.message)
    );

    

    if (this.pendingDataSize > 0) {
      this._scheduleDataSend(simulationId);
    } else {
      this._scheduleClose(simulationId);
    }
  }
}

module.exports = {
  TCPNode,
  MessageTCP
};
