
var sys = require('sys'),
    ws = require(__dirname + '/../../ext/node-websocket-client/lib/websocket'),
    io = loadSocketIO(),
    Client = require('./client');

function loadSocketIO() {
    var fs = require('fs'),
        WebSocket = ws.WebSocket,
        Script = process.binding('evals').Script,
        code = fs.readFileSync(__dirname + '/../../ext/Socket.IO/socket.io.js'),
        context = {
            WebSocket: WebSocket,
            window: { WebSocket: WebSocket },
            document: {
                location: { port: 8000 },
                readyState: 'complete'
            },
            navigator: {
                userAgent: 'node.js',
                platform: 'calculator'
            },
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        };
/*    ws.addBindIP('10.10.10.128');
    ws.addBindIP('10.10.10.129');
    ws.addBindIP('10.10.10.130');
    ws.addBindIP('10.10.10.131');
    ws.addBindIP('10.10.10.132');
    ws.addBindIP('10.10.10.133');
    ws.addBindIP('10.10.10.134');
    ws.addBindIP('10.10.10.135');
    ws.addBindIP('10.10.10.136');
    ws.addBindIP('10.10.10.137');
    ws.addBindIP('10.10.10.138');
    ws.addBindIP('10.10.10.139');
    ws.addBindIP('10.10.10.140');
    ws.addBindIP('10.10.10.141');
    ws.addBindIP('10.10.10.142');
    ws.addBindIP('10.10.10.143');*/
    WebSocket.prototype.send = { toString: function () { return "native" } };
    Script.runInNewContext(code, context, 'socket.io.js');
    return context.io;
}

var SocketIOClient = module.exports = function (host, port) {
    var self = this;
    Client.call(this);
    this.socket = new io.Socket(host, {
        port: port,
//        connectTimeout: null,
        transports: ['websocket'],
        rememberTransport: false
    });
    this.socket.on('connect', function () {
        self.emit('connect');
    });
    this.socket.on('disconnect', function (e) {
        self.emit('disconnect', e);
    });
    this.socket.on('error', function (e) {
        self.emit('error', e);
    });
    this.socket.on('message', function (data) {
        self.emit('message', JSON.parse(data));
    });
};
sys.inherits(SocketIOClient, Client);

SocketIOClient.prototype.connect = function () {
    return this.socket.connect();
};

SocketIOClient.prototype.disconnect = function () {
    return this.socket.disconnect();
};

