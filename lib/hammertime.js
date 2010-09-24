#! /usr/bin/env node

var http = require('http'),
    sys = require('sys'),
    io = loadSocketIO();

function loadSocketIO() {
    var fs = require('fs'),
        WebSocket = require(__dirname + '/../ext/node-websocket-client/lib/websocket').WebSocket,
        Script = process.binding('evals').Script,
        code = fs.readFileSync(__dirname + '/../ext/Socket.IO/socket.io.js'),
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


function ClientStats() {
    this.start = null;
    this.numClients = 0;
    this.received = [];
    this.connected = [];
}
ClientStats.prototype.begin = function (numClients) {
    var d = new Date();
    this.numClients = numClients;
    this.start = d.getTime();
    this.received = [];
    this.connected = [];
};
ClientStats.prototype.clientConnected = function () {
    var d = new Date();
    this.connected.push(d.getTime() - this.start);
};
ClientStats.prototype.clientReceived = function (data) {
    var d = new Date();
    this.received.push(d.getTime() - this.start);
};
ClientStats.prototype.end = function () {
    sys.debug(sys.inspect(this));

    var add = function (acc, n) { return acc + n; };

    sys.debug('Connected ' + this.connected.length + '/' + this.numClients);
    sys.debug(
        'avg: ' + (this.connected.reduce(add, 0) / this.connected.length) + 'ms   ' +
        'min: ' + this.connected[0] + 'ms   max: ' + this.connected[this.connected.length - 1] + 'ms'
    );

    sys.debug('Completed ' + this.received.length + '/' + this.numClients);
    sys.debug(
        'avg: ' + (this.received.reduce(add, 0) / this.received.length) + 'ms   ' +
        'min: ' + this.received[0] + 'ms   max: ' + this.received[this.received.length - 1] + 'ms'
    );
};

function makeClient(stats) {
    var socket = new io.Socket('127.0.0.1', {
        port: 8000,
        transports: ['websocket'],
        rememberTransport: false
    });
    socket.on('connect', function () {
        stats.clientConnected();
    });
    socket.on('message', function (data) {
        stats.clientReceived(data);
    });
    //socket.on('disconnect', function () {
    //    sys.debug('disconnect');
    //});
    socket.connect();
    return socket;
}

exports.run = function () {
    var stats = new ClientStats(),
        clients = [];

    for (var i = 100; i > 0; --i) {
        clients.push(makeClient(stats));
    }

    var poster = http.createClient(8000, '127.0.0.1'),
        request = poster.request('POST', '/data');
    request.write('hello world');
    stats.begin(clients.length);
    request.end();
    setTimeout(function () {
        stats.end();
    }, 2000);
}
