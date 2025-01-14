// tcpNode.js

const db = require("./db");

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
      ipVersion: params.ipVersion
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
    let mssVal = (typeof this.options.MSS === 'number') ? this.options.MSS : 1460;
    let ipVersion = (typeof this.options.ipVersion === 'number') ? this.options.ipVersion : 4;

    let baseSum = (
      this.srcPort +
      this.destPort +
      this.seqNum +
      this.ackNum +
      this.windowSize +
      this.ttl +
      mssVal
    ) % 65535;

    if(ipVersion === 6){
      baseSum = (baseSum + 12345) % 65535;
    }
    return baseSum;
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

    const ephemeralPortStart = 49152;
    const ephemeralPortEnd = 65535;
    this.srcPort = Math.floor(Math.random()*(ephemeralPortEnd - ephemeralPortStart+1)) + ephemeralPortStart;
    this.destPort = 0;
    this.seqNum = Math.floor(Math.random()*10000);
    this.ackNum = 0;
    this.windowSize = 1024;
    this.ttl = 64;
    this.latency = Math.floor(Math.random()*500)+100;
    this.MTU = 1500;
    this.MSS = 1460;
    this.peerMSS = 1460;

    // [MODIFICADO para handshakeLossRatio]
    this.handshakeLossRatio = 0; // Casi 0 para evitar pérdida en handshake
    this.lossRatio = 0.0;        // Pérdida normal para datos

    this.ackReceived = false;
    this.pendingDataSize = 0;
    this.MSL = 30000;
    this.timeWaitDuration = 2*this.MSL;
    this.appCloseDelay = 0;
    this.closing = false;
    this.sendBase = this.seqNum;
    this.nextSeqNum = this.seqNum;
    this.buffer = 0;

    this.cwnd = this.MSS;
    this.ssthresh = 64*this.MSS;
    this.congestionControl = "reno";

    // [MEJORA] RTO y RTT (RFC 6298 style)
    this.SRTT = null;
    this.RTTVAR = null;
    this.RTO = 3000;
    this.minRTO = 1000;
    this.maxRTO = 60000;
    this.alpha = 1/8;
    this.beta = 1/4;

    this.outstandingSegments = new Map();
    this.rcv_next = 0;
    this.rcv_wnd = this.windowSize;
    this.outOfOrderBuffer = new Map();
    this.duplicateAckCount = 0;
    this.fastRecovery = false;
    this.initialSeqNum = this.seqNum;
    this.initialRemoteSeqNum = null;
    this.iss = this.seqNum;
    this.irs = null;

    this.persistTimerId = null;
    this.persistTimeout = 1000;

    this.keepAliveEnabled = true;
    this.keepAliveInterval = 7200000;
    this.keepAliveTimerId = null;

    this.useNagle = true;
    this.nagleTimerId = null;

    // delayed ACK con umbral
    this.delayedAckEnabled = true;
    this.delayedAckTimeout = 200;
    this.delayedAckTimerId = null;
    this.delayedAckSegments = 0;

    this.timestampsEnabled = true;
    this.peerTimestampsEnabled = false;
    this.lastTSvalSent = 0;
    this.lastTSvalReceived = 0;
    this.lastTSReply = 0;

    this.windowScalingEnabled = true;
    this.windowScalingShift = 3;
    this.peerWindowScalingShift = 0;

    this.sackEnabled = true;
    this.receivedSACKBlocks = [];
    this.sackScoreboard = { sackedBlocks: [], lostBlocks: [], rxmitQueue: [] };

    this.ecnEnabled = true;
    this.ecnActive = false;

    this.lastCongestionEventTime = Date.now();
    this.lastMaxCwnd = this.ssthresh*2;

    this.useSynCookies = true;
    this.securityEnabled = true;
    this.sharedKey = "somekey";

    this.pacingEnabled = true;
    this.pacingInterval = 10;
    this.pacingTimerId = null;

    this.ipVersion = 4;
    this.srcAddr = null;
    this.dstAddr = null;

    this.receivedUnexpectedSegments = 0;
    this.checksum = this.generateChecksum();

    // Retransmisión de SYN
    this.synTimerId = null;
    this.synRetries = 0;
    this.maxSynRetries = 5; 

    // Retransmisión de SYN+ACK
    this.synAckTimerId = null;
    this.synAckRetries = 0;
    this.maxSynAckRetries = 5;

    // [MEJORA] Contador de timeouts consecutivos
    this.timeoutCount = 0;

    // [NEW] Guardamos la seq del FIN recibido del otro lado, para saber
    //       hasta dónde deben llegar los datos. (TCP real trackea fin_seq).
    this.partnerFinSeq = null;
  }

  _cleanupTimers() {
    if(this.keepAliveTimerId){
      clearTimeout(this.keepAliveTimerId);
      this.keepAliveTimerId=null;
    }
    if(this.nagleTimerId){
      clearTimeout(this.nagleTimerId);
      this.nagleTimerId=null;
    }
    if(this.pacingTimerId){
      clearTimeout(this.pacingTimerId);
      this.pacingTimerId=null;
    }
    if(this.delayedAckTimerId){
      clearTimeout(this.delayedAckTimerId);
      this.delayedAckTimerId=null;
      this.delayedAckSegments=0;
    }
    if(this.synTimerId){
      clearTimeout(this.synTimerId);
      this.synTimerId=null;
    }
    if(this.synAckTimerId){
      clearTimeout(this.synAckTimerId);
      this.synAckTimerId=null;
    }
    if(this.persistTimerId){
      clearTimeout(this.persistTimerId);
      this.persistTimerId=null;
    }
    if(this._timeWaitTimerId){
      clearTimeout(this._timeWaitTimerId);
      this._timeWaitTimerId=null;
    }
    this._log(`Timers limpiados en _cleanupTimers()`);
  }

  // [NEW] Limpia también los segmentos en vuelo y sus timers
  _clearOutstandingSegments() {
    for (let [seqNum, segInfo] of this.outstandingSegments) {
      clearTimeout(segInfo.timerId);
    }
    this.outstandingSegments.clear();
    this._log(`Outstanding segments limpiados en _clearOutstandingSegments().`);
  }

  _log(message) {
    console.log(`[Node ${this.nodeId}] ${message}`);
  }

  generateChecksum(){
    return (
      (this.srcPort+
       this.destPort+
       this.seqNum+
       this.ackNum+
       this.windowSize+
       this.ttl)%65535
    );
  }

  _generateSynCookie(srcPort,destPort,seqNum) {
    return { iss: this.iss+123 };
  }

  _validateSynCookie(ackNum) {
    return (ackNum===this.iss+124);
  }

  _calculateSignature(message,key) {
    return "md5fake";
  }

  _validateSignature(packet,key) {
    return packet.options.MD5Sig==="md5fake";
  }

  // Manejo de SACK simplificado
  _getUnsackedRange(seqStart, seqEnd) {
    let sackedLen = 0;
    for (let [sstart, send] of this.receivedSACKBlocks) {
      if (send >= seqStart && sstart <= seqEnd) {
        const overlapStart = Math.max(seqStart, sstart);
        const overlapEnd = Math.min(seqEnd, send);
        sackedLen += (overlapEnd - overlapStart + 1);
      }
    }
    const totalLen = (seqEnd - seqStart + 1);
    if (sackedLen >= totalLen) return null; 
    return [seqStart, seqEnd - sackedLen];
  }

  _needsRetransmission(seqNum,length){
    if(!this.sackEnabled || this.receivedSACKBlocks.length===0) return true;
    let start=seqNum;
    let end=seqNum+length-1;
    let unsacked = this._getUnsackedRange(start,end);
    return (unsacked !== null);
  }

  listenQueueFull() {
    return false;
  }

  haveStateForConnection() {
    return false;
  }

  _announceWindowSize() {
    let announced = this.windowSize;
    if(this.windowScalingEnabled) {
      announced=announced>>this.windowScalingShift;
    }
    return announced;
  }

  setNodeParameter(parameterSettings) {
    this.state=parameterSettings.state;
    this.buffer=parameterSettings.buffer;
    this.ttl=parameterSettings.ttl;
    this.latency=parameterSettings.latency;
    this.MTU=parameterSettings.MTU;
    this.srcPort=parameterSettings.srcPort;
    this.destPort=parameterSettings.destPort;
    this.seqNum=parameterSettings.seqNum;
    this.ackNum=parameterSettings.ackNum;
    this.windowSize=parameterSettings.windowSize;
    this.checksum=parameterSettings.checksum;

    if(parameterSettings.MSS) this.MSS=parameterSettings.MSS;
    if(parameterSettings.lossRatio!==undefined) this.lossRatio=parameterSettings.lossRatio;

    this.sendBase=this.seqNum;
    this.nextSeqNum=this.seqNum;
  }

  getParameters() {
    return {
      nodeId:this.nodeId,
      state:this.state,
      buffer:this.buffer,
      ttl:this.ttl,
      latency:this.latency,
      MTU:this.MTU,
      srcPort:this.srcPort,
      destPort:this.destPort,
      seqNum:this.seqNum,
      ackNum:this.ackNum,
      windowSize:this.windowSize,
      checksum:this.checksum,
      MSS:this.MSS,
      peerMSS:this.peerMSS,
      lossRatio:this.lossRatio,
      sendBase:this.sendBase,
      nextSeqNum:this.nextSeqNum,
      cwnd:this.cwnd,
      ssthresh:this.ssthresh,
      RTO:this.RTO
    };
  }

  transition(action,simulationId) {
    this._log(`Transición con acción: ${action} (estado actual: ${this.state})`);
    const prevState=this.state;
    switch(this.state) {
      case this.states.CLOSED:
        this._handleClosed(action,simulationId);
        break;
      case this.states.LISTEN:
        this._handleListen(action,simulationId);
        break;
      case this.states.SYN_SENT:
        this._handleSynSent(action,simulationId);
        break;
      case this.states.SYN_RECEIVED:
        this._handleSynReceived(action,simulationId);
        break;
      case this.states.ESTABLISHED:
        this._handleEstablished(action,simulationId);
        break;
      case this.states.FIN_WAIT_1:
        this._handleFinWait1(action,simulationId);
        break;
      case this.states.FIN_WAIT_2:
        this._handleFinWait2(action,simulationId);
        break;
      case this.states.CLOSE_WAIT:
        this._handleCloseWait(action,simulationId);
        break;
      case this.states.LAST_ACK:
        this._handleLastAck(action,simulationId);
        break;
      case this.states.CLOSING:
        this._handleClosing(action,simulationId);
        break;
      case this.states.TIME_WAIT:
        this._handleTimeWait(action,simulationId);
        break;
      default:
        break;
    }
    if(this.state!==prevState){
      this._log(`Estado cambiado: ${prevState} -> ${this.state}`);

      // [NEW] Al pasar a TIME_WAIT, limpiamos outstandingSegments
      if(this.state===this.states.TIME_WAIT){
        this._clearOutstandingSegments();
      }

      if(this.state===this.states.CLOSED){
        // [NEW] Al cerrar, limpiamos timers y outstandingSegments
        this._cleanupTimers();
        this._clearOutstandingSegments();
      }
    }
  }

  _createMessageParameters(seqNum, ackNum, len=0, flags={}, options={}) {
    return {
      srcPort: this.srcPort,
      destPort: this.destPort,
      seqNum: seqNum,
      ackNum: ackNum,
      windowSize: this._announceWindowSize(),
      ttl: this.ttl,
      MSS: this.MSS,
      ipVersion:this.ipVersion,
      latency:this.latency,
      flags:Object.assign({},flags),
      options:Object.assign({},options),
      len: len
    };
  }

  _buildMessage(params) {
    let msg=new MessageTCP(params);
    msg.flags=params.flags;
    msg.len=params.len;
    for(let k in params.options){
      msg.options[k]=params.options[k];
    }
    return msg;
  }

  _handleClosed(action,simulationId){
    if(action==="start_simulation"){
      if(this.nodeId==="A"){
        this._log(`Preparando para enviar SYN: iss=${this.iss}, seqNum=${this.seqNum}`);
        this.state=this.states.SYN_SENT;

        let flags={SYN:true};
        let options={
          MSS:this.MSS,
          ipVersion:this.ipVersion
        };
        if(this.windowScalingEnabled){
          options.WScale=this.windowScalingShift;
        }
        if(this.timestampsEnabled){
          this.lastTSvalSent++;
          options.TSval=this.lastTSvalSent;
          options.TSecr=0;
        }
        if(this.ecnEnabled){
          flags.ECE=true;
          flags.CWR=true;
        }

        const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
        let synMessage=this._buildMessage(params);
        this._log(`Enviando SYN (seq=${synMessage.seqNum}, MSS=${this.MSS}, WScale=${this.windowScalingShift}, ECN)`);
        this.sendMessage(synMessage,0,simulationId);
        this.nextSeqNum+=1;

        this._startSynRetransmitTimer(simulationId);

      } else if(this.nodeId==="B"){
        this._log(`Esperando conexión entrante en LISTEN`);
        this.state=this.states.LISTEN;
      }
    }
  }

  _startSynRetransmitTimer(simulationId){
    if(this.synTimerId){
      clearTimeout(this.synTimerId);
    }
    this.synTimerId=setTimeout(()=>{
      this._handleSynRetransmission(simulationId);
    },this.RTO);
  }

  _handleSynRetransmission(simulationId){
    if(this.state===this.states.SYN_SENT && this.synRetries<this.maxSynRetries){
      this.synRetries++;
      this._log(`No se recibió SYN+ACK, retransmitiendo SYN (intento ${this.synRetries})`);
      let flags={SYN:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      if(this.windowScalingEnabled){
        options.WScale=this.windowScalingShift;
      }
      if(this.timestampsEnabled){
        this.lastTSvalSent++;
        options.TSval=this.lastTSvalSent;
        options.TSecr=0;
      }
      if(this.ecnEnabled){
        flags.ECE=true;
        flags.CWR=true;
      }

      const params=this._createMessageParameters(this.iss,this.ackNum,0,flags,options);
      let synMessage=this._buildMessage(params);
      this.sendMessage(synMessage,0,simulationId);

      this._startSynRetransmitTimer(simulationId);
    } else if(this.state===this.states.SYN_SENT && this.synRetries>=this.maxSynRetries){
      this._log(`Se agotaron los reintentos de SYN, cerrando conexión`);
      this.state=this.states.CLOSED;
    }
  }

  _handleListen(action,simulationId){}

  _handleSynSent(action,simulationId){
    if(action==="recv_syn_ack"){
      this._log(`En _handleSynSent: Recibido evento recv_syn_ack. ackNum=${this.ackNum}, iss+1=${this.iss+1}`);
      if(this.ackNum!==this.iss+1){
        this._log(`ACK no válido en SYN_SENT (no coincide con iss+1)`);
        return;
      }
      this._log(`Recibido SYN+ACK válido, estableciendo conexión`);
      this.state=this.states.ESTABLISHED;
      this.rcv_next=this.irs+1;
      this.sendBase=this.iss+1;
      this.nextSeqNum=this.iss+1;

      if(this.synTimerId){
        clearTimeout(this.synTimerId);
        this.synTimerId=null;
      }

      this._sendAck(simulationId,this.irs+1);
      this._scheduleDataOrClose(simulationId);
    }
  }

  _handleSynReceived(action,simulationId){
    if(action==="recv_ack"){
      this._log(`En _handleSynReceived: Recibido ACK final del handshake. ackNum=${this.ackNum}, iss+1=${this.iss+1}`);
      if(this.ackNum!==this.iss+1){
        this._log(`ACK final del handshake no válido (no coincide con iss+1)`);
        return;
      }
      this._log(`Recibido ACK final del handshake, estableciendo conexión`);
      this.state=this.states.ESTABLISHED;
      this.rcv_next=this.irs+1;
      this.sendBase=this.iss+1;
      this.nextSeqNum=this.iss+1;

      if(this.synAckTimerId){
        clearTimeout(this.synAckTimerId);
        this.synAckTimerId=null;
        this.synAckRetries=0;
      }

      this._scheduleDataOrClose(simulationId);
    }
  }

  _handleEstablished(action,simulationId){
    if(action==="send_data"){
      this._log(`Intentando enviar datos...`);
      this.trySendOneSegment(simulationId);
    } else if(action==="recv_data"){
      this._log(`Datos recibidos en ESTABLISHED`);
    } else if(action==="recv_fin"){
      this._log(`Recibido FIN del partner, cerrando hacia CLOSE_WAIT`);
      this.state=this.states.CLOSE_WAIT;

      // [NEW] Guardamos la seq del FIN para saber hasta dónde hay datos.
      if(!this.partnerFinSeq) {
        this.partnerFinSeq = this.partnerNode.seqNum; 
      }

      if(!this.partnerNode || typeof this.partnerNode.seqNum!=='number'){
        this._log(`Advertencia: partnerNode no definido o seqNum inválido antes de asignar ackNum.`);
        return;
      }
      this.ackNum=this.partnerNode.seqNum+1;
      this._sendAck(simulationId,this.ackNum);
      this._scheduleDataOrClose(simulationId);
    } else if(action==="close_connection"){
      if(!this.closing && this.pendingDataSize===0){
        this._log(`Cerrando conexión desde ESTABLISHED (FIN_WAIT_1)`);
        this.closing=true;
        this.state=this.states.FIN_WAIT_1;
        this.seqNum=this.nextSeqNum;
        this.ackNum=this.partnerNode.seqNum;
        let flags={FIN:true};
        let options={
          MSS:this.MSS,
          ipVersion:this.ipVersion
        };
        if(this.timestampsEnabled){
          this.lastTSvalSent++;
          options.TSval=this.lastTSvalSent;
          options.TSecr=this.lastTSReply;
        }

        const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
        let finMessage=this._buildMessage(params);
        this._log(`Enviando FIN (seq=${finMessage.seqNum})`);
        this.sendMessage(finMessage,0,simulationId);
        this.nextSeqNum+=1;
      }
    }
  }

  _handleFinWait1(action,simulationId){
    if(action==="recv_ack"){
      this._log(`Recibido ACK de nuestro FIN, pasando a FIN_WAIT_2`);
      this.state=this.states.FIN_WAIT_2;
    } else if(action==="recv_fin"){
      this._log(`Recibido FIN mientras en FIN_WAIT_1, pasando a CLOSING`);
      this.state=this.states.CLOSING;

      // [NEW] Si recibimos FIN, guardamos seq para saber dónde acaba.
      if(!this.partnerFinSeq) {
        this.partnerFinSeq = this.partnerNode.seqNum;
      }

      if(!this.partnerNode || typeof this.partnerNode.seqNum!=='number'){
        this._log(`Advertencia: partnerNode no definido o seqNum inválido en FIN_WAIT_1.`);
        return;
      }
      this.ackNum=this.partnerNode.seqNum+1;
      this._sendAck(simulationId,this.ackNum);
    }
  }

  _handleFinWait2(action,simulationId){
    if(action==="recv_fin"){
      this._log(`Recibido FIN mientras en FIN_WAIT_2, pasando a TIME_WAIT`);
      this.state=this.states.TIME_WAIT;

      // [NEW] Guardamos la seq del FIN
      if(!this.partnerFinSeq) {
        this.partnerFinSeq = this.partnerNode.seqNum;
      }

      if(!this.partnerNode || typeof this.partnerNode.seqNum!=='number'){
        this._log(`Advertencia: partnerNode no definido o seqNum inválido en FIN_WAIT_2.`);
        return;
      }
      this.ackNum=this.partnerNode.seqNum+1;
      this._sendAck(simulationId,this.ackNum);
      this._startTimeWaitTimer(simulationId);
    }
  }

  _handleCloseWait(action,simulationId){
    if(action==="send_data"){
      this._log(`Enviando datos en CLOSE_WAIT`);
      this.trySendOneSegment(simulationId);

      // [NEW] Comprobamos si ya tenemos todos los datos de partner (si finSec no es nulo)
      // Si rcv_next >= partnerFinSeq+1, ya llegó todo.
      if(this.partnerFinSeq!==null && this.rcv_next >= this.partnerFinSeq+1){
        this._log(`Ya se recibió todo del partner (rcv_next >= finSeq+1).`);
      }

      if(this.pendingDataSize===0 && !this.closing){
        this._scheduleClose(simulationId);
      }
    } else if(action==="close_connection"){
      if(!this.closing && this.pendingDataSize===0){
        this._log(`Cerrando conexión desde CLOSE_WAIT hacia LAST_ACK`);
        this.closing=true;
        this.state=this.states.LAST_ACK;
        this.seqNum=this.nextSeqNum;
        let flags={FIN:true};
        let options={
          MSS:this.MSS,
          ipVersion:this.ipVersion
        };
        if(this.timestampsEnabled){
          this.lastTSvalSent++;
          options.TSval=this.lastTSvalSent;
          options.TSecr=this.lastTSReply;
        }
        const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
        let finMessage=this._buildMessage(params);
        this._log(`Enviando FIN (seq=${finMessage.seqNum})`);
        this.sendMessage(finMessage,0,simulationId);
        this.nextSeqNum+=1;
      }
    }
  }

  _handleClosing(action,simulationId){
    if(action==="recv_ack"){
      this._log(`Recibido ACK en CLOSING, pasando a TIME_WAIT`);
      this.state=this.states.TIME_WAIT;
      this._startTimeWaitTimer(simulationId);
    }
  }

  _handleLastAck(action,simulationId){
    if(action==="recv_ack"){
      this._log(`Recibido ACK en LAST_ACK, conexión cerrada`);
      this.state=this.states.CLOSED;
    }
  }

  _handleTimeWait(action,simulationId){
    // [CHANGED] Normalmente no hay nada que hacer, se espera TIME_WAIT expire.
    // SÍ limpiamos en _startTimeWaitTimer / state change -> TIME_WAIT.
  }

  setPartner(node){
    this._log(`Asociando partnerNode: ${node.nodeId}`);
    this.partnerNode=node;
    this.destPort=node.srcPort;
  }

  _calculateAvailableWindow() {
    const inflight = this.nextSeqNum - this.sendBase;
    let receiverWindow = 0;
    if(!this.partnerNode) {
      this._log("Advertencia: No se ha definido partnerNode, no se envían datos.");
      return { inflight, availableWindow: 0, receiverWindow: 0 };
    }

    if(typeof this.partnerNode.windowSize === 'number'){
      receiverWindow = this.partnerNode.windowSize - inflight;
    } else {
      this._log("Advertencia: partnerNode.windowSize no es numérico, no se envía nada.");
      return { inflight, availableWindow: 0, receiverWindow: 0 };
    }

    const cwndInBytes = this.cwnd;
    const availableWindow = Math.min(receiverWindow, cwndInBytes);
    return { inflight, availableWindow, receiverWindow };
  }

  _checkNagle(segmentSize, inflight, simulationId) {
    if(this.useNagle && segmentSize < this.MSS && inflight > 0) {
      this._log(`Nagle: segmento pequeño (${segmentSize} bytes < MSS=${this.MSS}) y datos en vuelo (${inflight} bytes). Esperando ACK o timeout.`);
      if(!this.nagleTimerId) {
        this.nagleTimerId=setTimeout(()=>{
          this._log(`Nagle timer expiró, enviando segmento pequeño de todas formas`);
          this.nagleTimerId=null;
          this._sendSegmentWithPacing(segmentSize, simulationId);
        },200);
      }
      return false;
    }
    return true;
  }

  trySendOneSegment(simulationId){
    if(this.pendingDataSize<=0){
      if(!this.closing && (this.state===this.states.ESTABLISHED||this.state===this.states.CLOSE_WAIT)){
        this._log(`No hay datos por enviar, cerrando conexión`);
        this.transition("close_connection",simulationId);
      }
      return;
    }

    const { inflight, availableWindow } = this._calculateAvailableWindow();

    this._log(`trySendOneSegment: pendingDataSize=${this.pendingDataSize}, inflight=${inflight}, availableWindow=${availableWindow}`);

    if(availableWindow<=0){
      this._log(`Ventana o cwnd llena, esperando ACK...`);
      if(this.partnerNode && typeof this.partnerNode.windowSize==='number' && this.partnerNode.windowSize===0){
        this._startPersistTimer(simulationId);
      }
      return;
    }

    if(this.persistTimerId){
      clearTimeout(this.persistTimerId);
      this.persistTimerId=null;
    }

    const segmentSize=Math.min(this.pendingDataSize, Math.min(availableWindow,this.MSS));

    if(!this._checkNagle(segmentSize, inflight, simulationId)) {
      return;
    }

    if(this.nagleTimerId){
      clearTimeout(this.nagleTimerId);
      this.nagleTimerId=null;
    }

    this._log(`trySendOneSegment: Enviando segmento de ${segmentSize} bytes ahora.`);
    this._sendSegmentWithPacing(segmentSize,simulationId);
  }

  _sendSegmentWithPacing(segmentSize,simulationId){
    if(segmentSize<=0){
      this._log(`_sendSegmentWithPacing: Tamaño de segmento inválido (<=0), no se envía.`);
      return;
    }

    if(this.pacingEnabled){
      clearTimeout(this.pacingTimerId);
      this._log(`_sendSegmentWithPacing: Aplicando pacing (${this.pacingInterval}ms).`);
      this.pacingTimerId=setTimeout(()=>{
        this._actuallySendSegment(segmentSize,simulationId);
      },this.pacingInterval);
    } else {
      this._actuallySendSegment(segmentSize,simulationId);
    }
  }

  _actuallySendSegment(segmentSize,simulationId){
    if(segmentSize<=0){
      this._log(`_actuallySendSegment: segmentSize<=0, no se envía.`);
      return;
    }

    const seqToSend = this.nextSeqNum;
    this._log(`Enviando segmento de ${segmentSize} bytes (seq=${seqToSend}) cwnd=${this.cwnd}, ssthresh=${this.ssthresh}`);

    let flags={};
    let options={
      MSS:this.MSS,
      ipVersion:this.ipVersion
    };
    if(this.timestampsEnabled){
      this.lastTSvalSent++;
      options.TSval=this.lastTSvalSent;
      options.TSecr=this.lastTSReply;
    }

    if(this.securityEnabled){
      options.MD5Sig=this._calculateSignature(null,this.sharedKey);
    }

    const params=this._createMessageParameters(seqToSend,this.ackNum,segmentSize,flags,options);
    let message=this._buildMessage(params);

    this.sendMessage(message,segmentSize,simulationId);

    this.nextSeqNum += segmentSize;
    this.pendingDataSize -= segmentSize;

    if(this.pendingDataSize>0){
      this._scheduleDataSend(simulationId);
    } else {
      if(!this.closing && (this.state===this.states.ESTABLISHED||this.state===this.states.CLOSE_WAIT)){
        this._scheduleClose(simulationId);
      }
    }
  }

  // [MODIFICADO para handshakeLossRatio vs lossRatio]
  // [CHANGED] Ya no se hace return inmediato si se pierde.
  sendMessage(message,dataSize,simulationId){
    message.len=dataSize;
    message.srcNodeId=this.nodeId;

    // Determinamos si este mensaje es parte del handshake
    const isHandshakePacket = 
      (message.flags.SYN && !message.flags.ACK)  || // SYN
      (message.flags.SYN && message.flags.ACK)   || // SYN+ACK
      (
        message.flags.ACK && 
        message.len === 0 && 
        !message.flags.SYN && 
        !message.flags.FIN &&
        (message.ackNum === (this.iss+1) || this.state === this.states.SYN_SENT)
      );

    let effectiveLossRatio = isHandshakePacket ? this.handshakeLossRatio : this.lossRatio;
    const isLost = (Math.random() < effectiveLossRatio);

    if(isLost){
      this._log(`Paquete (seq=${message.seqNum}) PERDIDO (handshake? ${isHandshakePacket}). No se entrega a partnerNode.`);
      this.saveMessage(message, dataSize, simulationId, this.nodeId, true);
    } else {
      this.saveMessage(message, dataSize, simulationId, this.nodeId, false);
    }

    // Programar timer si no es SYN/RST y (tiene data>0 o FIN)
    const needsTimer = (!message.flags.SYN && !message.flags.RST && (dataSize>0 || message.flags.FIN));
    if(needsTimer){
      let endSeqNum=message.seqNum + dataSize;

      const timerId=setTimeout(()=>{
        this._handleRetransmission(message.seqNum,simulationId);
      },this.RTO);

      const originalParams={
        srcPort:message.srcPort,
        destPort:message.destPort,
        seqNum:message.seqNum,
        ackNum:message.ackNum,
        windowSize:message.windowSize,
        ttl:message.ttl,
        MSS:message.options.MSS,
        ipVersion:message.options.ipVersion,
        latency:message.latency,
        flags:Object.assign({},message.flags),
        options:JSON.parse(JSON.stringify(message.options)),
        len:dataSize
      };

      this.outstandingSegments.set(message.seqNum,{
        message:message,
        endSeqNum:endSeqNum,
        timerId:timerId,
        sendTime:Date.now(),
        retransmitted:false,
        sentTSval:(this.timestampsEnabled)?this.lastTSvalSent:null,
        originalParams:originalParams
      });
    }

    // [CHANGED] No se hace return. Simulamos entrega tras la latencia si no se pierde.
    setTimeout(()=>{
      if(!isLost){
        if(this.partnerNode){
          this.partnerNode.receiveMessage(message,simulationId);
        } else {
          this._log(`No partnerNode definido, no se puede entregar el mensaje (seq=${message.seqNum}).`);
        }
      }
    },this.latency);
  }

  receiveMessage(packet,simulationId){
    this._log(`Recibido mensaje seq=${packet.seqNum}, ack=${packet.ackNum}, RST=${packet.flags.RST}, SYN=${packet.flags.SYN}, ACK=${packet.flags.ACK}, FIN=${packet.flags.FIN}, len=${packet.len}`);

    if(!this._verifyChecksum(packet)){
      this._log(`Checksum inválido, descartando.`);
      return;
    }

    if(this.securityEnabled && packet.options.MD5Sig && !this._validateSignature(packet,this.sharedKey)){
      this._log(`Firma MD5 no válida, descartando`);
      return;
    }

    // [NEW] Si estamos CLOSED/LISTEN y no es SYN => enviamos RST
    if((this.state===this.states.CLOSED||this.state===this.states.LISTEN)&&!packet.flags.SYN){
      this._log(`Recibido segmento en estado ${this.state} sin SYN, enviando RST`);
      this.seqNum=this.nextSeqNum;
      let flags={RST:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
      let rstMessage=this._buildMessage(params);
      this.sendMessage(rstMessage,0,simulationId);
      return;
    }

    if(packet.flags.RST){
      this._log(`Recibido RST, cerrando conexión.`);
      this.state=this.states.CLOSED;
      // [NEW] Al cerrar: 
      this._cleanupTimers();
      this._clearOutstandingSegments();
      return;
    }

    // TIME_WAIT + FIN => reenviamos ACK y reiniciamos timer
    if(this.state===this.states.TIME_WAIT && packet.flags.FIN){
      this._log(`Recibido FIN en TIME_WAIT, reenviando ACK`);
      this.ackNum=packet.seqNum+1;
      this._sendAck(simulationId,this.ackNum);
      this._startTimeWaitTimer(simulationId);
      return;
    }

    // Manejo de handshake
    if(packet.flags.SYN && !packet.flags.ACK){
      this._log(`Recibido SYN, respondiendo con SYN+ACK`);
      this.state=this.states.SYN_RECEIVED;
      this.irs=packet.seqNum; 
      this.ackNum=this.irs+1;
      this.nextSeqNum=Math.floor(Math.random()*10000);
      this.iss=this.nextSeqNum; 

      if(packet.options && packet.options.MSS && packet.options.MSS<this.peerMSS){
        this.peerMSS=packet.options.MSS;
        this._log(`Ajustando peerMSS a ${this.peerMSS}`);
      }
      if(packet.options && packet.options.WScale!==undefined){
        this.peerWindowScalingShift=packet.options.WScale;
        this._log(`Ventana escalada peer shift=${this.peerWindowScalingShift}`);
      }
      if(packet.options && packet.options.TSval!==undefined && packet.options.TSecr!==undefined){
        this.peerTimestampsEnabled=true;
        this.lastTSvalReceived=packet.options.TSval;
        this.lastTSReply=packet.options.TSval;
        this._log(`Peer soporta timestamps`);
      }
      if(packet.flags.ECE && packet.flags.CWR){
        this.ecnActive=true;
        this._log(`ECN activo con el peer`);
      }

      this.seqNum=this.nextSeqNum; 
      let flags={SYN:true,ACK:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      if(this.ecnActive){
        flags.ECE=true; 
        flags.CWR=true;
      }
      if(this.windowScalingEnabled) options.WScale=this.windowScalingShift;
      if(this.timestampsEnabled){
        this.lastTSvalSent++;
        options.TSval=this.lastTSvalSent;
        options.TSecr=this.lastTSReply;
      }

      const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
      let response=this._buildMessage(params);
      this.sendMessage(response,0,simulationId);
      this.nextSeqNum+=1;

      this._startSynAckRetransmitTimer(simulationId);
      return;
    }

    if(packet.flags.SYN && packet.flags.ACK && !packet.flags.FIN && !packet.flags.RST){
      this._log(`Recibido SYN+ACK, enviando ACK final de handshake`);
      this._log(`Valor esperado ackNum=iss+1=${this.iss+1}, recibido ackNum=${packet.ackNum}`);
      if(packet.ackNum!==this.iss+1){
        this._log(`SYN+ACK no válido en cliente (no reconoce iss+1)`);
        return;
      }
      this.irs = packet.seqNum;
      this.ackNum = this.iss+1;

      if(this.state===this.states.SYN_SENT) {
        this.transition("recv_syn_ack",simulationId);
      } else if(this.state===this.states.ESTABLISHED) {
        this._log(`Ya en ESTABLISHED, reenviando ACK final debido a posible pérdida de ACK`);
        this._sendAck(simulationId,this.irs+1);
      }
      return;
    }

    if(this.state===this.states.SYN_RECEIVED && packet.flags.ACK && !packet.flags.SYN && !packet.flags.FIN && !packet.flags.RST){
      if(packet.ackNum===this.iss+1){
        this.ackNum=packet.ackNum;
        this.transition("recv_ack",simulationId);
        return;
      }
    }

    if(this.sackEnabled && packet.options && packet.options.SACK){
      this._log(`Recibidos SACK blocks: ${JSON.stringify(packet.options.SACK)}`);
      if(Array.isArray(packet.options.SACK) && packet.options.SACK.length>0){
        let newSACKBlocks=packet.options.SACK.slice().sort((a,b)=>a[0]-b[0]);
        let merged=[];
        let current=newSACKBlocks[0];

        for(let i=1;i<newSACKBlocks.length;i++){
          let [sstart, send]=newSACKBlocks[i];
          if(sstart<=current[1]+1){
            if(send>current[1]) current[1]=send;
          } else {
            merged.push(current);
            current=[sstart,send];
          }
        }
        merged.push(current);

        this.receivedSACKBlocks=merged;
        this._log(`SACK blocks merged: ${JSON.stringify(this.receivedSACKBlocks)}`);
      } else {
        this.receivedSACKBlocks=[];
      }
    }

    if(this.peerTimestampsEnabled && packet.options && packet.options.TSval!==undefined && packet.options.TSecr!==undefined){
      this.lastTSvalReceived=packet.options.TSval;
      this.lastTSReply=packet.options.TSval;
    }

    if(this.ecnEnabled && packet.flags.ECE && !packet.flags.SYN){
      this._log(`Recibido ECE: Congestión explícita detectada`);
      this.ssthresh=Math.max(this.cwnd/2,this.MSS);
      this.cwnd=this.ssthresh;
      this.seqNum=this.nextSeqNum;
      let flags={ACK:true,CWR:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      if(this.timestampsEnabled){
        this.lastTSvalSent++;
        options.TSval=this.lastTSvalSent;
        options.TSecr=this.lastTSReply;
      }
      const params=this._createMessageParameters(this.seqNum,this.ackNum,0,flags,options);
      let cwrAck=this._buildMessage(params);
      this.sendMessage(cwrAck,0,simulationId);
    }

    if(packet.flags.ACK && !packet.flags.SYN && !packet.flags.FIN && !packet.flags.RST){
      this._log(`Recibido ACK ackNum=${packet.ackNum}, manejando ACK...`);
      this._handleAck(packet,simulationId);
      return;
    }

    if(packet.flags.FIN && !packet.flags.ACK){
      this._log(`Recibido FIN`);
      if([this.states.ESTABLISHED,this.states.FIN_WAIT_1,this.states.FIN_WAIT_2].includes(this.state)){
        this.transition("recv_fin",simulationId);
      }
      return;
    }

    if(packet.flags.FIN && packet.flags.ACK){
      this._log(`Recibido FIN+ACK`);
      if(this.state===this.states.FIN_WAIT_1){
        this.state=this.states.CLOSING;
        if(!this.partnerNode || typeof this.partnerNode.seqNum!=='number'){
          this._log(`Advertencia: partnerNode no definido o seqNum inválido en FIN+ACK.`);
          return;
        }
        // [NEW] Guardamos fin seq
        if(!this.partnerFinSeq){
          this.partnerFinSeq = this.partnerNode.seqNum;
        }
        this.ackNum=this.partnerNode.seqNum+1;
        this._sendAck(simulationId,this.ackNum);
      } else if(this.state===this.states.ESTABLISHED){
        this.state=this.states.CLOSE_WAIT;
        if(!this.partnerNode || typeof this.partnerNode.seqNum!=='number'){
          this._log(`Advertencia: partnerNode no definido o seqNum inválido en FIN+ACK (ESTABLISHED).`);
          return;
        }
        if(!this.partnerFinSeq){
          this.partnerFinSeq = this.partnerNode.seqNum;
        }
        this.ackNum=this.partnerNode.seqNum+1;
        this._sendAck(simulationId,this.ackNum);
        this._scheduleDataOrClose(simulationId);
      }
      return;
    }

    if(!packet.flags.SYN && !packet.flags.ACK && !packet.flags.FIN && !packet.flags.RST){
      const segStart=packet.seqNum;
      const segEnd=packet.seqNum+packet.len-1;

      if(segEnd<this.rcv_next){
        this._log(`Segmento duplicado seq=${packet.seqNum}, reenviando ACK`);
        this._sendAck(simulationId,this.rcv_next);
      } else if(segStart>this.rcv_next+this.rcv_wnd-1){
        this._log(`Segmento fuera de ventana, descartando`);
        return;
      } else if(segStart===this.rcv_next){
        this.ackNum = this.rcv_next;
        this.rcv_next+=packet.len;
        this._log(`Datos en orden recibidos, rcv_next=${this.rcv_next}`);
        this._reassembleData(simulationId);

        this.delayedAckSegments++;
        if(this.delayedAckSegments>=2){
          this._log(`Se han recibido 2 segmentos, enviando ACK inmediato`);
          this._sendAck(simulationId,this.rcv_next);
        } else {
          clearTimeout(this.delayedAckTimerId);
          this.delayedAckTimerId=setTimeout(()=>{
            this._log(`Delayed ACK timer (200ms) expiró, enviando ACK`);
            this._sendAck(simulationId,this.rcv_next);
          },this.delayedAckTimeout);
        }

      } else {
        this._log(`Segmento fuera de orden, seq=${packet.seqNum}, almacenando`);
        this.outOfOrderBuffer.set(packet.seqNum,packet);

        this.delayedAckSegments++;
        if(this.delayedAckSegments>=2){
          this._log(`2 segmentos acumulados, enviando ACK`);
          this._sendAck(simulationId,this.rcv_next);
        } else {
          clearTimeout(this.delayedAckTimerId);
          this.delayedAckTimerId=setTimeout(()=>{
            this._log(`Delayed ACK timer expiró, enviando ACK`);
            this._sendAck(simulationId,this.rcv_next);
          },this.delayedAckTimeout);
        }
      }

      this.transition("recv_data",simulationId);
    }
  }

  _startSynAckRetransmitTimer(simulationId){
    if(this.synAckTimerId){
      clearTimeout(this.synAckTimerId);
    }
    this.synAckTimerId=setTimeout(()=>{
      this._handleSynAckRetransmission(simulationId);
    },this.RTO);
  }

  _handleSynAckRetransmission(simulationId){
    if(this.state===this.states.SYN_RECEIVED && this.synAckRetries<this.maxSynAckRetries){
      this.synAckRetries++;
      this._log(`No se recibió ACK final, retransmitiendo SYN+ACK (intento ${this.synAckRetries})`);
      let flags={SYN:true,ACK:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      if(this.ecnActive){
        flags.ECE=true; 
        flags.CWR=true;
      }
      if(this.windowScalingEnabled) options.WScale=this.windowScalingShift;
      if(this.timestampsEnabled){
        this.lastTSvalSent++;
        options.TSval=this.lastTSvalSent;
        options.TSecr=this.lastTSReply;
      }

      const params=this._createMessageParameters(this.iss,this.ackNum,0,flags,options);
      let synAckMessage=this._buildMessage(params);
      this.sendMessage(synAckMessage,0,simulationId);
      this._startSynAckRetransmitTimer(simulationId);

    } else if(this.state===this.states.SYN_RECEIVED && this.synAckRetries>=this.maxSynAckRetries){
      this._log(`Se agotaron los reintentos de SYN+ACK, cerrando conexión`);
      this.state=this.states.CLOSED;
      if(this.synAckTimerId){
        clearTimeout(this.synAckTimerId);
        this.synAckTimerId=null;
      }
    }
  }

  _reassembleData(simulationId){
    let advanced=true;
    while(advanced){
      advanced=false;
      let keys=Array.from(this.outOfOrderBuffer.keys()).sort((a,b)=>a-b);
      for(let k of keys){
        let seg=this.outOfOrderBuffer.get(k);
        if(k===this.rcv_next){
          this.rcv_next+=seg.len;
          this.outOfOrderBuffer.delete(k);
          this._log(`Reensamblaje: incorporado segmento seq=${k}, rcv_next=${this.rcv_next}`);
          advanced=true;
          break;
        }
      }
    }
  }

  _handleAck(packet,simulationId){
    const ackNum=packet.ackNum;
    if(ackNum>this.nextSeqNum+1||ackNum<this.sendBase){
      this._log(`ACK no válido ackNum=${ackNum}, ignorando`);
      return;
    }

    let prevSendBase=this.sendBase;
    let advanced=(ackNum>this.sendBase);
    if(advanced){
      this.sendBase=ackNum;
      this.duplicateAckCount=0;
    }

    let recognizedSegments=[];
    for(let [seqNum,seg] of this.outstandingSegments){
      if(seg.endSeqNum<=this.sendBase){
        clearTimeout(seg.timerId);
        this.outstandingSegments.delete(seqNum);
        recognizedSegments.push(seg);
      }
    }

    if(this.fastRecovery){
      let theLostSegmentEnd=this._someLostSegmentEnd();
      if(advanced && ackNum<theLostSegmentEnd){
        this._log(`Fast recovery: partial ACK recibido`);
        let nextLost=this._findNextLostSegment();
        if(nextLost && this._needsRetransmission(nextLost.message.seqNum,nextLost.message.len)){
          this._log(`Retransmitiendo siguiente segmento perdido seq=${nextLost.message.seqNum} en fast recovery`);
          this._retransmitSegment(nextLost,simulationId);
          this.cwnd=this.ssthresh+this.MSS;
        }
      } else if(advanced && ackNum>theLostSegmentEnd){
        this._log(`Saliendo de fast recovery`);
        this.fastRecovery=false;
        this.cwnd=this.ssthresh;
      } else if(!advanced){
        this.duplicateAckCount++;
        this.cwnd+=this.MSS;
        this._log(`Fast recovery: incrementando cwnd=${this.cwnd} por ACK duplicado adicional`);
      }
    } else {
      if(!advanced){
        this.duplicateAckCount++;
        this._log(`ACK duplicado (${this.duplicateAckCount}) ackNum=${ackNum}`);
        if(this.duplicateAckCount===3&&!this.fastRecovery){
          this._log(`3 ACK duplicados, fast retransmit!`);
          this._fastRetransmit(simulationId);
        }
      } else {
        this._log(`ACK avanza sendBase a ${this.sendBase}, bytes reconocidos: ${this.sendBase-prevSendBase}`);
        for(let seg of recognizedSegments){
          if(!seg.retransmitted){
            if(this.peerTimestampsEnabled && seg.sentTSval!==null){
              let sampleRTT=this.lastTSvalSent-seg.sentTSval;
              if(sampleRTT>0){
                this._updateRTO(sampleRTT);
              }
            } else {
              let sampleRTT=Date.now()-seg.sendTime;
              this._updateRTO(sampleRTT);
            }
            break;
          }
        }

        // cc
        if(this.congestionControl==="cubic"){
          // omit for brevity
        } else {
          if(this.cwnd<this.ssthresh){
            this.cwnd+=this.MSS;
            this._log(`Slow start: incrementando cwnd a ${this.cwnd}`);
          } else {
            const increment=Math.max(1,Math.floor((this.MSS*this.MSS)/this.cwnd));
            this.cwnd+=increment;
            this._log(`Congestion avoidance: incrementando cwnd a ${this.cwnd}`);
          }
        }

        if([this.states.SYN_RECEIVED,this.states.FIN_WAIT_1,this.states.CLOSING,this.states.LAST_ACK].includes(this.state)){
          this.transition("recv_ack",simulationId);
        } else if((this.state===this.states.ESTABLISHED||this.state===this.states.CLOSE_WAIT)&&this.pendingDataSize>0){
          this._scheduleDataSend(simulationId);
        }
      }
    }
  }

  _fastRetransmit(simulationId){
    let firstUnacked=null;
    let minSeq=Infinity;
    for(let [seqNum,seg] of this.outstandingSegments){
      if(seqNum<minSeq){
        minSeq=seqNum;
        firstUnacked=seg;
      }
    }

    if(!firstUnacked)return;

    this.ssthresh=Math.max(Math.floor(this.cwnd/2),this.MSS);
    this.cwnd=this.ssthresh+3*this.MSS;
    this.fastRecovery=true;

    this._log(`Fast retransmit del segmento seq=${firstUnacked.message.seqNum}, ssthresh=${this.ssthresh}, cwnd=${this.cwnd}`);
    firstUnacked.retransmitted=true;
    clearTimeout(firstUnacked.timerId);
    this.timeoutCount++;
    this.RTO=Math.min(this.RTO*2,this.maxRTO); 
    this._log(`Aumentando RTO a ${this.RTO} ms en fast retransmit`);

    if(!this._needsRetransmission(firstUnacked.message.seqNum,firstUnacked.message.len)){
      this._log(`Segmento seq=${firstUnacked.message.seqNum} ya SACKeado, no retransmitimos`);
      return;
    }

    this._retransmitSegment(firstUnacked,simulationId);
  }

  _retransmitSegment(segInfo,simulationId){
    segInfo.retransmitted=true;
    let retransMessage=this._buildMessage(segInfo.originalParams);

    this._log(`Retransmitiendo segmento seq=${retransMessage.seqNum} (len=${retransMessage.len})`);

    this.saveMessage(retransMessage,retransMessage.len,simulationId,this.nodeId,false);
    const timerId=setTimeout(()=>{
      this._handleRetransmission(retransMessage.seqNum,simulationId);
    },this.RTO);

    segInfo.message = retransMessage;
    segInfo.timerId = timerId;
    segInfo.sendTime = Date.now();
    this.outstandingSegments.set(retransMessage.seqNum,segInfo);

    if(Math.random()<this.lossRatio){
      this._log(`Paquete retransmitido (seq=${retransMessage.seqNum}) perdido por lossRatio`);
      return;
    }

    setTimeout(()=>{
      if(this.partnerNode){
        this.partnerNode.receiveMessage(retransMessage,simulationId);
      } else {
        this._log(`No partnerNode definido en retransmisión.`);
      }
    },segInfo.originalParams.latency);
  }

  // [CHANGED] Ahora ignoramos si ya estamos CLOSED o TIME_WAIT
  _handleRetransmission(seqNum,simulationId){
    // [NEW] Si ya estamos en CLOSED o TIME_WAIT, no reenviamos
    if(this.state===this.states.CLOSED || this.state===this.states.TIME_WAIT){
      this._log(`Ignoramos retransmisión de seq=${seqNum}, estado=${this.state}`);
      return;
    }

    let segInfo=this.outstandingSegments.get(seqNum);
    if(!segInfo) return;

    this._log(`Timeout en seq=${seqNum}`);
    this.ssthresh=Math.max(Math.floor(this.cwnd/2),this.MSS);
    this._log(`Ajustando ssthresh a ${this.ssthresh}, reiniciando cwnd a ${this.MSS}`);
    this.cwnd=this.MSS; 
    this.fastRecovery=false;

    this.timeoutCount++;
    this.RTO=Math.min(this.RTO*2,this.maxRTO);
    this._log(`Aumentando RTO a ${this.RTO} ms por timeout (consecutivos=${this.timeoutCount})`);

    if(!this._needsRetransmission(segInfo.message.seqNum,segInfo.message.len)){
      this._log(`Segmento seq=${segInfo.message.seqNum} ya SACKeado, no retransmitimos`);
      return;
    }

    let retransMessage=this._buildMessage(segInfo.originalParams);
    this.saveMessage(retransMessage,retransMessage.len,simulationId,this.nodeId,false);
    const timerId=setTimeout(()=>{
      this._handleRetransmission(seqNum,simulationId);
    },this.RTO);
    segInfo.message = retransMessage;
    segInfo.timerId=timerId;
    segInfo.sendTime=Date.now();
    this.outstandingSegments.set(seqNum,segInfo);

    if(Math.random()<this.lossRatio){
      this._log(`Paquete retransmitido (por timeout) perdido seq=${segInfo.message.seqNum}`);
      return;
    }

    setTimeout(()=>{
      if(this.partnerNode){
        this.partnerNode.receiveMessage(retransMessage,simulationId);
      } else {
        this._log(`No partnerNode definido en retransmisión por timeout.`);
      }
    },segInfo.originalParams.latency);
  }

  _startTimeWaitTimer(simulationId){
    this._log(`Entrando en TIME_WAIT por ${this.timeWaitDuration}ms`);
    clearTimeout(this._timeWaitTimerId);
    this._timeWaitTimerId=setTimeout(()=>{
      this._log(`Expiró TIME_WAIT, cerrando conexión`);
      this.state=this.states.CLOSED;
      // [NEW] Al cerrar, limpiamos timers y outstandingSegments
      this._cleanupTimers();
      this._clearOutstandingSegments();
    },this.timeWaitDuration);
  }

  _updateRTO(sampleRTT){
    this._log(`Medición de RTT: ${sampleRTT}ms`);
    if(this.SRTT===null){
      this.SRTT=sampleRTT;
      this.RTTVAR=sampleRTT/2;
      this.RTO=Math.max(3000,this.minRTO);
    } else {
      this.RTTVAR=(1 - this.beta)*this.RTTVAR+this.beta*Math.abs(this.SRTT - sampleRTT);
      this.SRTT=(1 - this.alpha)*this.SRTT+this.alpha*sampleRTT;
      let RTOcalc=this.SRTT+Math.max(10,4*this.RTTVAR);
      RTOcalc=Math.max(RTOcalc,this.minRTO);
      RTOcalc=Math.min(RTOcalc,this.maxRTO);
      this.RTO=Math.floor(RTOcalc);
    }
    this.timeoutCount=0;
    this._log(`Actualizando RTO: SRTT=${Math.floor(this.SRTT)}ms, RTTVAR=${Math.floor(this.RTTVAR)}ms, RTO=${this.RTO}ms, timeouts consecutivos=0`);
  }

  _verifyChecksum(packet){
    let mssVal=(packet.options && typeof packet.options.MSS==='number')?packet.options.MSS:1460;
    let ipVersion=(packet.options && typeof packet.options.ipVersion==='number')?packet.options.ipVersion:4;

    let baseSum=(packet.srcPort+
                 packet.destPort+
                 packet.seqNum+
                 packet.ackNum+
                 packet.windowSize+
                 packet.ttl+
                 mssVal)%65535;
    if(ipVersion===6){
      baseSum=(baseSum+12345)%65535;
    }

    return baseSum===packet.checksum;
  }

  _buildSACKBlocks(){
    // [ORIGINAL: retorna siempre [] a modo de demo]
    return [];
  }

  // Acepta “isLost” como 5to parámetro
  saveMessage(message,dataSize,simulationId,senderNodeId,isLost=false){
    const msgTimestamp=new Date().toISOString();
    const query=`
      INSERT INTO MessageHistory (
        simulation_id,node_id,timestamp,parameter_TCP,len
      ) VALUES (?,?,?,?,?)
    `;

    const parameters={
      srcPort:message.srcPort,
      destPort:message.destPort,
      seqNum:message.seqNum,
      ackNum:message.ackNum,
      dataOffset:message.dataOffset,
      reserved:message.reserved,
      flags:message.flags,
      windowSize:message.windowSize,
      checksum:message.checksum,
      urgentPointer:message.urgentPointer,
      options:message.options,
      padding:message.padding,
      latency:message.latency,
      ttl:message.ttl,
      isLost: isLost
    };

    db.run(query,
      [simulationId,senderNodeId,msgTimestamp,JSON.stringify(parameters),dataSize],
      (err)=>{
        if(err){
          this._log(`Error al guardar el mensaje en DB: ${err.message}`);
        }
      }
    );
  }

  // [CHANGED] ACK puro no consume seqNum
  _sendAck(simulationId,ackNum){
    if(this.delayedAckTimerId){
      clearTimeout(this.delayedAckTimerId);
      this.delayedAckTimerId=null;
      this.delayedAckSegments=0;
    }
    // Mantener seqNum para ACK puro
    let ackSeq=this.seqNum;  
    let flags={ACK:true};
    let options={
      MSS:this.MSS,
      ipVersion:this.ipVersion
    };
    if(this.timestampsEnabled){
      this.lastTSvalSent++;
      options.TSval=this.lastTSvalSent;
      options.TSecr=this.lastTSReply;
    }
    if(this.sackEnabled){
      options.SACK=this._buildSACKBlocks();
    }
    const params=this._createMessageParameters(ackSeq,ackNum,0,flags,options);
    let ackMessage=this._buildMessage(params);
    this._log(`Enviando ACK (ackNum=${ackNum}) (seq=${ackSeq})`);
    // isLost=false
    this.sendMessage(ackMessage,0,simulationId);
  }

  startSimulation(dataSize,simulationId){
    this.state=this.states.CLOSED;
    this.seqNum=Math.floor(Math.random()*10000);
    this.sendBase=this.seqNum;
    this.nextSeqNum=this.seqNum;
    this.iss=this.seqNum;
    this.ackNum=0;
    this.closing=false;
    this.pendingDataSize=Number(dataSize)||0;
    this.ackReceived=false;
    this.buffer=0;
    this.cwnd=this.MSS;
    this.ssthresh=64*this.MSS;

    this.RTO=3000;
    this.SRTT=null;
    this.RTTVAR=null;
    this.duplicateAckCount=0;
    this.fastRecovery=false;
    this.outOfOrderBuffer.clear();
    this.receivedSACKBlocks=[];

    this.synRetries=0;
    this.synAckRetries=0;
    this.timeoutCount=0;

    // [NEW] Reset partnerFinSeq
    this.partnerFinSeq=null;

    this._cleanupTimers();

    this._log(`Iniciando simulación con ${this.pendingDataSize} bytes por enviar.`);
    this._startKeepAliveTimer(simulationId);
    this.transition("start_simulation",simulationId);
  }

  _startKeepAliveTimer(simulationId){
    if(!this.keepAliveEnabled)return;
    clearTimeout(this.keepAliveTimerId);
    this.keepAliveTimerId=setTimeout(()=>{
      this._log(`Enviando keep-alive`);
      let ackSeq=this.seqNum;
      let ackNum=this.rcv_next;
      let flags={ACK:true};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      if(this.timestampsEnabled){
        this.lastTSvalSent++;
        options.TSval=this.lastTSvalSent;
        options.TSecr=this.lastTSReply;
      }
      const params=this._createMessageParameters(ackSeq,ackNum,0,flags,options);
      let kaMsg=this._buildMessage(params);
      this.sendMessage(kaMsg,0,simulationId);
      this._startKeepAliveTimer(simulationId);
    },this.keepAliveInterval);
  }

  _startPersistTimer(simulationId){
    if(this.persistTimerId)return;
    this._log(`Ventana cero detectada, iniciando persist timer`);
    this.persistTimerId=setTimeout(()=>{
      this._log(`Persist timer expiró, enviando sonda de persistencia`);
      let flags={};
      let options={
        MSS:this.MSS,
        ipVersion:this.ipVersion
      };
      const params=this._createMessageParameters(this.nextSeqNum,this.ackNum,1,flags,options);
      let probe=this._buildMessage(params);
      this.sendMessage(probe,1,simulationId);
      this.persistTimerId=null;

      let inflight=this.nextSeqNum-this.sendBase;
      let receiverWindow=0;
      if(this.partnerNode && typeof this.partnerNode.windowSize==='number'){
        receiverWindow=(this.partnerNode.windowSize-inflight);
      } else {
        receiverWindow=(this.windowSize-inflight);
      }
      if(receiverWindow<=0){
        this._log(`La ventana sigue en cero, reprogramando persist timer`);
        this._startPersistTimer(simulationId);
      }
    },this.persistTimeout);
  }

  _scheduleDataSend(simulationId){
    if((this.state===this.states.ESTABLISHED||this.state===this.states.CLOSE_WAIT)&&!this.closing){
      setTimeout(()=>this.transition("send_data",simulationId),50);
    }
  }

  _scheduleClose(simulationId){
    if(!this.closing&&(this.state===this.states.ESTABLISHED||this.state===this.states.CLOSE_WAIT)){
      setTimeout(()=>this.transition("close_connection",simulationId),50);
    }
  }

  _scheduleDataOrClose(simulationId){
    if(this.pendingDataSize>0){
      this._scheduleDataSend(simulationId);
    } else {
      this._scheduleClose(simulationId);
    }
  }

  _someLostSegmentEnd() {
    let recognizedEnd=this.sendBase;
    if(this.receivedSACKBlocks.length>0){
      for(let [start,end] of this.receivedSACKBlocks) {
        if(start<=recognizedEnd+1){
          if(end>recognizedEnd) recognizedEnd=end;
        } else break;
      }
    }
    return recognizedEnd;
  }

  _findNextLostSegment() {
    for(let [seqNum,segInfo] of this.outstandingSegments){
      if(this._needsRetransmission(segInfo.message.seqNum,segInfo.message.len)){
        return segInfo;
      }
    }
    return null;
  }
}

module.exports = {
  TCPNode,
  MessageTCP
};
