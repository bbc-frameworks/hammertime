var sys = require('sys'),
    io = loadSocketIO(),
    Client = require('./client');

function loadSocketIO() {
    var fs = require('fs'),
        WebSocket = require(__dirname + '/../../ext/node-websocket-client/lib/websocket').WebSocket,
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
    WebSocket.prototype.send = { toString: function () { return "native" } };
    Script.runInNewContext(code, context, 'socket.io.js');
    return context.io;
}

var SocketIOClient = module.exports = function (host, port) {
    var self = this;
    Client.call(this);
    this.socket = new io.Socket(host, {
        port: port,
        transports: ['websocket'],
        rememberTransport: false
    });
    this.socket.on('connect', function () {
        self.emit('connect');
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
