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


function ClientStats(numClients) {
    this.start = null;
    this.numClients = numClients;
    this.received = [];
    this.connected = [];
}
ClientStats.prototype.begin = function () {
    var d = new Date();
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
ClientStats.prototype.checkConnected = function () {
    var add = function (acc, n) { return acc + n; };
    sys.log('Connected ' + this.connected.length + '/' + this.numClients);
    sys.log(
        'avg: ' + (this.connected.reduce(add, 0) / this.connected.length) + 'ms   ' +
        'min: ' + this.connected[0] + 'ms   max: ' + this.connected[this.connected.length - 1] + 'ms'
    );
};
ClientStats.prototype.checkReceived = function () {
    var add = function (acc, n) { return acc + n; };
    sys.log('Received ' + this.received.length + '/' + this.numClients);
    sys.log(
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

function runTest(numClients, data) {
    var stats = new ClientStats(numClients),
        clients = [];

    stats.begin();
    for (var i = numClients; i > 0; --i) {
        clients.push(makeClient(stats));
    }
    setTimeout(function () {
        stats.checkConnected();
    }, 1000);

    var poster = http.createClient(8000, '127.0.0.1'),
        request;

    setInterval(function () {
        stats.begin();
        request = poster.request('POST', '/data');
        request.write(data);
        request.end();
        setTimeout(function () {
            stats.checkReceived();
        }, 2000);
    }, 5000);
}

exports.run = function () {
    runTest(100, 'hello world');
}
